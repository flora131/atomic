import type { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type {
  SDKStreamAdapter,
  StreamAdapterOptions,
} from "@/services/events/adapters/types.ts";
import type { WorkflowRuntimeFeatureFlags } from "@/services/workflows/runtime-contracts.ts";
import {
  DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
} from "@/services/workflows/runtime-contracts.ts";
import {
  createTurnMetadataState,
  normalizeTurnEndMetadata,
  normalizeTurnStartId,
  resetTurnMetadataState,
} from "@/services/events/adapters/task-turn-normalization.ts";
import {
  asRecord,
  asString,
  normalizeToolName,
} from "@/services/events/adapters/provider-shared.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import type {
  CodingAgentClient,
  Session,
} from "@/services/agents/types.ts";
import type { OpenCodeProviderEventSource } from "@/services/agents/provider-events.ts";
import {
  OpenCodeAdapterSupport,
  type OpenCodeThinkingBlock,
} from "@/services/events/adapters/providers/opencode/adapter-support.ts";
import { OpenCodeAuxEventHandlers } from "@/services/events/adapters/providers/opencode/aux-event-handlers.ts";
import { OpenCodeChildSessionSync } from "@/services/events/adapters/providers/opencode/child-session-sync.ts";
import {
  createOpenCodeProviderEventHandlers,
  subscribeOpenCodeProviderEvents,
} from "@/services/events/adapters/providers/opencode/handler-factory.ts";
import { OpenCodeStreamChunkProcessor } from "@/services/events/adapters/providers/opencode/stream-chunk-processor.ts";
import { runOpenCodeStreamingRuntime } from "@/services/events/adapters/providers/opencode/streaming-runtime.ts";
import { OpenCodeSubagentEventHandlers } from "@/services/events/adapters/providers/opencode/subagent-event-handlers.ts";
import { OpenCodeToolEventHandlers } from "@/services/events/adapters/providers/opencode/tool-event-handlers.ts";
import { OpenCodeToolState } from "@/services/events/adapters/providers/opencode/tool-state.ts";

const TOOL_START_PLACEHOLDER_SIGNATURE = "__placeholder__";

