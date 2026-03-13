import type { BusEvent } from "@/services/events/bus-events.ts";
import type {
  WorkflowRuntimeFeatureFlags,
  WorkflowRuntimeFeatureFlagOverrides,
} from "@/services/workflows/runtime-contracts.ts";
import { resolveWorkflowRuntimeFeatureFlags } from "@/services/workflows/runtime-contracts.ts";
import {
  asRecord,
  asString,
  createSessionErrorEvent,
  createSessionStartEvent,
  drainUnsubscribers,
  isBuiltInTaskTool,
  normalizeToolName,
} from "@/services/events/adapters/provider-shared.ts";
import type { OpenCodeChildSessionSync } from "@/services/events/adapters/providers/opencode/child-session-sync.ts";
import type {
  OpenCodeTaskToolMetadata,
  OpenCodeToolState,
} from "@/services/events/adapters/providers/opencode/tool-state.ts";

export type OpenCodeThinkingBlock = {
  startTime: number;
  sourceKey: string;
  eventSessionId: string;
  agentId?: string;
};

type OpenCodeAdapterSupportDependencies = {
  sessionId: string;
  busPublish: (event: BusEvent) => void;
  toolState: OpenCodeToolState;
  childSessionSync: OpenCodeChildSessionSync;
  getTextAccumulator: () => string;
  getOwnedSessionIds: () => Set<string>;
  getSubagentSessionToAgentId: () => Map<string, string>;
  thinkingBlocks: Map<string, OpenCodeThinkingBlock>;
};

export class OpenCodeAdapterSupport {
  constructor(private readonly deps: OpenCodeAdapterSupportDependencies) {}

