import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type {
  AgentEvent,
  EventType,
} from "@/services/agents/types.ts";
import type {
  WorkflowRuntimeFeatureFlags,
  WorkflowRuntimeFeatureFlagOverrides,
} from "@/services/workflows/runtime-contracts.ts";
import { resolveWorkflowRuntimeFeatureFlags } from "@/services/workflows/runtime-contracts.ts";
import {
  asRecord,
  asString,
  drainUnsubscribers,
  isBuiltInTaskTool,
  normalizeToolName,
} from "@/services/events/adapters/provider-shared.ts";
import type {
  ClaudeActiveSubagentToolContext,
  ClaudeToolState,
} from "@/services/events/adapters/providers/claude/tool-state.ts";
import {
  correlate,
  type AdapterCorrelationContext,
} from "@/services/events/adapters/shared/adapter-correlation.ts";

type ClaudeAdapterSupportDependencies = {
  sessionId: string;
  busPublish: (event: BusEvent) => void;
  toolState: ClaudeToolState;
  getTextAccumulator: () => string;
};

export class ClaudeAdapterSupport {
  constructor(private readonly deps: ClaudeAdapterSupportDependencies) {}

  publishSessionStart(runId: number): void {
    this.deps.toolState.publishSessionStart(runId);
  }

  publishSessionIdle(
    runId: number,
    reason: "generator-complete" | "aborted" | "error",
  ): void {
    this.correlatingPublish({
      type: "stream.session.idle",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: { reason },
    });
  }

  publishSessionPartialIdle(
    runId: number,
    completionReason: string,
    activeBackgroundAgentCount: number,
  ): void {
    this.correlatingPublish({
      type: "stream.session.partial-idle",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: { completionReason, activeBackgroundAgentCount },
    });
  }

  publishTextComplete(runId: number, messageId: string): void {
    this.correlatingPublish({
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

  publishSessionError(runId: number, error: unknown): void {
    this.deps.toolState.publishSessionError(runId, error);
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

  resolveTaskOutputParentAgentId(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string | undefined {
    return this.deps.toolState.resolveTaskOutputParentAgentId(toolName, toolInput);
  }

  extractTaskToolMetadata(toolInput: unknown): { description: string; isBackground: boolean } {
    return this.deps.toolState.extractTaskToolMetadata(toolInput);
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

  resolveToolCorrelationId(correlationId: string | undefined): string | undefined {
    return this.deps.toolState.resolveToolCorrelationId(correlationId);
  }

  resolveTaskDispatchParentAgentId(correlationId: string | undefined): string | undefined {
    return this.deps.toolState.resolveTaskDispatchParentAgentId(correlationId);
  }

  resolveCanonicalAgentId(agentId: string | undefined): string | undefined {
    return this.deps.toolState.resolveCanonicalAgentId(agentId);
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

  getSyntheticAgentIdForAttribution(): string | undefined {
    return this.deps.toolState.getSyntheticAgentIdForAttribution();
  }

  resolveActiveSubagentToolContext(
    ...correlationIds: Array<string | undefined>
  ): ClaudeActiveSubagentToolContext | undefined {
    return this.deps.toolState.resolveActiveSubagentToolContext(...correlationIds);
  }

  resolveSoleActiveSubagentToolParentAgentId(): string | undefined {
    return this.deps.toolState.resolveSoleActiveSubagentToolParentAgentId();
  }

  publishSyntheticAgentStart(runId: number): void {
    this.deps.toolState.publishSyntheticAgentStart(runId);
  }

  publishSyntheticAgentComplete(
    runId: number,
    success: boolean,
    error?: string,
  ): void {
    this.deps.toolState.publishSyntheticAgentComplete(runId, success, error);
  }

  registerToolCorrelationAliases(
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    this.deps.toolState.registerToolCorrelationAliases(toolId, ...correlationIds);
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

  hasKnownSubagentId(subagentId: string): boolean {
    return this.deps.toolState.hasKnownSubagentId(subagentId);
  }

  resolveSoleActiveSubagentId(): string | undefined {
    return this.deps.toolState.resolveSoleActiveSubagentId();
  }

  resolveBackgroundAttributionFallbackAgentId(): string | undefined {
    return this.deps.toolState.resolveBackgroundAttributionFallbackAgentId();
  }

  cleanupOrphanedTools(runId: number): void {
    this.deps.toolState.cleanupOrphanedTools(runId);
  }

  flushOrphanedAgentCompletions(runId: number): void {
    this.deps.toolState.flushOrphanedAgentCompletions(runId);
  }

  cleanupSubscriptions(unsubscribers: Array<() => void>): Array<() => void> {
    return drainUnsubscribers(unsubscribers);
  }

  resolveRuntimeFeatureFlags(
    overrides: WorkflowRuntimeFeatureFlagOverrides | undefined,
  ): WorkflowRuntimeFeatureFlags {
    return resolveWorkflowRuntimeFeatureFlags(overrides);
  }

  resolveEventSessionId<T extends EventType>(event: AgentEvent<T>): string {
    const dataRecord = (
      typeof event.data === "object" && event.data !== null && !Array.isArray(event.data)
    )
      ? event.data as Record<string, unknown>
      : undefined;
    const nativeSessionId = this.asString(dataRecord?.nativeSessionId);
    // Auto-register the SDK's native session ID as owned when it originates
    // from our wrapper session. Without this, main-session tool events are
    // silently dropped by the isOwnedSession gate because the native ID
    // never appears in ownedSessionIds.
    if (nativeSessionId && event.sessionId === this.deps.sessionId) {
      this.deps.toolState.ownedSessionIds.add(nativeSessionId);
    }
    return nativeSessionId ?? event.sessionId;
  }

  isOwnedSession(eventSessionId: string): boolean {
    return this.deps.toolState.isOwnedSession(eventSessionId);
  }

  resolveSubagentSessionParentAgentId(eventSessionId: string): string | undefined {
    return this.deps.toolState.resolveSubagentSessionParentAgentId(eventSessionId);
  }

  /**
   * Build an AdapterCorrelationContext snapshot from the current tool state.
   *
   * The context captures:
   * - toolToAgent: maps tool IDs to their owning agent from activeSubagentToolsById
   * - subAgentTools: the set of tool IDs that belong to sub-agents
   * - mainAgentId: the synthetic foreground agent ID (if any)
   * - subagentRegistry: empty (workflow-level parent tracking is managed upstream)
   */
  buildCorrelationContext(): AdapterCorrelationContext {
    const toolToAgent = new Map<string, string>();
    const subAgentTools = new Set<string>();
    for (const [toolId, ctx] of this.deps.toolState.activeSubagentToolsById) {
      toolToAgent.set(toolId, ctx.parentAgentId);
      subAgentTools.add(toolId);
    }

    return {
      subagentRegistry: new Map(),
      toolToAgent,
      subAgentTools,
      mainAgentId: this.deps.toolState.getSyntheticAgentIdForAttribution() ?? null,
    };
  }

  /**
   * Publish a BusEvent after enriching it with correlation metadata.
   *
   * This is the preferred publish path for events that carry agent/tool
   * correlation (tool.start, tool.complete, agent lifecycle, text deltas, etc.).
   * Events arrive at the consumer pipeline pre-correlated, reducing work
   * in the downstream consumer pipeline.
   */
  correlatingPublish(event: BusEvent): void {
    const enriched = correlate(event, this.buildCorrelationContext());
    this.deps.busPublish(enriched);
  }
}
