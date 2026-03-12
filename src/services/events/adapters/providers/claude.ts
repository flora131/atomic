import type { EventBus } from "@/services/events/event-bus.ts";
import type { WorkflowRuntimeFeatureFlags } from "@/services/workflows/runtime-contracts.ts";
import {
  DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
} from "@/services/workflows/runtime-contracts.ts";
import type {
  SDKStreamAdapter,
  StreamAdapterOptions,
} from "@/services/events/adapters/types.ts";
import type {
  CodingAgentClient,
  Session,
} from "@/services/agents/types.ts";
import {
  createTurnMetadataState,
  normalizeTurnEndMetadata,
  normalizeTurnStartId,
  resetTurnMetadataState,
} from "@/services/events/adapters/task-turn-normalization.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import { ClaudeAdapterSupport } from "@/services/events/adapters/providers/claude/adapter-support.ts";
import { ClaudeAuxEventHandlers } from "@/services/events/adapters/providers/claude/aux-event-handlers.ts";
import {
  createClaudeProviderEventHandlerFactory,
  toClaudeAgentEvent,
} from "@/services/events/adapters/providers/claude/handler-factory.ts";
import { ClaudeStreamChunkProcessor } from "@/services/events/adapters/providers/claude/stream-chunk-processor.ts";
import { ClaudeSubagentEventHandlers } from "@/services/events/adapters/providers/claude/subagent-event-handlers.ts";
import { startClaudeStreaming } from "@/services/events/adapters/providers/claude/streaming-runtime.ts";
import { ClaudeToolHookHandlers } from "@/services/events/adapters/providers/claude/tool-hook-handlers.ts";
import { ClaudeToolState } from "@/services/events/adapters/providers/claude/tool-state.ts";

export class ClaudeStreamAdapter implements SDKStreamAdapter {
  private bus: EventBus;
  private sessionId: string;
  private client?: CodingAgentClient;
  private abortController: AbortController | null = null;
  private textAccumulator = "";
  private unsubscribers: Array<() => void> = [];
  private toolState: ClaudeToolState;
  private streamChunkProcessor: ClaudeStreamChunkProcessor;
  private toolHookHandlers: ClaudeToolHookHandlers;
  private auxEventHandlers: ClaudeAuxEventHandlers;
  private subagentEventHandlers: ClaudeSubagentEventHandlers;
  private support: ClaudeAdapterSupport;
  private thinkingStartTimes = new Map<string, number>();
  private accumulatedOutputTokens = 0;
  private subagentTracker: SubagentToolTracker | null = null;
  private preferClientToolHooks = false;
  private runtimeFeatureFlags: WorkflowRuntimeFeatureFlags = {
    ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  };
  private turnMetadataState = createTurnMetadataState();