function createCorrelatingBus(
  bus: EventBus,
  getSupport: () => OpenCodeAdapterSupport,
): EventBus {
  return new Proxy(bus, {
    get(target, prop, receiver) {
      if (prop === "publish") {
        return (event: BusEvent) => getSupport().correlatingPublish(event);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export class OpenCodeStreamAdapter implements SDKStreamAdapter {
  private bus: EventBus;
  private correlatingBus: EventBus;
  private sessionId: string;
  private client?: CodingAgentClient;
  private abortController: AbortController | null = null;
  private textAccumulator = "";
  private unsubscribers: Array<() => void> = [];
  private toolState: OpenCodeToolState;
  private childSessionSync: OpenCodeChildSessionSync;
  private toolEventHandlers: OpenCodeToolEventHandlers;
  private auxEventHandlers: OpenCodeAuxEventHandlers;
  private subagentEventHandlers: OpenCodeSubagentEventHandlers;
  private streamChunkProcessor: OpenCodeStreamChunkProcessor;
  private support: OpenCodeAdapterSupport;
  private thinkingBlocks = new Map<string, OpenCodeThinkingBlock>();
  private ownedSessionIds = new Set<string>();
  private subagentSessionToAgentId = new Map<string, string>();
  private subagentTracker: SubagentToolTracker | null = null;
  private runtimeFeatureFlags: WorkflowRuntimeFeatureFlags = {
    ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  };
  private turnMetadataState = createTurnMetadataState();
  private lastSeenOutputTokens = 0;
  private accumulatedOutputTokens = 0;

  constructor(bus: EventBus, sessionId: string, client?: CodingAgentClient) {
    this.bus = bus;
    this.sessionId = sessionId;
    this.client = client;

    const correlatingBus = createCorrelatingBus(bus, () => this.support);
    this.correlatingBus = correlatingBus;
    this.toolState = new OpenCodeToolState(
      correlatingBus,
      sessionId,
      () => this.subagentTracker,
    );
    this.childSessionSync = new OpenCodeChildSessionSync({
      bus: correlatingBus,
      sessionId,
      getClient: () => this.client,
      taskToolMetadata: this.toolState.taskToolMetadata,
      toolUseIdToSubagentId: this.toolState.toolUseIdToSubagentId,
      toolStartSignatureByToolId: this.toolState.toolStartSignatureByToolId,
      completedToolIds: this.toolState.completedToolIds,
      resolveToolCorrelationId: (correlationId) => this.toolState.resolveToolCorrelationId(correlationId),
      normalizeToolName: (value) => normalizeToolName(value),
      asRecord: (value) => asRecord(value),
      asString: (value) => asString(value),
      buildToolStartSignature: (toolName, toolInput, toolMetadata, parentAgentId) =>
        this.toolState.buildToolStartSignature(toolName, toolInput, toolMetadata, parentAgentId),
      registerToolCorrelationAliases: (toolId, ...correlationIds) =>
        this.toolState.registerToolCorrelationAliases(toolId, ...correlationIds),
      recordActiveSubagentToolContext: (toolId, toolName, parentAgentId, ...correlationIds) =>
        this.toolState.recordActiveSubagentToolContext(toolId, toolName, parentAgentId, ...correlationIds),
      removeActiveSubagentToolContext: (toolId, ...correlationIds) =>
        this.toolState.removeActiveSubagentToolContext(toolId, ...correlationIds),
      registerTaskSubagentSessionCorrelation: (taskCorrelationId, subagentSessionId) =>
        this.support.registerTaskSubagentSessionCorrelation(taskCorrelationId, subagentSessionId),
    });
    this.support = new OpenCodeAdapterSupport({
      sessionId,
      busPublish: (event) => this.bus.publish(event),
      toolState: this.toolState,
      childSessionSync: this.childSessionSync,
      getTextAccumulator: () => this.textAccumulator,
      getOwnedSessionIds: () => this.ownedSessionIds,
      getSubagentSessionToAgentId: () => this.subagentSessionToAgentId,
      thinkingBlocks: this.thinkingBlocks,
    });
    this.toolEventHandlers = new OpenCodeToolEventHandlers({
      bus: correlatingBus,
      sessionId,
      taskPlaceholderSignature: TOOL_START_PLACEHOLDER_SIGNATURE,
      toolStartSignatureByToolId: this.toolState.toolStartSignatureByToolId,
      taskToolMetadata: this.toolState.taskToolMetadata,
      toolUseIdToSubagentId: this.toolState.toolUseIdToSubagentId,
      trackedToolStartKeys: this.toolState.trackedToolStartKeys,
      activeSubagentToolsById: this.toolState.activeSubagentToolsById,
      completedToolIds: this.toolState.completedToolIds,
      getSubagentTracker: () => this.subagentTracker,
      resolveParentToolCorrelationId: (data) => this.support.resolveParentToolCorrelationId(data),
      resolveParentAgentId: (eventSessionId, data) => this.support.resolveParentAgentId(eventSessionId, data),
      asString: (value) => this.support.asString(value),
      asRecord: (value) => this.support.asRecord(value),
      resolveToolCorrelationId: (correlationId) => this.support.resolveToolCorrelationId(correlationId),
      normalizeToolName: (value) => this.support.normalizeToolName(value),
      resolveToolStartId: (explicitToolId, runId, toolName) =>
        this.support.resolveToolStartId(explicitToolId, runId, toolName),
      resolveToolCompleteId: (explicitToolId, runId, toolName) =>
        this.support.resolveToolCompleteId(explicitToolId, runId, toolName),
      buildToolStartSignature: (toolName, toolInput, toolMetadata, parentAgentId) =>
        this.support.buildToolStartSignature(toolName, toolInput, toolMetadata, parentAgentId),
      hasTaskDispatchDetails: (toolInput) => this.support.hasTaskDispatchDetails(toolInput),
      isTaskTool: (toolName) => this.support.isTaskTool(toolName),
      removeQueuedToolId: (toolName, toolId) => this.support.removeQueuedToolId(toolName, toolId),
      registerToolCorrelationAliases: (toolId, ...correlationIds) =>
        this.support.registerToolCorrelationAliases(toolId, ...correlationIds),
      recordPendingTaskToolCorrelationId: (correlationId) =>
        this.support.recordPendingTaskToolCorrelationId(correlationId),
      extractTaskToolMetadata: (toolInput, eventData) =>
        this.support.extractTaskToolMetadata(toolInput, eventData),
      mergeTaskToolMetadata: (existing, incoming) =>
        this.support.mergeTaskToolMetadata(existing, incoming),
      resolvePendingSubagentTaskCorrelation: (taskCorrelationId) =>
        this.support.resolvePendingSubagentTaskCorrelation(taskCorrelationId),
      registerTaskSubagentSessionCorrelation: (taskCorrelationId, subagentSessionId) =>
        this.support.registerTaskSubagentSessionCorrelation(taskCorrelationId, subagentSessionId),
      maybeHydrateTaskChildSession: (runId, taskCorrelationId, childSessionId, _parentAgentId) =>
        this.support.maybeHydrateTaskChildSession(runId, taskCorrelationId, childSessionId),
      recordActiveSubagentToolContext: (toolId, toolName, parentAgentId, ...correlationIds) =>
        this.support.recordActiveSubagentToolContext(toolId, toolName, parentAgentId, ...correlationIds),
      buildTrackedToolStartKey: (parentAgentId, toolId) =>
        this.support.buildTrackedToolStartKey(parentAgentId, toolId),
      queueEarlyToolEvent: (key, toolId, toolName) =>
        this.support.queueEarlyToolEvent(key, toolId, toolName),
      removeActiveSubagentToolContext: (toolId, ...correlationIds) =>
        this.support.removeActiveSubagentToolContext(toolId, ...correlationIds),
      removeEarlyToolEvent: (key, toolId) => this.support.removeEarlyToolEvent(key, toolId),
      hydrateCompletedTaskDispatch: (runId, parentSessionId, taskCorrelationId, toolId, parentAgentId) =>
        this.support.hydrateCompletedTaskDispatch(
          runId,
          parentSessionId,
          taskCorrelationId,
          toolId,
          parentAgentId,
        ),
    });
    this.auxEventHandlers = new OpenCodeAuxEventHandlers({
      bus: correlatingBus,
      sessionId,
      isOwnedSession: (eventSessionId) => this.support.isOwnedSession(eventSessionId),
      resolveParentAgentId: (eventSessionId, data) => this.support.resolveParentAgentId(eventSessionId, data),
      resolveToolCorrelationId: (correlationId) => this.support.resolveToolCorrelationId(correlationId),
      asString: (value) => this.support.asString(value),
      activeSubagentToolsById: this.toolState.activeSubagentToolsById,
      getSubagentTracker: () => this.subagentTracker,
      getLastSeenOutputTokens: () => this.lastSeenOutputTokens,
      setLastSeenOutputTokens: (value) => {
        this.lastSeenOutputTokens = value;
      },
      getAccumulatedOutputTokens: () => this.accumulatedOutputTokens,
      setAccumulatedOutputTokens: (value) => {
        this.accumulatedOutputTokens = value;
      },
      buildTurnStartData: (data) => ({
        turnId: normalizeTurnStartId(data.turnId, this.turnMetadataState),
      }),
      buildTurnEndData: (data) => normalizeTurnEndMetadata(data, this.turnMetadataState),
    });
    this.subagentEventHandlers = new OpenCodeSubagentEventHandlers({
      bus: correlatingBus,
      sessionId,
      getSubagentTracker: () => this.subagentTracker,
      isOwnedSession: (eventSessionId) => this.support.isOwnedSession(eventSessionId),
      asString: (value) => this.support.asString(value),
      resolveToolCorrelationId: (correlationId) => this.support.resolveToolCorrelationId(correlationId),
      resolveKnownSubagentCorrelation: (subagentId, subagentSessionId) =>
        this.support.resolveKnownSubagentCorrelation(subagentId, subagentSessionId),
      taskToolMetadata: this.toolState.taskToolMetadata,
      getPendingTaskToolCorrelationIds: () => this.toolState.pendingTaskToolCorrelationIds,
      subagentIdToCorrelationId: this.toolState.subagentIdToCorrelationId,
      getOwnedSessionIds: () => this.ownedSessionIds,
      subagentSessionToAgentId: this.subagentSessionToAgentId,
      subagentSessionToCorrelationId: this.toolState.subagentSessionToCorrelationId,
      toolUseIdToSubagentId: this.toolState.toolUseIdToSubagentId,
      earlyToolEvents: this.toolState.earlyToolEvents as Map<string, Array<unknown>>,
      resolveNextPendingTaskToolCorrelationId: () => this.support.resolveNextPendingTaskToolCorrelationId(),
      registerPreferredToolCorrelationAlias: (preferredCorrelationId, ...correlationIds) =>
        this.support.registerPreferredToolCorrelationAlias(preferredCorrelationId, ...correlationIds),
      removePendingTaskToolCorrelationId: (correlationId) =>
        this.support.removePendingTaskToolCorrelationId(correlationId),
      recordPendingSubagentCorrelationId: (correlationId) =>
        this.support.recordPendingSubagentCorrelationId(correlationId),
      removePendingSubagentCorrelationId: (correlationId) =>
        this.support.removePendingSubagentCorrelationId(correlationId),
      replayEarlyToolEvents: (agentId, ...keys) => this.support.replayEarlyToolEvents(agentId, ...keys),
    });
    this.streamChunkProcessor = new OpenCodeStreamChunkProcessor({
      bus: correlatingBus,
      sessionId,
      getAbortSignal: () => this.abortController?.signal,
      getTextAccumulator: () => this.textAccumulator,
      setTextAccumulator: (value) => {
        this.textAccumulator = value;
      },
      thinkingBlocks: this.thinkingBlocks,
      ensureThinkingBlock: (sourceKey, eventSessionId, agentId) =>
        this.support.ensureThinkingBlock(sourceKey, eventSessionId, agentId),
      getThinkingBlockKey: (sourceKey, eventSessionId, agentId) =>
        this.support.getThinkingBlockKey(sourceKey, eventSessionId, agentId),
      publishTextComplete: (runId, messageId) => this.support.publishTextComplete(runId, messageId),
      asRecord: (value) => this.support.asRecord(value),
      asString: (value) => this.support.asString(value),
      normalizeToolName: (value) => this.support.normalizeToolName(value),
      resolveToolStartId: (explicitToolId, runId, toolName) =>
        this.support.resolveToolStartId(explicitToolId, runId, toolName),
      resolveToolCompleteId: (explicitToolId, runId, toolName) =>
        this.support.resolveToolCompleteId(explicitToolId, runId, toolName),
      removeActiveSubagentToolContext: (toolId, ...correlationIds) =>
        this.support.removeActiveSubagentToolContext(toolId, ...correlationIds),
    });
  }

  async startStreaming(
    session: Session,
    message: string,
    options: StreamAdapterOptions,
  ): Promise<void> {
    const { runId, messageId, runtimeFeatureFlags } = options;

    this.unsubscribers = this.support.cleanupSubscriptions(this.unsubscribers);
    this.abortController = new AbortController();
    this.textAccumulator = "";
    this.thinkingBlocks.clear();
    this.toolState.reset();
    this.childSessionSync.reset();
    this.ownedSessionIds = new Set([this.sessionId]);
    this.subagentSessionToAgentId.clear();
    this.subagentTracker = new SubagentToolTracker(this.correlatingBus, this.sessionId, runId);
    this.lastSeenOutputTokens = 0;
    this.accumulatedOutputTokens = 0;
    this.runtimeFeatureFlags = this.support.resolveRuntimeFeatureFlags(runtimeFeatureFlags);
    resetTurnMetadataState(this.turnMetadataState);

    this.support.publishSessionStart(runId);

    const client = this.client ?? (session as Session & { __client?: CodingAgentClient }).__client;
    const providerClient = client as (CodingAgentClient & OpenCodeProviderEventSource) | undefined;
    if (!providerClient || typeof providerClient.onProviderEvent !== "function") {
      throw new Error("OpenCode stream adapter requires provider event support.");
    }

    this.unsubscribers.push(
      subscribeOpenCodeProviderEvents({
        handlers: createOpenCodeProviderEventHandlers({
          auxEventHandlers: this.auxEventHandlers,
          messageId,
          publishThinkingCompleteForScope: (streamRunId, eventSessionId, agentId) => {
            if (!eventSessionId) {
              return;
            }
            this.support.publishThinkingCompleteForScope(streamRunId, eventSessionId, agentId);
          },
          runId,
          streamChunkProcessor: this.streamChunkProcessor,
          subagentEventHandlers: this.subagentEventHandlers,
          toolEventHandlers: this.toolEventHandlers,
        }),
        providerClient,
      }),
    );

    await runOpenCodeStreamingRuntime({
      cleanupOrphanedTools: (streamRunId) => this.support.cleanupOrphanedTools(streamRunId),
      flushOrphanedAgentCompletions: (streamRunId) => this.support.flushOrphanedAgentCompletions(streamRunId),
      getAbortController: () => this.abortController,
      getTextAccumulator: () => this.textAccumulator,
      message,
      options,
      processStreamChunk: (chunk, streamRunId, streamMessageId) => {
        this.streamChunkProcessor.process(chunk, streamRunId, streamMessageId);
      },
      providerClient,
      publishSessionError: (streamRunId, error) => this.support.publishSessionError(streamRunId, error),
      publishSessionIdle: (streamRunId, reason) => this.support.publishSessionIdle(streamRunId, reason),
      publishTextComplete: (streamRunId, streamMessageId) =>
        this.support.publishTextComplete(streamRunId, streamMessageId),
      publishToBus: (event) => this.support.correlatingPublish(event),
      pushUnsubscriber: (unsubscriber) => {
        this.unsubscribers.push(unsubscriber);
      },
      session,
      sessionId: this.sessionId,
    });
  }

  dispose(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.unsubscribers = this.support.cleanupSubscriptions(this.unsubscribers);
    this.textAccumulator = "";
    this.thinkingBlocks.clear();
    this.childSessionSync.reset();
    this.toolState.reset();
    this.ownedSessionIds.clear();
    this.subagentSessionToAgentId.clear();
    this.subagentTracker?.reset();
    this.subagentTracker = null;
    this.runtimeFeatureFlags = { ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS };
    resetTurnMetadataState(this.turnMetadataState);
    this.lastSeenOutputTokens = 0;
    this.accumulatedOutputTokens = 0;
  }
}
