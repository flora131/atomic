/**
 * Claude SDK Stream Adapter
 *
 * Consumes streaming events from the Claude Agent SDK's AsyncIterable stream
 * and publishes them to the event bus as normalized BusEvents.
 *
 * Key responsibilities:
 * - Consume session.stream() AsyncIterable from Claude SDK
 * - Map Claude SDK AgentMessage types to BusEvent types
 * - Handle text deltas, thinking deltas, and thinking completion
 * - Support cancellation via AbortController
 * - Publish events directly to the event bus (no batching)
 *
 * Event mapping:
 * - AgentMessage (type: "text") → stream.text.delta
 * - AgentMessage (type: "thinking") with content → stream.thinking.delta
 * - AgentMessage (type: "thinking") with metadata.streamingStats → stream.thinking.complete
 * - Stream completion → stream.text.complete
 *
 * All SDK event types (text, thinking, tool, agent) are handled within the adapter.
 *
 * Usage:
 * ```typescript
 * const adapter = new ClaudeStreamAdapter(eventBus, sessionId);
 * await adapter.startStreaming(session, message, { runId, messageId });
 * adapter.dispose(); // Cancel and cleanup
 * ```
 */

import type { EventBus } from "../event-bus.ts";
import type { BusEvent } from "../bus-events.ts";
import type {
  WorkflowRuntimeFeatureFlags,
  WorkflowRuntimeFeatureFlagOverrides,
} from "../../workflows/runtime-contracts.ts";
import {
  DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  resolveWorkflowRuntimeFeatureFlags,
} from "../../workflows/runtime-contracts.ts";
import type {
  SDKStreamAdapter,
  StreamAdapterOptions,
} from "./types.ts";
import type {
  CodingAgentClient,
  Session,
  AgentMessage,
  EventHandler,
  SessionIdleEventData,
  SessionErrorEventData,
  SessionInfoEventData,
  SessionWarningEventData,
  SessionTitleChangedEventData,
  SessionTruncationEventData,
  SessionCompactionEventData,
  ToolStartEventData,
  ToolCompleteEventData,
  ToolPartialResultEventData,
  SubagentStartEventData,
  SubagentCompleteEventData,
  SubagentUpdateEventData,
  PermissionRequestedEventData,
  HumanInputRequiredEventData,
  SkillInvokedEventData,
  ReasoningDeltaEventData,
  ReasoningCompleteEventData,
  TurnStartEventData,
  TurnEndEventData,
} from "../../sdk/types.ts";
import {
  createTurnMetadataState,
  normalizeAgentTaskMetadata,
  normalizeTurnEndMetadata,
  normalizeTurnStartId,
  resetTurnMetadataState,
} from "./task-turn-normalization.ts";
import { SubagentToolTracker } from "./subagent-tool-tracker.ts";
import { classifyError, computeDelay, retrySleep, DEFAULT_MAX_RETRIES } from "./retry.ts";

const DEFAULT_SUBAGENT_TASK_LABEL = "sub-agent task";

function isGenericSubagentTaskLabel(task: string | undefined): boolean {
  const normalized = (task ?? "").trim().toLowerCase();
  return normalized === "" || normalized === DEFAULT_SUBAGENT_TASK_LABEL || normalized === "subagent task";
}

function resolveAgentOnlyTaskLabel(message: string, agentName: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return agentName;
  }
  return trimmed;
}

/**
 * Stream adapter for Claude Agent SDK.
 *
 * Consumes the AsyncIterable stream from session.stream() and publishes
 * normalized BusEvents to the event bus.
 */
export class ClaudeStreamAdapter implements SDKStreamAdapter {
  private bus: EventBus;
  private sessionId: string;
  private client?: CodingAgentClient;
  private abortController: AbortController | null = null;
  private textAccumulator = "";
  private unsubscribers: Array<() => void> = [];
  /** Tracks thinking source start times for duration computation */
  private thinkingStartTimes = new Map<string, number>();
  private pendingToolIdsByName = new Map<string, string[]>();
  private toolCorrelationAliases = new Map<string, string>();
  /** Maps task-tool correlation ID -> task metadata for subagent label hydration */
  private taskToolMetadata = new Map<string, { description: string; isBackground: boolean }>();
  /** Ordered task tool IDs awaiting subagent.start correlation fallback */
  private pendingTaskToolCorrelationIds: string[] = [];
  /** Buffers tool events that arrive before parent subagent registration */
  private earlyToolEvents = new Map<string, Array<{ toolName: string }>>();
  /** Active native sub-agent IDs for fallback attribution when tool hooks are unscoped */
  private activeSubagentIds = new Set<string>();
  /** Active sub-agent background mode by agent ID */
  private activeSubagentBackgroundById = new Map<string, boolean>();
  /** Sticky fallback for unscoped background tool events */
  private currentBackgroundAttributionAgentId: string | null = null;
  /** Active sub-agent tool contexts keyed by tool correlation ID */
  private activeSubagentToolsById = new Map<string, { parentAgentId: string; toolName: string }>();
  /** Sessions owned by this run (parent + discovered child sessions) */
  private ownedSessionIds = new Set<string>();
  /** Maps sub-agent child session IDs to agent IDs */
  private subagentSessionToAgentId = new Map<string, string>();
  /** Maps task-tool correlation ID -> subagentId */
  private toolUseIdToSubagentId = new Map<string, string>();
  /** Synthetic foreground agent context used for Claude @agent agent-only streams */
  private syntheticForegroundAgent:
    | {
        id: string;
        name: string;
        task: string;
        started: boolean;
        completed: boolean;
        sawNativeSubagentStart: boolean;
      }
    | null = null;
  private syntheticToolCounter = 0;
  private accumulatedOutputTokens = 0;
  private subagentTracker: SubagentToolTracker | null = null;
  /** Prefer client hook tool events over stream-chunk tool events when available. */
  private preferClientToolHooks = false;
  private runtimeFeatureFlags: WorkflowRuntimeFeatureFlags = {
    ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  };
  private turnMetadataState = createTurnMetadataState();

  /**
   * Create a new Claude stream adapter.
   *
   * @param bus - The event bus to publish events to
   * @param sessionId - Session ID for event correlation
   */
  constructor(bus: EventBus, sessionId: string, client?: CodingAgentClient) {
    this.bus = bus;
    this.sessionId = sessionId;
    this.client = client;
  }