  constructor(bus: EventBus, sessionId: string, client?: CodingAgentClient) {
    this.bus = bus;
    this.sessionId = sessionId;
    this.client = client;
    this.toolState = new ClaudeToolState(
      bus,
      sessionId,
      () => this.subagentTracker,
      () => this.textAccumulator,
    );
    this.support = new ClaudeAdapterSupport({
      sessionId,
      busPublish: (event) => this.bus.publish(event),
      toolState: this.toolState,
      getTextAccumulator: () => this.textAccumulator,
    });
    this.streamChunkProcessor = new ClaudeStreamChunkProcessor({
      bus,
      sessionId,
      getTextAccumulator: () => this.textAccumulator,
      setTextAccumulator: (value) => {
        this.textAccumulator = value;
      },
      preferClientToolHooks: () => this.preferClientToolHooks,
      taskToolMetadata: this.toolState.taskToolMetadata,
      toolUseIdToSubagentId: this.toolState.toolUseIdToSubagentId,
      activeSubagentToolsById: this.toolState.activeSubagentToolsById,
      setCurrentBackgroundAttributionAgentId: (value) => {
        this.toolState.currentBackgroundAttributionAgentId = value;
      },
      resolveToolCorrelationId: (correlationId) => this.support.resolveToolCorrelationId(correlationId),
      asString: (value) => this.support.asString(value),
      asRecord: (value) => this.support.asRecord(value),
      normalizeToolName: (value) => this.support.normalizeToolName(value),
      resolveToolStartId: (explicitToolId, runId, toolName) =>
        this.support.resolveToolStartId(explicitToolId, runId, toolName),
      resolveToolCompleteId: (explicitToolId, runId, toolName) =>
        this.support.resolveToolCompleteId(explicitToolId, runId, toolName),
      isTaskTool: (toolName) => this.support.isTaskTool(toolName),
      extractTaskToolMetadata: (toolInput) => this.support.extractTaskToolMetadata(toolInput),
      recordPendingTaskToolCorrelationId: (correlationId) =>
        this.support.recordPendingTaskToolCorrelationId(correlationId),
      resolveTaskOutputParentAgentId: (toolName, toolInput) =>
        this.support.resolveTaskOutputParentAgentId(toolName, toolInput),
      resolveSoleActiveSubagentId: () => this.support.resolveSoleActiveSubagentId(),
      resolveBackgroundAttributionFallbackAgentId: () =>
        this.support.resolveBackgroundAttributionFallbackAgentId(),
      resolveSoleActiveSubagentToolParentAgentId: () =>
        this.support.resolveSoleActiveSubagentToolParentAgentId(),
      recordActiveSubagentToolContext: (toolId, toolName, parentAgentId, ...correlationIds) =>
        this.support.recordActiveSubagentToolContext(toolId, toolName, parentAgentId, ...correlationIds),
      removeActiveSubagentToolContext: (toolId, ...correlationIds) =>
        this.support.removeActiveSubagentToolContext(toolId, ...correlationIds),
      resolveActiveSubagentToolContext: (...correlationIds) =>
        this.support.resolveActiveSubagentToolContext(...correlationIds),
      getSubagentTracker: () => this.subagentTracker,
    });
    this.toolHookHandlers = new ClaudeToolHookHandlers({
      bus,
      sessionId,
      taskToolMetadata: this.toolState.taskToolMetadata,
      emittedToolStartCorrelationIds: this.toolState.emittedToolStartCorrelationIds,
      toolUseIdToSubagentId: this.toolState.toolUseIdToSubagentId,
      getSubagentTracker: () => this.subagentTracker,
      isOwnedSession: (eventSessionId) => this.support.isOwnedSession(eventSessionId),
      resolveEventSessionId: (event) => this.support.resolveEventSessionId(event),
      resolveToolCorrelationId: (correlationId) => this.support.resolveToolCorrelationId(correlationId),
      asString: (value) => this.support.asString(value),
      asRecord: (value) => this.support.asRecord(value),
      resolveSubagentSessionParentAgentId: (eventSessionId) =>
        this.support.resolveSubagentSessionParentAgentId(eventSessionId),
      resolveTaskDispatchParentAgentId: (toolUseId) =>
        this.support.resolveTaskDispatchParentAgentId(toolUseId),
      normalizeToolName: (value) => this.support.normalizeToolName(value),
      isTaskTool: (toolName) => this.support.isTaskTool(toolName),
      extractTaskToolMetadata: (toolInput) => this.support.extractTaskToolMetadata(toolInput),
      recordPendingTaskToolCorrelationId: (correlationId) =>
        this.support.recordPendingTaskToolCorrelationId(correlationId),
      resolveToolStartId: (explicitToolId, runId, toolName) =>
        this.support.resolveToolStartId(explicitToolId, runId, toolName),
      registerToolCorrelationAliases: (toolId, ...correlationIds) =>
        this.support.registerToolCorrelationAliases(toolId, ...correlationIds),
      recordActiveSubagentToolContext: (toolId, toolName, parentAgentId, ...correlationIds) =>
        this.support.recordActiveSubagentToolContext(toolId, toolName, parentAgentId, ...correlationIds),
      queueEarlyToolStart: (key, event) => this.toolState.queueEarlyToolStart(key, event),
      resolveToolCompleteId: (explicitToolId, runId, toolName) =>
        this.support.resolveToolCompleteId(explicitToolId, runId, toolName),
      resolveActiveSubagentToolContext: (...correlationIds) =>
        this.support.resolveActiveSubagentToolContext(...correlationIds),
      removeActiveSubagentToolContext: (toolId, ...correlationIds) =>
        this.support.removeActiveSubagentToolContext(toolId, ...correlationIds),
      resolveCanonicalAgentId: (value) => this.support.resolveCanonicalAgentId(value),
      resolveTaskOutputParentAgentId: (toolName, toolInput) =>
        this.support.resolveTaskOutputParentAgentId(toolName, toolInput),
      setCurrentBackgroundAttributionAgentId: (value) => {
        this.toolState.currentBackgroundAttributionAgentId = value;
      },
      resolveSoleActiveSubagentId: () => this.support.resolveSoleActiveSubagentId(),
      resolveBackgroundAttributionFallbackAgentId: () =>
        this.support.resolveBackgroundAttributionFallbackAgentId(),
      resolveSoleActiveSubagentToolParentAgentId: () =>
        this.support.resolveSoleActiveSubagentToolParentAgentId(),
      getSyntheticAgentIdForAttribution: () => this.support.getSyntheticAgentIdForAttribution(),
    });
    this.auxEventHandlers = new ClaudeAuxEventHandlers({
      bus,
      sessionId,
      resolveEventSessionId: (event) => this.support.resolveEventSessionId(event),
      resolveSubagentSessionParentAgentId: (eventSessionId) =>
        this.support.resolveSubagentSessionParentAgentId(eventSessionId),
      resolveTaskDispatchParentAgentId: (toolUseId) =>
        this.support.resolveTaskDispatchParentAgentId(toolUseId),
      resolveToolCorrelationId: (correlationId) => this.support.resolveToolCorrelationId(correlationId),
      asString: (value) => this.support.asString(value),
      isOwnedSession: (eventSessionId) => this.support.isOwnedSession(eventSessionId),
      getSyntheticAgentIdForAttribution: () => this.support.getSyntheticAgentIdForAttribution(),
      thinkingStartTimes: this.thinkingStartTimes,
      buildTurnStartData: (data) => ({
        turnId: normalizeTurnStartId(data.turnId, this.turnMetadataState),
      }),
      buildTurnEndData: (data) => normalizeTurnEndMetadata(data, this.turnMetadataState),
      activeSubagentToolsById: this.toolState.activeSubagentToolsById,
      getSubagentTracker: () => this.subagentTracker,
    });
    this.subagentEventHandlers = new ClaudeSubagentEventHandlers({
      bus,
      sessionId,
      getSubagentTracker: () => this.subagentTracker,
      resolveEventSessionId: (event) => this.support.resolveEventSessionId(event),
      getSyntheticForegroundAgent: () => this.toolState.syntheticForegroundAgent,
      publishSyntheticAgentComplete: (runId, success, error) =>
        this.support.publishSyntheticAgentComplete(runId, success, error),
      asString: (value) => this.support.asString(value),
      resolveToolCorrelationId: (correlationId) => this.support.resolveToolCorrelationId(correlationId),
      hasKnownSubagentId: (subagentId) => this.support.hasKnownSubagentId(subagentId),
      taskToolMetadata: this.toolState.taskToolMetadata,
      getPendingTaskToolCorrelationIds: () => this.toolState.pendingTaskToolCorrelationIds,
      resolveNextPendingTaskToolCorrelationId: () => this.support.resolveNextPendingTaskToolCorrelationId(),
      activeSubagentIds: this.toolState.activeSubagentIds,
      nativeSubagentIdToAgentId: this.toolState.nativeSubagentIdToAgentId,
      getOwnedSessionIds: () => this.toolState.ownedSessionIds,
      subagentSessionToAgentId: this.toolState.subagentSessionToAgentId,
      activeSubagentBackgroundById: this.toolState.activeSubagentBackgroundById,
      getCurrentBackgroundAttributionAgentId: () => this.toolState.currentBackgroundAttributionAgentId,
      setCurrentBackgroundAttributionAgentId: (value) => {
        this.toolState.currentBackgroundAttributionAgentId = value;
      },
      toolUseIdToSubagentId: this.toolState.toolUseIdToSubagentId,
      removePendingTaskToolCorrelationId: (correlationId) =>
        this.support.removePendingTaskToolCorrelationId(correlationId),
      earlyToolEvents: this.toolState.earlyToolEvents,
      replayEarlyToolStart: (parentAgentId, event, runId) =>
        this.toolState.replayEarlyToolStart(parentAgentId, event, runId),
      resolveCanonicalAgentId: (agentId) => this.support.resolveCanonicalAgentId(agentId),
      resolveBackgroundAttributionFallbackAgentId: () =>
        this.support.resolveBackgroundAttributionFallbackAgentId(),
    });
  }

