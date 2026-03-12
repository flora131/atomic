import type { EventBus } from "@/services/events/event-bus.ts";
import {
  asRecord,
  asString,
  createSessionErrorEvent,
  createSessionStartEvent,
  isBuiltInTaskTool,
  normalizeToolName,
} from "@/services/events/adapters/provider-shared.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import {
  cleanupClaudeOrphanedTools,
  publishClaudeSyntheticAgentComplete,
  publishClaudeSyntheticAgentStart,
} from "@/services/events/adapters/providers/claude/tool-state-events.ts";

export type ClaudeEarlyToolStartEvent = {
  phase: "start";
  toolId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  sdkCorrelationId: string;
};

export type ClaudeTaskToolMetadata = {
  description: string;
  isBackground: boolean;
};

export type ClaudeSyntheticForegroundAgent = {
  id: string;
  name: string;
  task: string;
  started: boolean;
  completed: boolean;
  sawNativeSubagentStart: boolean;
};

export type ClaudeActiveSubagentToolContext = {
  parentAgentId: string;
  toolName: string;
};

export class ClaudeToolState {
  public pendingToolIdsByName = new Map<string, string[]>();
  public toolCorrelationAliases = new Map<string, string>();
  public emittedToolStartCorrelationIds = new Set<string>();
  public taskToolMetadata = new Map<string, ClaudeTaskToolMetadata>();
  public pendingTaskToolCorrelationIds: string[] = [];
  public earlyToolEvents = new Map<string, ClaudeEarlyToolStartEvent[]>();
  public activeSubagentIds = new Set<string>();
  public activeSubagentBackgroundById = new Map<string, boolean>();
  public currentBackgroundAttributionAgentId: string | null = null;
  public activeSubagentToolsById = new Map<string, ClaudeActiveSubagentToolContext>();
  public ownedSessionIds = new Set<string>();
  public subagentSessionToAgentId = new Map<string, string>();
  public nativeSubagentIdToAgentId = new Map<string, string>();
  public toolUseIdToSubagentId = new Map<string, string>();
  public syntheticForegroundAgent: ClaudeSyntheticForegroundAgent | null = null;
  public syntheticToolCounter = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly sessionId: string,
    private readonly getSubagentTracker: () => SubagentToolTracker | null,
    private readonly getTextAccumulator: () => string,
  ) {}

  reset(): void {
    this.pendingToolIdsByName.clear();
    this.toolCorrelationAliases.clear();
    this.emittedToolStartCorrelationIds.clear();
    this.taskToolMetadata.clear();
    this.pendingTaskToolCorrelationIds = [];
    this.earlyToolEvents.clear();
    this.activeSubagentIds.clear();
    this.activeSubagentBackgroundById.clear();
    this.currentBackgroundAttributionAgentId = null;
    this.activeSubagentToolsById.clear();
    this.ownedSessionIds = new Set([this.sessionId]);
    this.subagentSessionToAgentId.clear();
    this.nativeSubagentIdToAgentId.clear();
    this.toolUseIdToSubagentId.clear();
    this.syntheticForegroundAgent = null;
    this.syntheticToolCounter = 0;
  }

  queueEarlyToolStart(
    key: string,
    event: ClaudeEarlyToolStartEvent,
  ): void {
    const queue = this.earlyToolEvents.get(key) ?? [];
    if (queue.some((entry) => entry.toolId === event.toolId)) {
      return;
    }
    queue.push(event);
    this.earlyToolEvents.set(key, queue);
  }

  replayEarlyToolStart(
    parentAgentId: string,
    event: ClaudeEarlyToolStartEvent,
    runId: number,
  ): void {
    this.recordActiveSubagentToolContext(
      event.toolId,
      event.toolName,
      parentAgentId,
      undefined,
      event.sdkCorrelationId,
    );
    if (this.getSubagentTracker()?.hasAgent(parentAgentId)) {
      this.getSubagentTracker()?.onToolStart(parentAgentId, event.toolName);
    }
    this.bus.publish({
      type: "stream.tool.start",
      sessionId: this.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        toolId: event.toolId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        sdkCorrelationId: event.sdkCorrelationId,
        parentAgentId,
      },
    });
  }

  publishSessionStart(runId: number): void {
    this.bus.publish(createSessionStartEvent(this.sessionId, runId));
  }

  publishSessionError(runId: number, error: unknown): void {
    this.bus.publish(createSessionErrorEvent(this.sessionId, runId, error));
  }

  resolveTaskOutputParentAgentId(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string | undefined {
    if (toolName.toLowerCase() !== "taskoutput") {
      return undefined;
    }
    const taskId = asString(toolInput.task_id ?? toolInput.taskId);
    if (!taskId) {
      return undefined;
    }
    const canonicalTaskAgentId = this.resolveCanonicalAgentId(taskId);
    if (canonicalTaskAgentId) {
      return canonicalTaskAgentId;
    }
    if (this.hasKnownSubagentId(taskId)) {
      return taskId;
    }
    return this.toolUseIdToSubagentId.get(taskId);
  }

  extractTaskToolMetadata(
    toolInput: unknown,
  ): ClaudeTaskToolMetadata {
    const record = asRecord(toolInput) ?? {};
    return {
      description: asString(record.description)
        ?? asString(record.prompt)
        ?? asString(record.task)
        ?? "",
      isBackground: record.run_in_background === true
        || asString(record.mode)?.toLowerCase() === "background",
    };
  }

  createSyntheticToolId(runId: number, toolName: string): string {
    this.syntheticToolCounter += 1;
    const normalizedName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `tool_${runId}_${normalizedName}_${this.syntheticToolCounter}`;
  }

  queueToolId(toolName: string, toolId: string): void {
    const queue = this.pendingToolIdsByName.get(toolName) ?? [];
    if (!queue.includes(toolId)) {
      queue.push(toolId);
      this.pendingToolIdsByName.set(toolName, queue);
    }
  }

  removeQueuedToolId(toolName: string, toolId: string): void {
    const queue = this.pendingToolIdsByName.get(toolName);
    if (!queue) return;
    const nextQueue = queue.filter((queuedId) => queuedId !== toolId);
    if (nextQueue.length === 0) {
      this.pendingToolIdsByName.delete(toolName);
      return;
    }
    this.pendingToolIdsByName.set(toolName, nextQueue);
  }

  shiftQueuedToolId(toolName: string): string | undefined {
    const queue = this.pendingToolIdsByName.get(toolName);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const [toolId, ...rest] = queue;
    if (rest.length === 0) {
      this.pendingToolIdsByName.delete(toolName);
    } else {
      this.pendingToolIdsByName.set(toolName, rest);
    }
    return toolId;
  }

  resolveToolStartId(
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ): string {
    const toolId = explicitToolId ?? this.createSyntheticToolId(runId, toolName);
    this.queueToolId(toolName, toolId);
    return toolId;
  }

  resolveToolCompleteId(
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ): string {
    if (explicitToolId) {
      this.removeQueuedToolId(toolName, explicitToolId);
      return explicitToolId;
    }
    return this.shiftQueuedToolId(toolName) ?? this.createSyntheticToolId(runId, toolName);
  }

  resolveToolCorrelationId(correlationId: string | undefined): string | undefined {
    if (!correlationId) {
      return undefined;
    }
    return this.toolCorrelationAliases.get(correlationId) ?? correlationId;
  }

  resolveTaskDispatchParentAgentId(correlationId: string | undefined): string | undefined {
    const resolvedCorrelationId = this.resolveToolCorrelationId(correlationId) ?? correlationId;
    if (!resolvedCorrelationId) {
      return undefined;
    }
    return this.toolUseIdToSubagentId.get(resolvedCorrelationId)
      ?? (this.taskToolMetadata.has(resolvedCorrelationId)
        || this.pendingTaskToolCorrelationIds.includes(resolvedCorrelationId)
        ? resolvedCorrelationId
        : undefined);
  }

  resolveCanonicalAgentId(agentId: string | undefined): string | undefined {
    if (!agentId) {
      return undefined;
    }
    return this.nativeSubagentIdToAgentId.get(agentId) ?? agentId;
  }

  recordPendingTaskToolCorrelationId(correlationId: string): void {
    if (this.pendingTaskToolCorrelationIds.includes(correlationId)) {
      return;
    }
    this.pendingTaskToolCorrelationIds.push(correlationId);
  }

  removePendingTaskToolCorrelationId(correlationId: string): void {
    this.pendingTaskToolCorrelationIds = this.pendingTaskToolCorrelationIds.filter(
      (candidate) => candidate !== correlationId,
    );
  }

  resolveNextPendingTaskToolCorrelationId(): string | undefined {
    for (const correlationId of this.pendingTaskToolCorrelationIds) {
      if (this.taskToolMetadata.has(correlationId) && !this.toolUseIdToSubagentId.has(correlationId)) {
        return correlationId;
      }
    }
    return undefined;
  }

  getSyntheticAgentIdForAttribution(): string | undefined {
    if (!this.syntheticForegroundAgent) {
      return undefined;
    }
    if (this.syntheticForegroundAgent.completed || this.syntheticForegroundAgent.sawNativeSubagentStart) {
      return undefined;
    }
    return this.syntheticForegroundAgent.id;
  }

  resolveActiveSubagentToolContext(
    ...correlationIds: Array<string | undefined>
  ): ClaudeActiveSubagentToolContext | undefined {
    const ids = correlationIds
      .map((id) => this.resolveToolCorrelationId(id) ?? id)
      .filter((id): id is string => Boolean(id));
    for (const id of ids) {
      const context = this.activeSubagentToolsById.get(id);
      if (context) {
        return context;
      }
    }
    return undefined;
  }

  resolveSoleActiveSubagentToolParentAgentId(): string | undefined {
    const parentAgentIds = new Set<string>();
    for (const context of this.activeSubagentToolsById.values()) {
      if (!this.getSubagentTracker()?.hasAgent(context.parentAgentId)) {
        continue;
      }
      parentAgentIds.add(context.parentAgentId);
      if (parentAgentIds.size > 1) {
        return undefined;
      }
    }
    return parentAgentIds.values().next().value;
  }

  publishSyntheticAgentStart(runId: number): void {
    const syntheticAgent = this.syntheticForegroundAgent;
    if (!syntheticAgent || syntheticAgent.started || syntheticAgent.sawNativeSubagentStart) {
      return;
    }
    publishClaudeSyntheticAgentStart({
      bus: this.bus,
      runId,
      sessionId: this.sessionId,
      subagentTracker: this.getSubagentTracker(),
      syntheticAgent,
    });
  }

  publishSyntheticAgentComplete(
    runId: number,
    success: boolean,
    error?: string,
  ): void {
    const syntheticAgent = this.syntheticForegroundAgent;
    if (!syntheticAgent || !syntheticAgent.started || syntheticAgent.completed) {
      return;
    }
    publishClaudeSyntheticAgentComplete({
      bus: this.bus,
      error,
      getTextAccumulator: this.getTextAccumulator,
      runId,
      sessionId: this.sessionId,
      subagentTracker: this.getSubagentTracker(),
      success,
      syntheticAgent,
    });
  }

  registerToolCorrelationAliases(
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    for (const correlationId of correlationIds) {
      if (!correlationId || correlationId === toolId) {
        continue;
      }
      this.toolCorrelationAliases.set(correlationId, toolId);
    }
  }

  recordActiveSubagentToolContext(
    toolId: string,
    toolName: string,
    parentAgentId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    const context = { parentAgentId, toolName };
    const ids = [toolId, ...correlationIds]
      .map((id) => this.resolveToolCorrelationId(id) ?? id)
      .filter((id): id is string => Boolean(id));
    for (const id of ids) {
      this.activeSubagentToolsById.set(id, context);
    }
  }

  removeActiveSubagentToolContext(
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    const ids = [toolId, ...correlationIds]
      .map((id) => this.resolveToolCorrelationId(id) ?? id)
      .filter((id): id is string => Boolean(id));
    for (const id of ids) {
      this.activeSubagentToolsById.delete(id);
    }
  }

  hasKnownSubagentId(subagentId: string): boolean {
    if (!subagentId) {
      return false;
    }
    if (this.nativeSubagentIdToAgentId.has(subagentId)) {
      return true;
    }
    if (this.activeSubagentIds.has(subagentId)) {
      return true;
    }
    if (this.getSubagentTracker()?.hasAgent(subagentId)) {
      return true;
    }
    for (const mappedId of this.toolUseIdToSubagentId.values()) {
      if (mappedId === subagentId) {
        return true;
      }
    }
    return false;
  }

  resolveSoleActiveSubagentId(): string | undefined {
    if (this.activeSubagentIds.size !== 1) {
      return undefined;
    }
    return this.activeSubagentIds.values().next().value;
  }

  resolveBackgroundAttributionFallbackAgentId(): string | undefined {
    if (this.activeSubagentIds.size === 0) {
      return undefined;
    }

    const backgroundAgentIds = [...this.activeSubagentIds].filter(
      (agentId) => this.activeSubagentBackgroundById.get(agentId) === true,
    );
    if (backgroundAgentIds.length === 0) {
      return undefined;
    }

    const hasForegroundAgent = [...this.activeSubagentIds].some(
      (agentId) => this.activeSubagentBackgroundById.get(agentId) !== true,
    );
    if (hasForegroundAgent) {
      return undefined;
    }

    if (
      this.currentBackgroundAttributionAgentId
      && backgroundAgentIds.includes(this.currentBackgroundAttributionAgentId)
    ) {
      return this.currentBackgroundAttributionAgentId;
    }

    return backgroundAgentIds[0];
  }

  cleanupOrphanedTools(runId: number): void {
    this.currentBackgroundAttributionAgentId = cleanupClaudeOrphanedTools({
      activeSubagentIds: this.activeSubagentIds,
      activeSubagentToolsById: this.activeSubagentToolsById,
      activeSubagentBackgroundById: this.activeSubagentBackgroundById,
      bus: this.bus,
      currentBackgroundAttributionAgentId: this.currentBackgroundAttributionAgentId,
      nativeSubagentIdToAgentId: this.nativeSubagentIdToAgentId,
      pendingToolIdsByName: this.pendingToolIdsByName,
      removeActiveSubagentToolContext: (toolId, ...correlationIds) =>
        this.removeActiveSubagentToolContext(toolId, ...correlationIds),
      resolveActiveSubagentToolContext: (...correlationIds) =>
        this.resolveActiveSubagentToolContext(...correlationIds),
      runId,
      sessionId: this.sessionId,
      subagentSessionToAgentId: this.subagentSessionToAgentId,
    });
    this.ownedSessionIds = new Set([this.sessionId]);
  }

  isOwnedSession(eventSessionId: string): boolean {
    return eventSessionId === this.sessionId || this.ownedSessionIds.has(eventSessionId);
  }

  resolveSubagentSessionParentAgentId(eventSessionId: string): string | undefined {
    if (eventSessionId === this.sessionId) {
      return undefined;
    }
    return this.subagentSessionToAgentId.get(eventSessionId);
  }

  asRecord(value: unknown): Record<string, unknown> | undefined {
    return asRecord(value);
  }

  asString(value: unknown): string | undefined {
    return asString(value);
  }

  normalizeToolName(value: unknown): string {
    return normalizeToolName(value);
  }

  isTaskTool(toolName: string): boolean {
    return isBuiltInTaskTool(toolName);
  }
}