  /**
   * Start consuming the Claude SDK stream and publishing BusEvents.
   *
   * This method will:
   * 1. Iterate over the AsyncIterable stream from session.stream()
   * 2. Map each AgentMessage to the appropriate BusEvent
   * 3. Publish events directly to the bus
   * 4. Complete with a stream.text.complete event
   *
   * @param session - Active Claude SDK session
   * @param message - User message to stream
   * @param options - Stream options (runId, messageId, agent)
   */
  async startStreaming(
    session: Session,
    message: string,
    options: StreamAdapterOptions,
  ): Promise<void> {
    const { runId, messageId, agent, runtimeFeatureFlags } = options;

    // Clean up any existing subscriptions from a previous startStreaming() call
    // to prevent subscription accumulation on re-entry without dispose()
    this.cleanupSubscriptions();

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Reset text accumulator
    this.textAccumulator = "";
    this.thinkingStartTimes.clear();
    this.pendingToolIdsByName.clear();
    this.toolCorrelationAliases.clear();
    this.taskToolMetadata.clear();
    this.pendingTaskToolCorrelationIds = [];
    this.earlyToolEvents.clear();
    this.activeSubagentIds.clear();
    this.activeSubagentBackgroundById.clear();
    this.currentBackgroundAttributionAgentId = null;
    this.activeSubagentToolsById.clear();
    this.ownedSessionIds = new Set([this.sessionId]);
    this.subagentSessionToAgentId.clear();
    this.toolUseIdToSubagentId.clear();
    this.syntheticForegroundAgent = agent
      ? {
          id: `agent-only-${messageId}`,
          name: agent,
          task: resolveAgentOnlyTaskLabel(message, agent),
          started: false,
          completed: false,
          sawNativeSubagentStart: false,
        }
      : null;
    this.syntheticToolCounter = 0;
    this.accumulatedOutputTokens = 0;
    this.subagentTracker = new SubagentToolTracker(this.bus, this.sessionId, runId);
    this.preferClientToolHooks = false;
    this.runtimeFeatureFlags = this.resolveRuntimeFeatureFlags(runtimeFeatureFlags);
    resetTurnMetadataState(this.turnMetadataState);

    this.publishSessionStart(runId);
    this.publishSyntheticAgentStart(runId);

    const client = this.client ?? (session as Session & { __client?: CodingAgentClient }).__client;
    if (client && typeof client.on === "function") {
      this.preferClientToolHooks = true;
      const unsubToolStart = client.on(
        "tool.start",
        this.createToolStartHandler(runId),
      );
      this.unsubscribers.push(unsubToolStart);

      const unsubToolComplete = client.on(
        "tool.complete",
        this.createToolCompleteHandler(runId),
      );
      this.unsubscribers.push(unsubToolComplete);

      // Subscribe to subagent lifecycle events from SDK hooks
      const unsubSubagentStart = client.on(
        "subagent.start",
        this.createSubagentStartHandler(runId),
      );
      this.unsubscribers.push(unsubSubagentStart);

      const unsubSubagentComplete = client.on(
        "subagent.complete",
        this.createSubagentCompleteHandler(runId),
      );
      this.unsubscribers.push(unsubSubagentComplete);

      // Subscribe to subagent.update events (tool progress for sub-agents)
      const unsubAgentUpdate = client.on(
        "subagent.update",
        this.createSubagentUpdateHandler(runId),
      );
      this.unsubscribers.push(unsubAgentUpdate);

      const unsubIdle = client.on(
        "session.idle",
        this.createSessionIdleHandler(runId),
      );
      this.unsubscribers.push(unsubIdle);

      const unsubSessionError = client.on(
        "session.error",
        this.createSessionErrorHandler(runId),
      );
      this.unsubscribers.push(unsubSessionError);

      const unsubUsage = client.on(
        "usage",
        this.createUsageHandler(runId),
      );
      this.unsubscribers.push(unsubUsage);

      // Subscribe to permission request events (HITL)
      const unsubPermission = client.on(
        "permission.requested",
        this.createPermissionRequestedHandler(runId),
      );
      this.unsubscribers.push(unsubPermission);

      const unsubHumanInput = client.on(
        "human_input_required",
        this.createHumanInputRequiredHandler(runId),
      );
      this.unsubscribers.push(unsubHumanInput);

      const unsubSkillInvoked = client.on(
        "skill.invoked",
        this.createSkillInvokedHandler(runId),
      );
      this.unsubscribers.push(unsubSkillInvoked);

      const unsubReasoningDelta = client.on(
        "reasoning.delta",
        this.createReasoningDeltaHandler(runId, messageId),
      );
      this.unsubscribers.push(unsubReasoningDelta);

      const unsubReasoningComplete = client.on(
        "reasoning.complete",
        this.createReasoningCompleteHandler(runId),
      );
      this.unsubscribers.push(unsubReasoningComplete);

      const unsubTurnStart = client.on(
        "turn.start",
        this.createTurnStartHandler(runId),
      );
      this.unsubscribers.push(unsubTurnStart);

      const unsubTurnEnd = client.on(
        "turn.end",
        this.createTurnEndHandler(runId),
      );
      this.unsubscribers.push(unsubTurnEnd);

      const unsubToolPartialResult = client.on(
        "tool.partial_result",
        this.createToolPartialResultHandler(runId),
      );
      this.unsubscribers.push(unsubToolPartialResult);

      const unsubSessionInfo = client.on(
        "session.info",
        this.createSessionInfoHandler(runId),
      );
      this.unsubscribers.push(unsubSessionInfo);

      const unsubSessionWarning = client.on(
        "session.warning",
        this.createSessionWarningHandler(runId),
      );
      this.unsubscribers.push(unsubSessionWarning);

      const unsubSessionTitleChanged = client.on(
        "session.title_changed",
        this.createSessionTitleChangedHandler(runId),
      );
      this.unsubscribers.push(unsubSessionTitleChanged);

      const unsubSessionTruncation = client.on(
        "session.truncation",
        this.createSessionTruncationHandler(runId),
      );
      this.unsubscribers.push(unsubSessionTruncation);

      const unsubSessionCompaction = client.on(
        "session.compaction",
        this.createSessionCompactionHandler(runId),
      );
      this.unsubscribers.push(unsubSessionCompaction);
    }

    try {
      // Retry loop for transient failures (429, 503, ECONNRESET, etc.)
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
        try {
          // Start streaming from the Claude SDK
          const stream = session.stream(message, agent ? { agent } : undefined);

          // Iterate over the AsyncIterable stream
          for await (const chunk of stream) {
            // Check for cancellation
            if (this.abortController.signal.aborted) {
              break;
            }

            this.processStreamChunk(chunk, runId, messageId);
          }

          // Publish stream.text.complete event if we accumulated any text
          if (this.textAccumulator.length > 0) {
            this.publishTextComplete(runId, messageId);
          }
          this.publishSyntheticAgentComplete(runId, true);

          // Stream completed successfully — exit retry loop
          lastError = null;
          break;
        } catch (error) {
          lastError = error;

          // Don't retry aborted requests
          if (this.abortController?.signal.aborted) break;

          const classified = classifyError(error);
          if (!classified.isRetryable || attempt >= DEFAULT_MAX_RETRIES) break;

          const delay = computeDelay(attempt, classified);
          const retryEvent: BusEvent<"stream.session.retry"> = {
            type: "stream.session.retry",
            sessionId: this.sessionId,
            runId,
            timestamp: Date.now(),
            data: {
              attempt,
              delay,
              message: `${classified.message} — retrying in ${Math.ceil(delay / 1000)}s`,
              nextRetryAt: Date.now() + delay,
            },
          };
          this.bus.publish(retryEvent);

          // Reset accumulated state for retry
          this.textAccumulator = "";

          await retrySleep(delay, this.abortController.signal);
        }
      }

      // If we exhausted retries or hit a non-retryable error, rethrow
      if (lastError) throw lastError;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Handle stream errors
      if (this.abortController && !this.abortController.signal.aborted) {
        this.publishSessionError(runId, error);
        // Publish session.idle after error so the UI can finalize
        // (matches OpenCode adapter pattern for consistent state transitions)
        const idleEvent: BusEvent<"stream.session.idle"> = {
          type: "stream.session.idle",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: { reason: "error" },
        };
        this.bus.publish(idleEvent);
      }
      this.publishSyntheticAgentComplete(runId, false, errorMessage);
    } finally {
      if (this.abortController?.signal.aborted) {
        this.publishSyntheticAgentComplete(runId, false, "Tool execution aborted");
      }
      // Force-complete any tools still pending/running — prevents orphaned tool state
      this.cleanupOrphanedTools(runId);
      // Keep subscriptions until dispose() so delayed hook events can complete tools.
    }
  }

  /**
   * Process a single chunk from the Claude stream.
   *
   * Maps AgentMessage to the appropriate BusEvent based on message type.
   */
  private processStreamChunk(
    chunk: AgentMessage,
    runId: number,
    messageId: string,
  ): void {
    // Handle text deltas
    if (chunk.type === "text" && typeof chunk.content === "string") {
      const delta = chunk.content;
      const metadata = chunk.metadata as Record<string, unknown> | undefined;
      const parentToolCallId = this.resolveToolCorrelationId(
        this.asString(
          metadata?.parentToolCallId
          ?? metadata?.parent_tool_call_id
          ?? metadata?.parentToolUseId
          ?? metadata?.parent_tool_use_id,
        ),
      );

      if (parentToolCallId) {
        const context = this.activeSubagentToolsById.get(parentToolCallId);
        const event: BusEvent<"stream.tool.partial_result"> = {
          type: "stream.tool.partial_result",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            toolCallId: parentToolCallId,
            partialOutput: delta,
            ...(context ? { parentAgentId: context.parentAgentId } : {}),
          },
        };
        this.bus.publish(event);
        return;
      }

      this.textAccumulator += delta;

      if (delta.length > 0) {
        const event: BusEvent<"stream.text.delta"> = {
          type: "stream.text.delta",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            delta,
            messageId,
          },
        };

        this.bus.publish(event);
      }
    }

    // Handle thinking deltas and completion
    if (chunk.type === "thinking") {
      const metadata = chunk.metadata;
      const thinkingSourceKey = metadata?.thinkingSourceKey as string | undefined;
      const sourceKey = thinkingSourceKey ?? "default";

      // Check if this is a thinking delta (has content)
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        // Track start time for this thinking source
        if (!this.thinkingStartTimes.has(sourceKey)) {
          this.thinkingStartTimes.set(sourceKey, Date.now());
        }

        const event: BusEvent<"stream.thinking.delta"> = {
          type: "stream.thinking.delta",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            delta: chunk.content,
            sourceKey,
            messageId,
          },
        };

        this.bus.publish(event);
      }

      // Check if this is a thinking complete event (has streamingStats but no content)
      const streamingStats = metadata?.streamingStats as
        | { thinkingMs?: number; outputTokens?: number }
        | undefined;
      if (streamingStats?.thinkingMs !== undefined && chunk.content === "") {
        // Prefer SDK-provided duration, fall back to computed from tracked start time
        const startTime = this.thinkingStartTimes.get(sourceKey);
        const durationMs = streamingStats.thinkingMs
          ?? (startTime ? Date.now() - startTime : 0);
        this.thinkingStartTimes.delete(sourceKey);

        const event: BusEvent<"stream.thinking.complete"> = {
          type: "stream.thinking.complete",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            sourceKey,
            durationMs,
          },
        };

        this.bus.publish(event);
      }

      // Note: streamingStats.outputTokens is NOT used for stream.usage here.
      // Real token counts come from the client "usage" event (via createUsageHandler)
      // to avoid double-counting.
    }

    // Handle tool_use events → stream.tool.start
    if (chunk.type === "tool_use") {
      if (this.preferClientToolHooks) {
        return;
      }
      const chunkRecord = chunk as unknown as Record<string, unknown>;
      const contentRecord = this.asRecord(chunkRecord.content) ?? {};
      const metadataRecord = this.asRecord(chunk.metadata) ?? {};
      const toolName = this.normalizeToolName(
        contentRecord.name ?? chunkRecord.name ?? metadataRecord.toolName,
      );
      const explicitToolId = this.asString(
        contentRecord.toolUseId
          ?? contentRecord.toolUseID
          ?? contentRecord.id
          ?? chunkRecord.toolUseId
          ?? chunkRecord.toolUseID
          ?? chunkRecord.id
          ?? metadataRecord.toolId
          ?? metadataRecord.toolUseId
          ?? metadataRecord.toolUseID
          ?? metadataRecord.toolCallId,
      );
      const toolInput = this.asRecord(contentRecord.input ?? chunkRecord.input) ?? {};
      const toolId = this.resolveToolStartId(explicitToolId, runId, toolName);
      const inferredParentAgentId = this.resolveTaskOutputParentAgentId(toolName, toolInput)
        ?? this.resolveSoleActiveSubagentId()
        ?? this.resolveBackgroundAttributionFallbackAgentId()
        ?? this.resolveSoleActiveSubagentToolParentAgentId();
      if (inferredParentAgentId) {
        this.recordActiveSubagentToolContext(
          toolId,
          toolName,
          inferredParentAgentId,
          explicitToolId,
        );
        if (this.subagentTracker?.hasAgent(inferredParentAgentId)) {
          this.subagentTracker.onToolStart(inferredParentAgentId, toolName);
        }
        if (toolName.toLowerCase() === "taskoutput") {
          this.currentBackgroundAttributionAgentId = inferredParentAgentId;
        }
      }

      const event: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolInput,
          sdkCorrelationId: explicitToolId ?? toolId,
          ...(inferredParentAgentId ? { parentAgentId: inferredParentAgentId } : {}),
        },
      };
      this.bus.publish(event);
    }

    // Handle tool_result events → stream.tool.complete
    if (chunk.type === "tool_result") {
      if (this.preferClientToolHooks) {
        return;
      }
      const chunkRecord = chunk as unknown as Record<string, unknown>;
      const content = chunkRecord.content;
      const metadataRecord = this.asRecord(chunk.metadata) ?? {};
      const toolName = this.normalizeToolName(
        chunkRecord.toolName ?? metadataRecord.toolName,
      );
      const explicitToolId = this.asString(
        chunkRecord.tool_use_id
          ?? chunkRecord.toolUseId
          ?? chunkRecord.toolUseID
          ?? metadataRecord.toolId
          ?? metadataRecord.toolUseId
          ?? metadataRecord.toolUseID
          ?? metadataRecord.toolCallId,
      );
      const toolId = this.resolveToolCompleteId(explicitToolId, runId, toolName);
      const activeContext = this.resolveActiveSubagentToolContext(toolId, explicitToolId);
      this.removeActiveSubagentToolContext(toolId, explicitToolId);
      if (activeContext && this.subagentTracker?.hasAgent(activeContext.parentAgentId)) {
        this.subagentTracker.onToolComplete(activeContext.parentAgentId);
      }
      const contentRecord = this.asRecord(content);
      const isError = chunkRecord.is_error === true
        || (typeof content === "object" && content !== null && "error" in content);
      const errorValue = contentRecord?.error;

      const event: BusEvent<"stream.tool.complete"> = {
        type: "stream.tool.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolResult: content,
          success: !isError,
          error: isError
            ? (typeof errorValue === "string" ? errorValue : String(content))
            : undefined,
          sdkCorrelationId: explicitToolId ?? toolId,
          ...(activeContext ? { parentAgentId: activeContext.parentAgentId } : {}),
        },
      };
      this.bus.publish(event);
    }

    // Token usage from chunk.metadata.tokenUsage is handled by
    // createUsageHandler (from client "usage" events). Do NOT emit
    // stream.usage here to avoid emitting raw per-request values
    // that bypass the accumulator.

    // Note: Agent lifecycle events (agent_start/agent_complete) are NOT
    // emitted as stream chunks by the Claude SDK. Sub-agent lifecycle is
    // delivered through SubagentStart/SubagentStop hooks, which are handled
    // by createSubagentStartHandler and createSubagentCompleteHandler via
    // client.on("subagent.start") and client.on("subagent.complete").
  }

  private createToolStartHandler(runId: number): EventHandler<"tool.start"> {
    return (event) => {
      const data = event.data as ToolStartEventData;
      const dataRecord = data as Record<string, unknown>;
      const sdkToolUseId = this.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.asString(data.toolCallId);
      const sdkCorrelationId = sdkToolUseId ?? sdkToolCallId;
      const toolName = this.normalizeToolName(data.toolName);
      const toolId = this.resolveToolStartId(sdkCorrelationId, runId, toolName);
      this.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);

      // Check if this tool belongs to a sub-agent
      const directParentAgentId = this.asString(
        dataRecord.parentAgentId ?? dataRecord.parentId,
      );
      const parentToolUseId = this.resolveToolCorrelationId(
        this.asString(
          dataRecord.parentToolUseId
            ?? dataRecord.parent_tool_use_id
            ?? dataRecord.parentToolUseID
            ?? dataRecord.parentToolCallId
            ?? dataRecord.parent_tool_call_id
            ?? dataRecord.parentToolCallID,
        ),
      );
      const taskOutputParentAgentId = this.resolveTaskOutputParentAgentId(
        toolName,
        (data.toolInput ?? {}) as Record<string, unknown>,
      );
      if (taskOutputParentAgentId) {
        this.currentBackgroundAttributionAgentId = taskOutputParentAgentId;
      }
      const sessionMappedParentAgentId = this.resolveSubagentSessionParentAgentId(event.sessionId);
      const allowFallbackAttribution = this.isOwnedSession(event.sessionId)
        || Boolean(directParentAgentId || parentToolUseId || sessionMappedParentAgentId);
      const fallbackParentAgentId = allowFallbackAttribution
        ? this.resolveSoleActiveSubagentId()
        : undefined;
      const fallbackBackgroundParentAgentId = allowFallbackAttribution
        ? this.resolveBackgroundAttributionFallbackAgentId()
        : undefined;
      const fallbackActiveToolParentAgentId = allowFallbackAttribution
        ? this.resolveSoleActiveSubagentToolParentAgentId()
        : undefined;
      const syntheticParentAgentId = event.sessionId === this.sessionId
        ? this.getSyntheticAgentIdForAttribution()
        : undefined;
      const resolvedParentAgentId = directParentAgentId
        ?? (parentToolUseId ? this.toolUseIdToSubagentId.get(parentToolUseId) : undefined)
        ?? sessionMappedParentAgentId
        ?? taskOutputParentAgentId
        ?? fallbackParentAgentId;
      const attributedWithContextParentAgentId = resolvedParentAgentId
        ?? fallbackBackgroundParentAgentId
        ?? fallbackActiveToolParentAgentId;
      const finalAttributedParentAgentId = attributedWithContextParentAgentId ?? syntheticParentAgentId;
      if (
        !this.isOwnedSession(event.sessionId)
        && !directParentAgentId
        && !parentToolUseId
        && !sessionMappedParentAgentId
      ) {
        return;
      }

      if (this.isTaskTool(toolName) && sdkCorrelationId) {
        const metadata = this.extractTaskToolMetadata(data.toolInput);
        this.taskToolMetadata.set(sdkCorrelationId, metadata);
        this.recordPendingTaskToolCorrelationId(sdkCorrelationId);
      }
      if (taskOutputParentAgentId && sdkCorrelationId) {
        this.toolUseIdToSubagentId.set(sdkCorrelationId, taskOutputParentAgentId);
      }

      // Update sub-agent tool tracker for tool count display
      if (finalAttributedParentAgentId && this.subagentTracker?.hasAgent(finalAttributedParentAgentId)) {
        this.recordActiveSubagentToolContext(
          toolId,
          toolName,
          finalAttributedParentAgentId,
          sdkToolUseId,
          sdkToolCallId,
          parentToolUseId,
          sdkCorrelationId,
        );
        this.subagentTracker.onToolStart(finalAttributedParentAgentId, toolName);
      } else if (finalAttributedParentAgentId) {
        this.recordActiveSubagentToolContext(
          toolId,
          toolName,
          finalAttributedParentAgentId,
          sdkToolUseId,
          sdkToolCallId,
          parentToolUseId,
          sdkCorrelationId,
        );
        const queue = this.earlyToolEvents.get(finalAttributedParentAgentId) ?? [];
        queue.push({ toolName });
        this.earlyToolEvents.set(finalAttributedParentAgentId, queue);
      } else if (parentToolUseId) {
        const queue = this.earlyToolEvents.get(parentToolUseId) ?? [];
        queue.push({ toolName });
        this.earlyToolEvents.set(parentToolUseId, queue);
      }

      const busEvent: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolInput: (data.toolInput ?? {}) as Record<string, unknown>,
          sdkCorrelationId: sdkCorrelationId ?? toolId,
          ...(finalAttributedParentAgentId ? { parentAgentId: finalAttributedParentAgentId } : {}),
        },
      };
      this.bus.publish(busEvent);
    };
  }

  private createToolCompleteHandler(runId: number): EventHandler<"tool.complete"> {
    return (event) => {
      const data = event.data as ToolCompleteEventData;
      const dataRecord = data as Record<string, unknown>;
      const sdkToolUseId = this.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.asString(data.toolCallId);
      const sdkCorrelationId = this.resolveToolCorrelationId(
        sdkToolUseId ?? sdkToolCallId,
      );
      const toolName = this.normalizeToolName(data.toolName);
      const toolId = this.resolveToolCompleteId(sdkCorrelationId, runId, toolName);
      const toolInput = this.asRecord((data as Record<string, unknown>).toolInput);
      this.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);
      const activeToolContext = this.resolveActiveSubagentToolContext(
        toolId,
        sdkCorrelationId,
        sdkToolUseId,
        sdkToolCallId,
      );
      this.removeActiveSubagentToolContext(toolId, sdkCorrelationId, sdkToolUseId, sdkToolCallId);

      // Check if this tool belongs to a sub-agent
      const directParentAgentId = this.asString(
        dataRecord.parentAgentId ?? dataRecord.parentId,
      );
      const parentToolUseId = this.resolveToolCorrelationId(
        this.asString(
          dataRecord.parentToolUseId
            ?? dataRecord.parent_tool_use_id
            ?? dataRecord.parentToolUseID
            ?? dataRecord.parentToolCallId
            ?? dataRecord.parent_tool_call_id
            ?? dataRecord.parentToolCallID,
        ),
      );
      const taskOutputParentAgentId = this.resolveTaskOutputParentAgentId(
        toolName,
        (toolInput ?? {}) as Record<string, unknown>,
      );
      if (taskOutputParentAgentId) {
        this.currentBackgroundAttributionAgentId = taskOutputParentAgentId;
      }
      const sessionMappedParentAgentId = this.resolveSubagentSessionParentAgentId(event.sessionId);
      const allowFallbackAttribution = this.isOwnedSession(event.sessionId)
        || Boolean(directParentAgentId || parentToolUseId || sessionMappedParentAgentId);
      const fallbackParentAgentId = allowFallbackAttribution
        ? this.resolveSoleActiveSubagentId()
        : undefined;
      const fallbackBackgroundParentAgentId = allowFallbackAttribution
        ? this.resolveBackgroundAttributionFallbackAgentId()
        : undefined;
      const fallbackActiveToolParentAgentId = activeToolContext?.parentAgentId
        ?? (allowFallbackAttribution
          ? this.resolveSoleActiveSubagentToolParentAgentId()
          : undefined);
      const syntheticParentAgentId = event.sessionId === this.sessionId
        ? this.getSyntheticAgentIdForAttribution()
        : undefined;
      const resolvedParentAgentId = directParentAgentId
        ?? (parentToolUseId ? this.toolUseIdToSubagentId.get(parentToolUseId) : undefined)
        ?? sessionMappedParentAgentId
        ?? taskOutputParentAgentId
        ?? activeToolContext?.parentAgentId
        ?? fallbackParentAgentId;
      const attributedWithContextParentAgentId = resolvedParentAgentId
        ?? fallbackBackgroundParentAgentId
        ?? fallbackActiveToolParentAgentId;
      const attributedParentAgentId = attributedWithContextParentAgentId ?? syntheticParentAgentId;
      if (
        !this.isOwnedSession(event.sessionId)
        && !directParentAgentId
        && !parentToolUseId
        && !sessionMappedParentAgentId
      ) {
        return;
      }

      // Update sub-agent tool tracker for tool count display
      if (attributedParentAgentId && this.subagentTracker?.hasAgent(attributedParentAgentId)) {
        this.subagentTracker.onToolComplete(attributedParentAgentId);
      }

      const busEvent: BusEvent<"stream.tool.complete"> = {
        type: "stream.tool.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolInput,
          toolResult: data.toolResult,
          success: data.success,
          error: data.error,
          sdkCorrelationId: sdkCorrelationId ?? toolId,
          ...(attributedParentAgentId ? { parentAgentId: attributedParentAgentId } : {}),
        },
      };
      this.bus.publish(busEvent);
    };
  }

  private createUsageHandler(runId: number): EventHandler<"usage"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as Record<string, unknown>;
      const inputTokens = (data.inputTokens as number) || 0;
      const outputTokens = (data.outputTokens as number) || 0;
      const model = data.model as string | undefined;

      // Filter out diagnostics markers that carry no real token data
      if (outputTokens <= 0 && inputTokens <= 0) {
        return;
      }

      // Accumulate output tokens across multi-turn tool-use flows
      this.accumulatedOutputTokens += outputTokens;

      const busEvent: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          inputTokens,
          outputTokens: this.accumulatedOutputTokens,
          model,
        },
      };
      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for permission.requested events from the Claude SDK.
   * Forwards the event (including the respond callback) to the event bus.
   */
  private createPermissionRequestedHandler(
    runId: number,
  ): EventHandler<"permission.requested"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as PermissionRequestedEventData;
      const busEvent: BusEvent<"stream.permission.requested"> = {
        type: "stream.permission.requested",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          requestId: data.requestId,
          toolName: data.toolName,
          toolInput: (data.toolInput as Record<string, unknown> | undefined),
          question: data.question,
          header: data.header,
          options: data.options,
          multiSelect: data.multiSelect,
          respond: data.respond,
          toolCallId: data.toolCallId,
        },
      };

      this.bus.publish(busEvent);
    };
  }

  private createHumanInputRequiredHandler(
    runId: number,
  ): EventHandler<"human_input_required"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as HumanInputRequiredEventData;
      this.bus.publish({
        type: "stream.human_input_required",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          requestId: data.requestId,
          question: data.question,
          header: data.header,
          options: data.options,
          nodeId: data.nodeId,
          respond: data.respond,
        },
      });
    };
  }

  private createSkillInvokedHandler(
    runId: number,
  ): EventHandler<"skill.invoked"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as SkillInvokedEventData;
      this.bus.publish({
        type: "stream.skill.invoked",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          skillName: data.skillName,
          skillPath: data.skillPath,
        },
      });
    };
  }

  private createReasoningDeltaHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"reasoning.delta"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as ReasoningDeltaEventData;
      if (!data.delta || data.delta.length === 0) return;
      const sourceKey = data.reasoningId || "reasoning";
      if (!this.thinkingStartTimes.has(sourceKey)) {
        this.thinkingStartTimes.set(sourceKey, Date.now());
      }
      this.bus.publish({
        type: "stream.thinking.delta",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          delta: data.delta,
          sourceKey,
          messageId,
        },
      });
    };
  }

  private createReasoningCompleteHandler(
    runId: number,
  ): EventHandler<"reasoning.complete"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as ReasoningCompleteEventData;
      const sourceKey = data.reasoningId || "reasoning";
      const start = this.thinkingStartTimes.get(sourceKey);
      const durationMs = start ? Date.now() - start : 0;
      this.thinkingStartTimes.delete(sourceKey);
      this.bus.publish({
        type: "stream.thinking.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          sourceKey,
          durationMs,
        },
      });
    };
  }

  private createTurnStartHandler(
    runId: number,
  ): EventHandler<"turn.start"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as TurnStartEventData;
      this.bus.publish({
        type: "stream.turn.start",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          turnId: normalizeTurnStartId(
            data.turnId,
            this.turnMetadataState,
          ),
        },
      });
    };
  }

  private createTurnEndHandler(
    runId: number,
  ): EventHandler<"turn.end"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as TurnEndEventData;
      this.bus.publish({
        type: "stream.turn.end",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: normalizeTurnEndMetadata(
          data,
          this.turnMetadataState,
        ),
      });
    };
  }

  private createToolPartialResultHandler(
    runId: number,
  ): EventHandler<"tool.partial_result"> {
    return (event) => {
      const sessionMappedParentAgentId = this.resolveSubagentSessionParentAgentId(event.sessionId);
      if (!this.isOwnedSession(event.sessionId) && !sessionMappedParentAgentId) {
        return;
      }
      const data = event.data as ToolPartialResultEventData;
      const toolCallId = this.resolveToolCorrelationId(this.asString(data.toolCallId))
        ?? this.asString(data.toolCallId);
      const context = toolCallId
        ? this.activeSubagentToolsById.get(toolCallId)
        : undefined;
      const parentAgentId = context?.parentAgentId ?? sessionMappedParentAgentId;
      this.bus.publish({
        type: "stream.tool.partial_result",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolCallId: toolCallId ?? data.toolCallId,
          partialOutput: data.partialOutput,
          ...(parentAgentId ? { parentAgentId } : {}),
        },
      });

      if (!toolCallId && !parentAgentId) {
        return;
      }
      if (parentAgentId && this.subagentTracker?.hasAgent(parentAgentId)) {
        this.subagentTracker.onToolProgress(parentAgentId, context?.toolName);
      }
    };
  }

  private createSessionErrorHandler(
    runId: number,
  ): EventHandler<"session.error"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as SessionErrorEventData;
      const rawError = data.error;
      const normalizedError = rawError instanceof Error
        ? rawError.message.trim()
        : typeof rawError === "string"
          ? rawError.trim()
          : "";

      // Ignore malformed events that carry neither an error message nor code.
      // This prevents placeholder "undefined" errors from reaching the UI.
      if (normalizedError.length === 0 && !data.code) {
        return;
      }

      this.bus.publish({
        type: "stream.session.error",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          error: normalizedError.length > 0 ? normalizedError : "Unknown session error",
          code: data.code,
        },
      });
    };
  }

  private createSessionInfoHandler(
    runId: number,
  ): EventHandler<"session.info"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as SessionInfoEventData;
      this.bus.publish({
        type: "stream.session.info",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          infoType: data.infoType ?? "general",
          message: data.message ?? "",
        },
      });
    };
  }

  private createSessionWarningHandler(
    runId: number,
  ): EventHandler<"session.warning"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as SessionWarningEventData;
      this.bus.publish({
        type: "stream.session.warning",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          warningType: data.warningType ?? "general",
          message: data.message ?? "",
        },
      });
    };
  }

  private createSessionTitleChangedHandler(
    runId: number,
  ): EventHandler<"session.title_changed"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as SessionTitleChangedEventData;
      this.bus.publish({
        type: "stream.session.title_changed",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          title: data.title ?? "",
        },
      });
    };
  }

  private createSessionTruncationHandler(
    runId: number,
  ): EventHandler<"session.truncation"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as SessionTruncationEventData;
      this.bus.publish({
        type: "stream.session.truncation",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          tokenLimit: data.tokenLimit ?? 0,
          tokensRemoved: data.tokensRemoved ?? 0,
          messagesRemoved: data.messagesRemoved ?? 0,
        },
      });
    };
  }

  private createSessionCompactionHandler(
    runId: number,
  ): EventHandler<"session.compaction"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as SessionCompactionEventData;
      this.bus.publish({
        type: "stream.session.compaction",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          phase: data.phase,
          success: data.success,
          error: data.error,
        },
      });
    };
  }

  /**
   * Create a handler for subagent.start events from the SDK.
   * Publishes stream.agent.start to the bus.
   */
  private createSubagentStartHandler(
    runId: number,
  ): EventHandler<"subagent.start"> {
    return (event) => {
      const data = event.data as SubagentStartEventData;
      const dataRecord = data as Record<string, unknown>;
      const subagentSessionId = this.asString(
        dataRecord.subagentSessionId
          ?? dataRecord.subagent_session_id
          ?? dataRecord.session_id
          ?? dataRecord.sessionId,
      );
      if (this.syntheticForegroundAgent) {
        this.syntheticForegroundAgent.sawNativeSubagentStart = true;
        this.publishSyntheticAgentComplete(runId, true);
      }

      // Resolve correlation ID: prefer toolUseId/toolUseID, fall back to toolCallId,
      // then check alias map for canonical tool ID resolution.
      const rawSdkCorrelationId = this.asString(
        data.toolUseId ?? data.toolUseID ?? data.toolCallId,
      );
      let sdkCorrelationId = this.resolveToolCorrelationId(rawSdkCorrelationId);

      // Also resolve the parent tool use ID — the Claude SDK's SubagentStart hook
      // may provide a different toolUseID than the Agent tool's tool_use_id. The
      // parent_tool_use_id field carries the Agent tool's original ID, which is the
      // key used in taskToolMetadata.
      let parentToolUseId = this.resolveToolCorrelationId(this.asString(
        dataRecord.parentToolUseId
          ?? dataRecord.parent_tool_use_id
          ?? dataRecord.parentToolUseID
          ?? dataRecord.parentToolCallId
          ?? dataRecord.parent_tool_call_id
          ?? dataRecord.parentToolCallID,
      ));
      const isKnownSubagent = this.hasKnownSubagentId(data.subagentId);
      const hasTaskCorrelation = Boolean(
        sdkCorrelationId
        && (
          this.taskToolMetadata.has(sdkCorrelationId)
          || this.pendingTaskToolCorrelationIds.includes(sdkCorrelationId)
        ),
      );
      const hasParentTaskCorrelation = Boolean(
        parentToolUseId
        && (
          this.taskToolMetadata.has(parentToolUseId)
          || this.pendingTaskToolCorrelationIds.includes(parentToolUseId)
        ),
      );
      if (
        event.sessionId !== this.sessionId
        && !isKnownSubagent
        && !hasTaskCorrelation
        && !hasParentTaskCorrelation
      ) {
        return;
      }

      const hasSdkMetadata = sdkCorrelationId
        ? this.taskToolMetadata.has(sdkCorrelationId)
        : false;
      if (!hasSdkMetadata && parentToolUseId && this.taskToolMetadata.has(parentToolUseId)) {
        sdkCorrelationId = parentToolUseId;
      }

      if (!sdkCorrelationId) {
        const inferredTaskToolId = this.resolveNextPendingTaskToolCorrelationId();
        if (inferredTaskToolId) {
          sdkCorrelationId = inferredTaskToolId;
          parentToolUseId = parentToolUseId ?? inferredTaskToolId;
        }
      } else if (!parentToolUseId && !this.taskToolMetadata.has(sdkCorrelationId)) {
        const inferredTaskToolId = this.resolveNextPendingTaskToolCorrelationId();
        if (inferredTaskToolId) {
          parentToolUseId = inferredTaskToolId;
          if (!this.taskToolMetadata.has(sdkCorrelationId)) {
            sdkCorrelationId = inferredTaskToolId;
          }
        }
      }

      const metadata = (sdkCorrelationId ? this.taskToolMetadata.get(sdkCorrelationId) : undefined)
        ?? (parentToolUseId ? this.taskToolMetadata.get(parentToolUseId) : undefined);
      const effectiveTask = metadata?.description || data.task;
      const normalizedTask = isGenericSubagentTaskLabel(effectiveTask)
        ? (this.asString(dataRecord.description) ?? effectiveTask)
        : effectiveTask;

      const normalizedMetadata = normalizeAgentTaskMetadata(
        {
          task: normalizedTask,
          agentType: data.subagentType,
          isBackground: metadata?.isBackground
            ?? (dataRecord.isBackground as boolean | undefined),
          toolInput: dataRecord.toolInput,
        },
      );

      // Register agent with tracker for tool counting
      this.subagentTracker?.registerAgent(data.subagentId);
      this.activeSubagentIds.add(data.subagentId);
      if (subagentSessionId && subagentSessionId !== this.sessionId) {
        this.ownedSessionIds.add(subagentSessionId);
        this.subagentSessionToAgentId.set(subagentSessionId, data.subagentId);
      }
      if (event.sessionId !== this.sessionId) {
        this.ownedSessionIds.add(event.sessionId);
        this.subagentSessionToAgentId.set(event.sessionId, data.subagentId);
      }
      this.activeSubagentBackgroundById.set(data.subagentId, normalizedMetadata.isBackground);
      if (normalizedMetadata.isBackground && !this.currentBackgroundAttributionAgentId) {
        this.currentBackgroundAttributionAgentId = data.subagentId;
      }

      if (sdkCorrelationId) {
        this.toolUseIdToSubagentId.set(sdkCorrelationId, data.subagentId);
        this.removePendingTaskToolCorrelationId(sdkCorrelationId);
      }
      // Also map under the parent tool use ID so tool events correlated via the
      // Agent tool's tool_use_id can resolve to this sub-agent.
      if (parentToolUseId && parentToolUseId !== sdkCorrelationId) {
        this.toolUseIdToSubagentId.set(parentToolUseId, data.subagentId);
        this.removePendingTaskToolCorrelationId(parentToolUseId);
      }

      for (const key of [data.subagentId, sdkCorrelationId, parentToolUseId]) {
        if (!key) {
          continue;
        }
        const earlyTools = this.earlyToolEvents.get(key);
        if (!earlyTools) {
          continue;
        }
        for (const tool of earlyTools) {
          this.subagentTracker?.onToolStart(data.subagentId, tool.toolName);
        }
        this.earlyToolEvents.delete(key);
      }

      const busEvent: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: data.subagentId,
          toolCallId: sdkCorrelationId ?? data.subagentId,
          agentType: data.subagentType ?? "unknown",
          task: normalizedMetadata.task,
          isBackground: normalizedMetadata.isBackground,
          sdkCorrelationId,
        },
      };
      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for subagent.complete events from the SDK.
   * Publishes stream.agent.complete to the bus.
   */
  private createSubagentCompleteHandler(
    runId: number,
  ): EventHandler<"subagent.complete"> {
    return (event) => {
      const data = event.data as SubagentCompleteEventData;
      if (event.sessionId !== this.sessionId && !this.hasKnownSubagentId(data.subagentId)) {
        return;
      }
      this.subagentTracker?.removeAgent(data.subagentId);
      this.activeSubagentIds.delete(data.subagentId);
      this.activeSubagentBackgroundById.delete(data.subagentId);
      this.earlyToolEvents.delete(data.subagentId);
      for (const [toolUseId, subagentId] of this.toolUseIdToSubagentId.entries()) {
        if (subagentId === data.subagentId) {
          this.toolUseIdToSubagentId.delete(toolUseId);
          this.taskToolMetadata.delete(toolUseId);
          this.removePendingTaskToolCorrelationId(toolUseId);
          this.earlyToolEvents.delete(toolUseId);
        }
      }
      for (const [subagentSessionId, mappedAgentId] of this.subagentSessionToAgentId.entries()) {
        if (mappedAgentId === data.subagentId) {
          this.subagentSessionToAgentId.delete(subagentSessionId);
          this.ownedSessionIds.delete(subagentSessionId);
        }
      }
      if (this.currentBackgroundAttributionAgentId === data.subagentId) {
        this.currentBackgroundAttributionAgentId = this.resolveBackgroundAttributionFallbackAgentId() ?? null;
      }

      const busEvent: BusEvent<"stream.agent.complete"> = {
        type: "stream.agent.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: data.subagentId,
          success: data.success,
          result: typeof data.result === "string" ? data.result : undefined,
          error: typeof (data as Record<string, unknown>).error === "string"
            ? (data as Record<string, unknown>).error as string
            : undefined,
        },
      };
      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for subagent.update events from the SDK.
   * Publishes stream.agent.update to the bus.
   */
  private createSubagentUpdateHandler(
    runId: number,
  ): EventHandler<"subagent.update"> {
    return (event) => {
      const data = event.data as SubagentUpdateEventData;
      if (event.sessionId !== this.sessionId && !this.hasKnownSubagentId(data.subagentId)) {
        return;
      }
      const busEvent: BusEvent<"stream.agent.update"> = {
        type: "stream.agent.update",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: data.subagentId,
          currentTool: data.currentTool,
          toolUses: data.toolUses,
        },
      };
      this.bus.publish(busEvent);
    };
  }

  private createSessionIdleHandler(
    runId: number,
  ): EventHandler<"session.idle"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as SessionIdleEventData;
      const busEvent: BusEvent<"stream.session.idle"> = {
        type: "stream.session.idle",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          reason: typeof data.reason === "string" ? data.reason : undefined,
        },
      };
      this.bus.publish(busEvent);
    };
  }

  private publishSessionStart(runId: number): void {
    const event: BusEvent<"stream.session.start"> = {
      type: "stream.session.start",
      sessionId: this.sessionId,
      runId,
      timestamp: Date.now(),
      data: {},
    };
    this.bus.publish(event);
  }

  /**
   * Publish a stream.text.complete event.
   */
  private publishTextComplete(runId: number, messageId: string): void {
    const event: BusEvent<"stream.text.complete"> = {
      type: "stream.text.complete",
      sessionId: this.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        messageId,
        fullText: this.textAccumulator,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Publish a stream.session.error event.
   */
  private publishSessionError(runId: number, error: unknown): void {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    const event: BusEvent<"stream.session.error"> = {
      type: "stream.session.error",
      sessionId: this.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        error: errorMessage,
      },
    };

    this.bus.publish(event);
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return undefined;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
      ? value
      : undefined;
  }

  private normalizeToolName(value: unknown): string {
    return this.asString(value) ?? "unknown";
  }

  private isTaskTool(toolName: string): boolean {
    const normalized = toolName.toLowerCase();
    return normalized === "task" || normalized === "launch_agent" || normalized === "agent";
  }

  private resolveTaskOutputParentAgentId(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string | undefined {
    if (toolName.toLowerCase() !== "taskoutput") {
      return undefined;
    }
    const taskId = this.asString(toolInput.task_id ?? toolInput.taskId);
    if (!taskId) {
      return undefined;
    }
    if (this.hasKnownSubagentId(taskId)) {
      return taskId;
    }
    return this.toolUseIdToSubagentId.get(taskId);
  }

  private extractTaskToolMetadata(
    toolInput: unknown,
  ): { description: string; isBackground: boolean } {
    const record = this.asRecord(toolInput) ?? {};
    return {
      description: this.asString(record.description)
        ?? this.asString(record.prompt)
        ?? this.asString(record.task)
        ?? "",
      isBackground: record.run_in_background === true
        || this.asString(record.mode)?.toLowerCase() === "background",
    };
  }

  private createSyntheticToolId(runId: number, toolName: string): string {
    this.syntheticToolCounter += 1;
    const normalizedName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `tool_${runId}_${normalizedName}_${this.syntheticToolCounter}`;
  }

  private queueToolId(toolName: string, toolId: string): void {
    const queue = this.pendingToolIdsByName.get(toolName) ?? [];
    if (!queue.includes(toolId)) {
      queue.push(toolId);
      this.pendingToolIdsByName.set(toolName, queue);
    }
  }

  private removeQueuedToolId(toolName: string, toolId: string): void {
    const queue = this.pendingToolIdsByName.get(toolName);
    if (!queue) return;
    const nextQueue = queue.filter((queuedId) => queuedId !== toolId);
    if (nextQueue.length === 0) {
      this.pendingToolIdsByName.delete(toolName);
      return;
    }
    this.pendingToolIdsByName.set(toolName, nextQueue);
  }

  private shiftQueuedToolId(toolName: string): string | undefined {
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

  private resolveToolStartId(
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ): string {
    const toolId = explicitToolId ?? this.createSyntheticToolId(runId, toolName);
    this.queueToolId(toolName, toolId);
    return toolId;
  }

  private resolveToolCompleteId(
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

  private resolveToolCorrelationId(correlationId: string | undefined): string | undefined {
    if (!correlationId) {
      return undefined;
    }
    return this.toolCorrelationAliases.get(correlationId) ?? correlationId;
  }

  private recordPendingTaskToolCorrelationId(correlationId: string): void {
    if (this.pendingTaskToolCorrelationIds.includes(correlationId)) {
      return;
    }
    this.pendingTaskToolCorrelationIds.push(correlationId);
  }

  private removePendingTaskToolCorrelationId(correlationId: string): void {
    this.pendingTaskToolCorrelationIds = this.pendingTaskToolCorrelationIds.filter(
      (candidate) => candidate !== correlationId,
    );
  }

  private resolveNextPendingTaskToolCorrelationId(): string | undefined {
    for (const correlationId of this.pendingTaskToolCorrelationIds) {
      if (this.taskToolMetadata.has(correlationId) && !this.toolUseIdToSubagentId.has(correlationId)) {
        return correlationId;
      }
    }
    return undefined;
  }

  private getSyntheticAgentIdForAttribution(): string | undefined {
    if (!this.syntheticForegroundAgent) {
      return undefined;
    }
    if (this.syntheticForegroundAgent.completed || this.syntheticForegroundAgent.sawNativeSubagentStart) {
      return undefined;
    }
    return this.syntheticForegroundAgent.id;
  }

  private resolveActiveSubagentToolContext(
    ...correlationIds: Array<string | undefined>
  ): { parentAgentId: string; toolName: string } | undefined {
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

  private resolveSoleActiveSubagentToolParentAgentId(): string | undefined {
    const parentAgentIds = new Set<string>();
    for (const context of this.activeSubagentToolsById.values()) {
      if (!this.subagentTracker?.hasAgent(context.parentAgentId)) {
        continue;
      }
      parentAgentIds.add(context.parentAgentId);
      if (parentAgentIds.size > 1) {
        return undefined;
      }
    }
    return parentAgentIds.values().next().value;
  }

  private publishSyntheticAgentStart(runId: number): void {
    const syntheticAgent = this.syntheticForegroundAgent;
    if (!syntheticAgent || syntheticAgent.started || syntheticAgent.sawNativeSubagentStart) {
      return;
    }
    syntheticAgent.started = true;
    this.subagentTracker?.registerAgent(syntheticAgent.id);
    this.bus.publish({
      type: "stream.agent.start",
      sessionId: this.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        agentId: syntheticAgent.id,
        toolCallId: syntheticAgent.id,
        agentType: syntheticAgent.name,
        task: syntheticAgent.task,
        isBackground: false,
        sdkCorrelationId: syntheticAgent.id,
      },
    });
  }

  private publishSyntheticAgentComplete(
    runId: number,
    success: boolean,
    error?: string,
  ): void {
    const syntheticAgent = this.syntheticForegroundAgent;
    if (!syntheticAgent || !syntheticAgent.started || syntheticAgent.completed) {
      return;
    }
    syntheticAgent.completed = true;
    this.subagentTracker?.removeAgent(syntheticAgent.id);
    this.bus.publish({
      type: "stream.agent.complete",
      sessionId: this.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        agentId: syntheticAgent.id,
        success,
        result: success ? this.textAccumulator : undefined,
        ...(error ? { error } : {}),
      },
    });
  }

  private registerToolCorrelationAliases(
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

  private recordActiveSubagentToolContext(
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

  private removeActiveSubagentToolContext(
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

  private hasKnownSubagentId(subagentId: string): boolean {
    if (!subagentId) {
      return false;
    }
    if (this.activeSubagentIds.has(subagentId)) {
      return true;
    }
    if (this.subagentTracker?.hasAgent(subagentId)) {
      return true;
    }
    for (const mappedId of this.toolUseIdToSubagentId.values()) {
      if (mappedId === subagentId) {
        return true;
      }
    }
    return false;
  }

  private resolveSoleActiveSubagentId(): string | undefined {
    if (this.activeSubagentIds.size !== 1) {
      return undefined;
    }
    return this.activeSubagentIds.values().next().value;
  }

  private resolveBackgroundAttributionFallbackAgentId(): string | undefined {
    if (this.activeSubagentIds.size === 0) {
      return undefined;
    }

    const backgroundAgentIds = [...this.activeSubagentIds].filter(
      (agentId) => this.activeSubagentBackgroundById.get(agentId) === true,
    );
    if (backgroundAgentIds.length === 0) {
      return undefined;
    }

    // Avoid forcing background attribution when any known foreground subagent is active.
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

  /**
   * Force-complete any tools that received start but no complete event.
   * Prevents tools from being stuck in running state after stream abort.
   */
  private cleanupOrphanedTools(runId: number): void {
    for (const [toolName, toolIds] of this.pendingToolIdsByName.entries()) {
      for (const toolId of toolIds) {
        const context = this.resolveActiveSubagentToolContext(toolId);
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
            ...(context ? { parentAgentId: context.parentAgentId } : {}),
          },
        };
        this.bus.publish(event);
        this.removeActiveSubagentToolContext(toolId);
      }
    }
    this.pendingToolIdsByName.clear();
    this.activeSubagentIds.clear();
    this.activeSubagentBackgroundById.clear();
    this.currentBackgroundAttributionAgentId = null;
    this.activeSubagentToolsById.clear();
    this.ownedSessionIds = new Set([this.sessionId]);
    this.subagentSessionToAgentId.clear();
  }

  /**
   * Clean up SDK event subscriptions without full state reset.
   */
  private cleanupSubscriptions(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  /**
   * Cancel the ongoing stream and cleanup resources.
   */
  dispose(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.cleanupSubscriptions();
    this.textAccumulator = "";
    this.thinkingStartTimes.clear();
    this.pendingToolIdsByName.clear();
    this.toolCorrelationAliases.clear();
    this.taskToolMetadata.clear();
    this.pendingTaskToolCorrelationIds = [];
    this.earlyToolEvents.clear();
    this.activeSubagentIds.clear();
    this.activeSubagentBackgroundById.clear();
    this.currentBackgroundAttributionAgentId = null;
    this.activeSubagentToolsById.clear();
    this.ownedSessionIds.clear();
    this.subagentSessionToAgentId.clear();
    this.toolUseIdToSubagentId.clear();
    this.syntheticForegroundAgent = null;
    this.syntheticToolCounter = 0;
    this.accumulatedOutputTokens = 0;
    this.runtimeFeatureFlags = { ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS };
    resetTurnMetadataState(this.turnMetadataState);
    this.subagentTracker?.reset();
    this.subagentTracker = null;
  }

  private resolveRuntimeFeatureFlags(
    overrides: WorkflowRuntimeFeatureFlagOverrides | undefined,
  ): WorkflowRuntimeFeatureFlags {
    return resolveWorkflowRuntimeFeatureFlags(overrides);
  }

  private isOwnedSession(eventSessionId: string): boolean {
    return eventSessionId === this.sessionId || this.ownedSessionIds.has(eventSessionId);
  }

  private resolveSubagentSessionParentAgentId(eventSessionId: string): string | undefined {
    if (eventSessionId === this.sessionId) {
      return undefined;
    }
    return this.subagentSessionToAgentId.get(eventSessionId);
  }
}