  async startStreaming(
    session: Session,
    message: string,
    options: StreamAdapterOptions,
  ): Promise<void> {
    const createHandler = createClaudeProviderEventHandlerFactory({
      auxEventHandlers: this.auxEventHandlers,
      busPublish: (event) => this.bus.publish(event),
      getAccumulatedOutputTokens: () => this.accumulatedOutputTokens,
      sessionId: this.sessionId,
      setAccumulatedOutputTokens: (value) => {
        this.accumulatedOutputTokens = value;
      },
      subagentEventHandlers: this.subagentEventHandlers,
      toolHookHandlers: this.toolHookHandlers,
    });

    await startClaudeStreaming({
      session,
      message,
      options,
      client: this.client,
      sessionId: this.sessionId,
      busPublish: (event) => this.bus.publish(event),
      getAbortController: () => this.abortController,
      setAbortController: (controller) => {
        this.abortController = controller;
      },
      getUnsubscribers: () => this.unsubscribers,
      setUnsubscribers: (unsubscribers) => {
        this.unsubscribers = unsubscribers;
      },
      cleanupSubscriptions: (unsubscribers) => this.support.cleanupSubscriptions(unsubscribers),
      getTextAccumulator: () => this.textAccumulator,
      setTextAccumulator: (value) => {
        this.textAccumulator = value;
      },
      resetToolState: () => this.toolState.reset(),
      clearThinkingStartTimes: () => this.thinkingStartTimes.clear(),
      setSyntheticForegroundAgent: (value) => {
        this.toolState.syntheticForegroundAgent = value;
      },
      setAccumulatedOutputTokens: (value) => {
        this.accumulatedOutputTokens = value;
      },
      createSubagentTracker: (runId) => {
        this.subagentTracker = new SubagentToolTracker(this.bus, this.sessionId, runId);
      },
      setPreferClientToolHooks: (value) => {
        this.preferClientToolHooks = value;
      },
      resolveRuntimeFeatureFlags: (value) => this.support.resolveRuntimeFeatureFlags(value),
      setRuntimeFeatureFlags: (value) => {
        this.runtimeFeatureFlags = value;
      },
      resetTurnMetadataState: () => {
        resetTurnMetadataState(this.turnMetadataState);
      },
      publishSessionStart: (runId) => this.support.publishSessionStart(runId),
      publishSyntheticAgentStart: (runId) => this.support.publishSyntheticAgentStart(runId),
      publishSyntheticAgentComplete: (runId, success, error) =>
        this.support.publishSyntheticAgentComplete(runId, success, error),
      publishTextComplete: (runId, messageId) => this.support.publishTextComplete(runId, messageId),
      publishSessionError: (runId, error) => this.support.publishSessionError(runId, error),
      cleanupOrphanedTools: (runId) => this.support.cleanupOrphanedTools(runId),
      publishSessionIdle: (runId, reason) => this.support.publishSessionIdle(runId, reason),
      processStreamChunk: (chunk, runId, messageId) => {
        this.streamChunkProcessor.process(chunk, runId, messageId);
      },
      createAgentEvent: (event) => toClaudeAgentEvent(event),
      createHandler,
    });
  }

  dispose(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.unsubscribers = this.support.cleanupSubscriptions(this.unsubscribers);
    this.textAccumulator = "";
    this.thinkingStartTimes.clear();
    this.toolState.reset();
    this.toolState.ownedSessionIds.clear();
    this.accumulatedOutputTokens = 0;
    this.runtimeFeatureFlags = { ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS };
    resetTurnMetadataState(this.turnMetadataState);
    this.subagentTracker?.reset();
    this.subagentTracker = null;
  }
}
