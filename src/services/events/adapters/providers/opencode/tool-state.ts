import type { BusEvent } from "@/services/events/bus-events.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import {
  asRecord,
  asString,
  isBuiltInTaskTool,
  normalizeToolName,
} from "@/services/events/adapters/provider-shared.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";

export type OpenCodeTaskToolMetadata = {
  description: string;
  isBackground: boolean;
  agentType?: string;
  subagentSessionId?: string;
};

export type OpenCodeEarlyToolEvent = {
  toolId: string;
  toolName: string;
};

export type OpenCodeActiveSubagentToolContext = {
  parentAgentId: string;
  toolName: string;
};

export class OpenCodeToolState {
  public pendingToolIdsByName = new Map<string, string[]>();
  public toolStartSignatureByToolId = new Map<string, string>();
  public toolCorrelationAliases = new Map<string, string>();
  public taskToolMetadata = new Map<string, OpenCodeTaskToolMetadata>();
  public pendingTaskToolCorrelationIds: string[] = [];
  public pendingSubagentCorrelationIds: string[] = [];
  public toolUseIdToSubagentId = new Map<string, string>();
  public subagentIdToCorrelationId = new Map<string, string>();
  public subagentSessionToCorrelationId = new Map<string, string>();
  public trackedToolStartKeys = new Set<string>();
  public earlyToolEvents = new Map<string, OpenCodeEarlyToolEvent[]>();
  public activeSubagentToolsById = new Map<string, OpenCodeActiveSubagentToolContext>();
  public completedToolIds = new Set<string>();
  public syntheticToolCounter = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly sessionId: string,
    private readonly getSubagentTracker: () => SubagentToolTracker | null,
  ) {}

  reset(): void {
    this.pendingToolIdsByName.clear();
    this.toolStartSignatureByToolId.clear();
    this.toolCorrelationAliases.clear();
    this.taskToolMetadata.clear();
    this.pendingTaskToolCorrelationIds = [];
    this.pendingSubagentCorrelationIds = [];
    this.toolUseIdToSubagentId.clear();
    this.subagentIdToCorrelationId.clear();
    this.subagentSessionToCorrelationId.clear();
    this.trackedToolStartKeys.clear();
    this.earlyToolEvents.clear();
    this.activeSubagentToolsById.clear();
    this.completedToolIds.clear();
    this.syntheticToolCounter = 0;
  }

  extractTaskToolMetadata(
    toolInput: unknown,
    eventData?: Record<string, unknown>,
  ): OpenCodeTaskToolMetadata {
    const record = asRecord(toolInput) ?? {};
    const toolMetadata = asRecord(eventData?.toolMetadata)
      ?? asRecord(record.metadata)
      ?? {};
    const agentType = asString(record.subagent_type)
      ?? asString(record.subagentType)
      ?? asString(record.agent_type)
      ?? asString(record.agentType)
      ?? asString(record.agent);
    return {
      description: asString(record.description)
        ?? asString(record.prompt)
        ?? asString(record.task)
        ?? "",
      isBackground: record.run_in_background === true
        || asString(record.mode)?.toLowerCase() === "background",
      agentType,
      subagentSessionId: asString(toolMetadata.sessionId)
        ?? asString(toolMetadata.sessionID),
    };
  }

  mergeTaskToolMetadata(
    existing: OpenCodeTaskToolMetadata | undefined,
    incoming: OpenCodeTaskToolMetadata,
  ): OpenCodeTaskToolMetadata {
    if (!existing) {
      return incoming;
    }
    return {
      description: incoming.description || existing.description,
      isBackground: incoming.isBackground || existing.isBackground,
      agentType: incoming.agentType ?? existing.agentType,
      subagentSessionId: incoming.subagentSessionId ?? existing.subagentSessionId,
    };
  }

  hasTaskDispatchDetails(toolInput: unknown): boolean {
    const record = asRecord(toolInput) ?? {};
    const description = asString(record.description)
      ?? asString(record.task)
      ?? asString(record.title)
      ?? asString(record.prompt);
    const agentName = asString(record.subagent_type)
      ?? asString(record.subagentType)
      ?? asString(record.agent_type)
      ?? asString(record.agentType)
      ?? asString(record.agent);
    return Boolean(description || agentName);
  }

  serializeForSignature(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.serializeForSignature(entry)).join(",")}]`;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${key}:${this.serializeForSignature(entry)}`);
      return `{${entries.join(",")}}`;
    }
    return String(value);
  }

  buildToolStartSignature(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolMetadata: Record<string, unknown> | undefined,
    parentAgentId: string | undefined,
  ): string {
    return `${toolName}|${parentAgentId ?? ""}|${this.serializeForSignature(toolInput)}|${this.serializeForSignature(toolMetadata ?? {})}`;
  }

  resolveToolCorrelationId(correlationId: string | undefined): string | undefined {
    if (!correlationId) {
      return undefined;
    }
    let resolved = correlationId;
    const visited: string[] = [];
    const seen = new Set<string>();
    while (!seen.has(resolved)) {
      visited.push(resolved);
      seen.add(resolved);
      const next = this.toolCorrelationAliases.get(resolved);
      if (!next || next === resolved) {
        break;
      }
      resolved = next;
    }
    for (const alias of visited) {
      this.toolCorrelationAliases.set(alias, resolved);
    }
    return resolved;
  }

  registerPreferredToolCorrelationAlias(
    preferredCorrelationId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    const canonicalPreferred = this.resolveToolCorrelationId(preferredCorrelationId)
      ?? preferredCorrelationId;
    this.toolCorrelationAliases.set(canonicalPreferred, canonicalPreferred);

    for (const correlationId of correlationIds) {
      if (!correlationId) {
        continue;
      }
      const canonicalCorrelation = this.resolveToolCorrelationId(correlationId)
        ?? correlationId;
      if (canonicalCorrelation !== canonicalPreferred) {
        this.repointToolCorrelationAliases(canonicalCorrelation, canonicalPreferred);
      }
      this.toolCorrelationAliases.set(correlationId, canonicalPreferred);
    }
  }

  repointToolCorrelationAliases(
    fromCorrelationId: string,
    toCorrelationId: string,
  ): void {
    if (fromCorrelationId === toCorrelationId) {
      return;
    }
    for (const [aliasId, targetCorrelationId] of this.toolCorrelationAliases.entries()) {
      if (targetCorrelationId === fromCorrelationId) {
        this.toolCorrelationAliases.set(aliasId, toCorrelationId);
      }
    }
    this.toolCorrelationAliases.set(fromCorrelationId, toCorrelationId);
  }

  registerToolCorrelationAliases(
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    const canonicalToolId = this.resolveToolCorrelationId(toolId) ?? toolId;
    this.toolCorrelationAliases.set(canonicalToolId, canonicalToolId);
    for (const correlationId of correlationIds) {
      if (!correlationId || correlationId === canonicalToolId) {
        continue;
      }
      this.registerPreferredToolCorrelationAlias(canonicalToolId, correlationId);
    }
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

  recordPendingSubagentCorrelationId(correlationId: string): void {
    if (this.pendingSubagentCorrelationIds.includes(correlationId)) {
      return;
    }
    this.pendingSubagentCorrelationIds.push(correlationId);
  }

  removePendingSubagentCorrelationId(correlationId: string): void {
    this.pendingSubagentCorrelationIds = this.pendingSubagentCorrelationIds.filter(
      (candidate) => candidate !== correlationId,
    );
  }

  resolvePendingSubagentTaskCorrelation(taskCorrelationId: string): void {
    if (this.toolUseIdToSubagentId.has(taskCorrelationId)) {
      return;
    }
    for (const subagentCorrelationId of this.pendingSubagentCorrelationIds) {
      const canonicalSubagentCorrelationId = this.resolveToolCorrelationId(subagentCorrelationId)
        ?? subagentCorrelationId;
      const subagentId = this.toolUseIdToSubagentId.get(canonicalSubagentCorrelationId);
      if (!subagentId) {
        continue;
      }

      this.registerPreferredToolCorrelationAlias(taskCorrelationId, canonicalSubagentCorrelationId);
      this.toolUseIdToSubagentId.set(taskCorrelationId, subagentId);
      this.subagentIdToCorrelationId.set(subagentId, taskCorrelationId);
      this.removePendingTaskToolCorrelationId(taskCorrelationId);
      this.removePendingSubagentCorrelationId(subagentCorrelationId);
      return;
    }
  }

  resolveKnownSubagentCorrelation(
    subagentId: string,
    subagentSessionId: string | undefined,
  ): string | undefined {
    const byId = this.subagentIdToCorrelationId.get(subagentId);
    if (byId) {
      return this.resolveToolCorrelationId(byId);
    }
    if (subagentSessionId) {
      const bySession = this.subagentSessionToCorrelationId.get(subagentSessionId);
      if (bySession) {
        return this.resolveToolCorrelationId(bySession);
      }
    }
    return undefined;
  }

  buildTrackedToolStartKey(parentAgentId: string, toolId: string): string {
    return `${parentAgentId}::${toolId}`;
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

  queueEarlyToolEvent(
    key: string,
    toolId: string,
    toolName: string,
  ): void {
    const queue = this.earlyToolEvents.get(key) ?? [];
    if (queue.some((entry) => entry.toolId === toolId)) {
      return;
    }
    queue.push({ toolId, toolName });
    this.earlyToolEvents.set(key, queue);
  }

  removeEarlyToolEvent(
    key: string,
    toolId: string,
  ): void {
    const queue = this.earlyToolEvents.get(key);
    if (!queue) {
      return;
    }
    const nextQueue = queue.filter((entry) => entry.toolId !== toolId);
    if (nextQueue.length === 0) {
      this.earlyToolEvents.delete(key);
      return;
    }
    this.earlyToolEvents.set(key, nextQueue);
  }

  replayEarlyToolEvents(
    agentId: string,
    ...keys: Array<string | undefined>
  ): void {
    for (const key of keys) {
      if (!key) {
        continue;
      }
      const queue = this.earlyToolEvents.get(key);
      if (!queue) {
        continue;
      }
      for (const tool of queue) {
        const trackerKey = this.buildTrackedToolStartKey(agentId, tool.toolId);
        if (this.trackedToolStartKeys.has(trackerKey)) {
          continue;
        }
        this.trackedToolStartKeys.add(trackerKey);
        this.getSubagentTracker()?.onToolStart(agentId, tool.toolName);
      }
      this.earlyToolEvents.delete(key);
    }
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

  cleanupOrphanedTools(runId: number): void {
    // Sub-agent task tools are handled by flushOrphanedAgentCompletions.
    // Aborting them here would produce null toolResult values in the UI.
    const subagentToolIds = new Set(this.toolUseIdToSubagentId.keys());

    for (const [toolName, toolIds] of this.pendingToolIdsByName.entries()) {
      for (const toolId of toolIds) {
        if (subagentToolIds.has(toolId)) {
          continue;
        }
        const activeContext = this.activeSubagentToolsById.get(toolId);
        if (activeContext && this.getSubagentTracker()?.hasAgent(activeContext.parentAgentId)) {
          const trackerKey = this.buildTrackedToolStartKey(activeContext.parentAgentId, toolId);
          this.trackedToolStartKeys.delete(trackerKey);
          this.getSubagentTracker()?.onToolComplete(activeContext.parentAgentId);
        }
        const event: BusEvent<"stream.tool.complete"> = {
          type: "stream.tool.complete",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            toolId,
            toolName,
            toolResult: null,
            success: false,
            error: "Tool execution aborted",
            ...(activeContext ? { parentAgentId: activeContext.parentAgentId } : {}),
          },
        };
        this.bus.publish(event);
      }
    }

    // Preserve pending entries for sub-agent task tools so
    // flushOrphanedAgentCompletions can emit proper tool completions.
    for (const [toolName, toolIds] of this.pendingToolIdsByName.entries()) {
      const remaining = toolIds.filter(id => subagentToolIds.has(id));
      if (remaining.length > 0) {
        this.pendingToolIdsByName.set(toolName, remaining);
      } else {
        this.pendingToolIdsByName.delete(toolName);
      }
    }

    this.toolStartSignatureByToolId.clear();
    this.completedToolIds.clear();
    this.trackedToolStartKeys.clear();
    this.earlyToolEvents.clear();
    this.activeSubagentToolsById.clear();
  }

  flushOrphanedAgentCompletions(runId: number): void {
    const subagentTracker = this.getSubagentTracker();

    for (const [toolId, agentId] of this.toolUseIdToSubagentId) {
      // Emit the tool completion that cleanupOrphanedTools skipped.
      let toolName: string | undefined;
      for (const [name, ids] of this.pendingToolIdsByName) {
        if (ids.includes(toolId)) {
          toolName = name;
          break;
        }
      }
      if (toolName) {
        this.bus.publish({
          type: "stream.tool.complete",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            toolId,
            toolName,
            toolResult: null,
            success: true,
            sdkCorrelationId: toolId,
          },
        });
      }

      if (subagentTracker?.hasAgent(agentId)) {
        subagentTracker.removeAgent(agentId);
      }
      this.bus.publish({
        type: "stream.agent.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId,
          success: true,
        },
      });
    }

    this.pendingToolIdsByName.clear();
    this.toolUseIdToSubagentId.clear();
  }

  isTaskTool(toolName: string): boolean {
    return isBuiltInTaskTool(toolName);
  }

  normalizeToolName(value: unknown): string {
    return normalizeToolName(value);
  }
}