  publishTextComplete(runId: number, messageId: string): void {
    this.deps.busPublish({
      type: "stream.text.complete",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        messageId,
        fullText: this.deps.getTextAccumulator(),
      },
    });
  }

  publishSessionIdle(runId: number, reason: string): void {
    this.deps.busPublish({
      type: "stream.session.idle",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: { reason },
    });
  }

  publishSessionStart(runId: number): void {
    this.deps.busPublish(createSessionStartEvent(this.deps.sessionId, runId));
  }

  publishSessionError(runId: number, error: unknown): void {
    this.deps.busPublish(createSessionErrorEvent(this.deps.sessionId, runId, error));
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

  extractTaskToolMetadata(
    toolInput: unknown,
    eventData?: Record<string, unknown>,
  ): OpenCodeTaskToolMetadata {
    return this.deps.toolState.extractTaskToolMetadata(toolInput, eventData);
  }

  mergeTaskToolMetadata(
    existing: OpenCodeTaskToolMetadata | undefined,
    incoming: OpenCodeTaskToolMetadata,
  ): OpenCodeTaskToolMetadata {
    return this.deps.toolState.mergeTaskToolMetadata(existing, incoming);
  }

  hasTaskDispatchDetails(toolInput: unknown): boolean {
    return this.deps.toolState.hasTaskDispatchDetails(toolInput);
  }

  buildToolStartSignature(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolMetadata: Record<string, unknown> | undefined,
    parentAgentId: string | undefined,
  ): string {
    return this.deps.toolState.buildToolStartSignature(
      toolName,
      toolInput,
      toolMetadata,
      parentAgentId,
    );
  }

  resolveToolCorrelationId(correlationId: string | undefined): string | undefined {
    return this.deps.toolState.resolveToolCorrelationId(correlationId);
  }

  registerPreferredToolCorrelationAlias(
    preferredCorrelationId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    this.deps.toolState.registerPreferredToolCorrelationAlias(
      preferredCorrelationId,
      ...correlationIds,
    );
  }

  repointToolCorrelationAliases(
    fromCorrelationId: string,
    toCorrelationId: string,
  ): void {
    this.deps.toolState.repointToolCorrelationAliases(fromCorrelationId, toCorrelationId);
  }

  registerToolCorrelationAliases(
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    this.deps.toolState.registerToolCorrelationAliases(toolId, ...correlationIds);
  }

  recordPendingTaskToolCorrelationId(correlationId: string): void {
    this.deps.toolState.recordPendingTaskToolCorrelationId(correlationId);
  }

  removePendingTaskToolCorrelationId(correlationId: string): void {
    this.deps.toolState.removePendingTaskToolCorrelationId(correlationId);
  }

  resolveNextPendingTaskToolCorrelationId(): string | undefined {
    return this.deps.toolState.resolveNextPendingTaskToolCorrelationId();
  }

  recordPendingSubagentCorrelationId(correlationId: string): void {
    this.deps.toolState.recordPendingSubagentCorrelationId(correlationId);
  }

  removePendingSubagentCorrelationId(correlationId: string): void {
    this.deps.toolState.removePendingSubagentCorrelationId(correlationId);
  }

  resolvePendingSubagentTaskCorrelation(taskCorrelationId: string): void {
    this.deps.toolState.resolvePendingSubagentTaskCorrelation(taskCorrelationId);
  }

  resolveKnownSubagentCorrelation(
    subagentId: string,
    subagentSessionId: string | undefined,
  ): string | undefined {
    return this.deps.toolState.resolveKnownSubagentCorrelation(subagentId, subagentSessionId);
  }

  buildTrackedToolStartKey(parentAgentId: string, toolId: string): string {
    return this.deps.toolState.buildTrackedToolStartKey(parentAgentId, toolId);
  }

  recordActiveSubagentToolContext(
    toolId: string,
    toolName: string,
    parentAgentId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    this.deps.toolState.recordActiveSubagentToolContext(
      toolId,
      toolName,
      parentAgentId,
      ...correlationIds,
    );
  }

  removeActiveSubagentToolContext(
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    this.deps.toolState.removeActiveSubagentToolContext(toolId, ...correlationIds);
  }

  queueEarlyToolEvent(key: string, toolId: string, toolName: string): void {
    this.deps.toolState.queueEarlyToolEvent(key, toolId, toolName);
  }

  removeEarlyToolEvent(key: string, toolId: string): void {
    this.deps.toolState.removeEarlyToolEvent(key, toolId);
  }

  replayEarlyToolEvents(agentId: string, ...keys: Array<string | undefined>): void {
    this.deps.toolState.replayEarlyToolEvents(agentId, ...keys);
  }

  registerTaskSubagentSessionCorrelation(
    taskCorrelationId: string,
    subagentSessionId: string | undefined,
  ): void {
    if (!subagentSessionId) {
      return;
    }
    this.deps.toolState.subagentSessionToCorrelationId.set(subagentSessionId, taskCorrelationId);
    const mappedAgentId = this.deps.toolState.toolUseIdToSubagentId.get(taskCorrelationId);
    if (!mappedAgentId) {
      return;
    }
    this.deps.getOwnedSessionIds().add(subagentSessionId);
    this.deps.getSubagentSessionToAgentId().set(subagentSessionId, mappedAgentId);
  }

  maybeHydrateTaskChildSession(
    runId: number,
    taskCorrelationId: string,
    childSessionId: string | undefined,
  ): void {
    this.deps.childSessionSync.maybeHydrateTaskChildSession(
      runId,
      taskCorrelationId,
      childSessionId,
    );
  }

  async hydrateCompletedTaskDispatch(
    runId: number,
    parentSessionId: string,
    taskCorrelationId: string,
    toolId: string,
    attributedParentAgentId: string | undefined,
  ): Promise<void> {
    await this.deps.childSessionSync.hydrateCompletedTaskDispatch(
      runId,
      parentSessionId,
      taskCorrelationId,
      toolId,
      attributedParentAgentId,
    );
  }

  createSyntheticToolId(runId: number, toolName: string): string {
    return this.deps.toolState.createSyntheticToolId(runId, toolName);
  }

  queueToolId(toolName: string, toolId: string): void {
    this.deps.toolState.queueToolId(toolName, toolId);
  }

  removeQueuedToolId(toolName: string, toolId: string): void {
    this.deps.toolState.removeQueuedToolId(toolName, toolId);
  }

  shiftQueuedToolId(toolName: string): string | undefined {
    return this.deps.toolState.shiftQueuedToolId(toolName);
  }

  resolveToolStartId(
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ): string {
    return this.deps.toolState.resolveToolStartId(explicitToolId, runId, toolName);
  }

  resolveToolCompleteId(
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ): string {
    return this.deps.toolState.resolveToolCompleteId(explicitToolId, runId, toolName);
  }

  cleanupOrphanedTools(runId: number): void {
    this.deps.toolState.cleanupOrphanedTools(runId);
  }

  flushOrphanedAgentCompletions(runId: number): void {
    this.deps.toolState.flushOrphanedAgentCompletions(runId);
  }

  cleanupSubscriptions(unsubscribers: Array<() => void>): Array<() => void> {
    const drained = drainUnsubscribers(unsubscribers);
    this.deps.childSessionSync.reset();
    return drained;
  }

  resolveRuntimeFeatureFlags(
    overrides: WorkflowRuntimeFeatureFlagOverrides | undefined,
  ): WorkflowRuntimeFeatureFlags {
    return resolveWorkflowRuntimeFeatureFlags(overrides);
  }

  buildThinkingBlockKey(
    sourceKey: string,
    eventSessionId: string,
    agentId: string | undefined,
  ): string {
    return `${eventSessionId}::${agentId ?? "__root__"}::${sourceKey}`;
  }

  getThinkingBlockKey(
    sourceKey: string,
    eventSessionId: string,
    agentId: string | undefined,
  ): string | undefined {
    const key = this.buildThinkingBlockKey(sourceKey, eventSessionId, agentId);
    return this.deps.thinkingBlocks.has(key) ? key : undefined;
  }

  ensureThinkingBlock(
    sourceKey: string,
    eventSessionId: string,
    agentId: string | undefined,
  ): void {
    const key = this.buildThinkingBlockKey(sourceKey, eventSessionId, agentId);
    if (!this.deps.thinkingBlocks.has(key)) {
      this.deps.thinkingBlocks.set(key, {
        startTime: Date.now(),
        sourceKey,
        eventSessionId,
        ...(agentId ? { agentId } : {}),
      });
    }
  }

  publishThinkingCompleteForScope(
    runId: number,
    eventSessionId: string,
    agentId: string | undefined,
  ): void {
    for (const [thinkingKey, block] of this.deps.thinkingBlocks.entries()) {
      if (block.eventSessionId !== eventSessionId) {
        continue;
      }
      if ((block.agentId ?? undefined) !== agentId) {
        continue;
      }
      this.deps.busPublish({
        type: "stream.thinking.complete",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          sourceKey: block.sourceKey,
          durationMs: Date.now() - block.startTime,
          ...(block.agentId ? { agentId: block.agentId } : {}),
        },
      });
      this.deps.thinkingBlocks.delete(thinkingKey);
    }
  }

  isOwnedSession(eventSessionId: string): boolean {
    return eventSessionId === this.deps.sessionId || this.deps.getOwnedSessionIds().has(eventSessionId);
  }

  resolveParentToolCorrelationId(data: Record<string, unknown>): string | undefined {
    return this.resolveToolCorrelationId(this.asString(
      data.parentToolUseId
        ?? data.parent_tool_use_id
        ?? data.parentToolUseID
        ?? data.parentToolCallId,
    ));
  }

  resolveParentAgentId(
    eventSessionId: string,
    data: Record<string, unknown>,
  ): string | undefined {
    const explicitParentAgentId = this.asString(data.parentAgentId ?? data.parentId);
    if (explicitParentAgentId) {
      return explicitParentAgentId;
    }
    if (eventSessionId !== this.deps.sessionId) {
      const mappedAgentId = this.deps.getSubagentSessionToAgentId().get(eventSessionId);
      if (mappedAgentId) {
        return mappedAgentId;
      }
    }
    const parentToolUseId = this.resolveParentToolCorrelationId(data);
    if (parentToolUseId) {
      const mappedAgentId = this.deps.toolState.toolUseIdToSubagentId.get(parentToolUseId);
      if (mappedAgentId) {
        return mappedAgentId;
      }
      return parentToolUseId;
    }
    if (eventSessionId === this.deps.sessionId) {
      return undefined;
    }
    const subagentCorrelationId = this.deps.toolState.subagentSessionToCorrelationId.get(eventSessionId);
    if (subagentCorrelationId) {
      const resolvedCorrelationId = this.resolveToolCorrelationId(subagentCorrelationId)
        ?? subagentCorrelationId;
      return this.deps.toolState.toolUseIdToSubagentId.get(resolvedCorrelationId) ?? resolvedCorrelationId;
    }
    return undefined;
  }
}
