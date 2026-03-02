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
  /** Buffers tool events that arrive before parent subagent registration */
  private earlyToolEvents = new Map<string, Array<{ toolName: string }>>();
  /** Maps task-tool correlation ID -> subagentId */
  private toolUseIdToSubagentId = new Map<string, string>();
  private syntheticToolCounter = 0;
  private accumulatedOutputTokens = 0;
  private subagentTracker: SubagentToolTracker | null = null;
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
    this.earlyToolEvents.clear();
    this.toolUseIdToSubagentId.clear();
    this.syntheticToolCounter = 0;
    this.accumulatedOutputTokens = 0;
    this.subagentTracker = new SubagentToolTracker(this.bus, this.sessionId, runId);
    this.runtimeFeatureFlags = this.resolveRuntimeFeatureFlags(runtimeFeatureFlags);
    resetTurnMetadataState(this.turnMetadataState);

    this.publishSessionStart(runId);

    const client = this.client ?? (session as Session & { __client?: CodingAgentClient }).__client;
    if (client && typeof client.on === "function") {
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
    } finally {
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
        },
      };
      this.bus.publish(event);
    }

    // Handle tool_result events → stream.tool.complete
    if (chunk.type === "tool_result") {
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
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as ToolStartEventData;
      const sdkToolUseId = this.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.asString(data.toolCallId);
      const sdkCorrelationId = sdkToolUseId ?? sdkToolCallId;
      const toolName = this.normalizeToolName(data.toolName);
      const toolId = this.resolveToolStartId(sdkCorrelationId, runId, toolName);
      this.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);

      // Check if this tool belongs to a sub-agent
      const directParentAgentId = this.asString(
        (data as Record<string, unknown>).parentAgentId,
      );
      const parentToolUseId = this.resolveToolCorrelationId(
        this.asString((data as Record<string, unknown>).parentToolUseId),
      );
      const resolvedParentAgentId = directParentAgentId
        ?? (parentToolUseId ? this.toolUseIdToSubagentId.get(parentToolUseId) : undefined);

      if (this.isTaskTool(toolName) && sdkCorrelationId) {
        const metadata = this.extractTaskToolMetadata(data.toolInput);
        this.taskToolMetadata.set(sdkCorrelationId, metadata);
      }

      // Update sub-agent tool tracker for tool count display
      if (resolvedParentAgentId && this.subagentTracker?.hasAgent(resolvedParentAgentId)) {
        this.subagentTracker.onToolStart(resolvedParentAgentId, toolName);
      } else if (resolvedParentAgentId) {
        const queue = this.earlyToolEvents.get(resolvedParentAgentId) ?? [];
        queue.push({ toolName });
        this.earlyToolEvents.set(resolvedParentAgentId, queue);
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
          ...(resolvedParentAgentId ? { parentAgentId: resolvedParentAgentId } : {}),
        },
      };
      this.bus.publish(busEvent);
    };
  }

  private createToolCompleteHandler(runId: number): EventHandler<"tool.complete"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as ToolCompleteEventData;
      const sdkToolUseId = this.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.asString(data.toolCallId);
      const sdkCorrelationId = this.resolveToolCorrelationId(
        sdkToolUseId ?? sdkToolCallId,
      );
      const toolName = this.normalizeToolName(data.toolName);
      const toolId = this.resolveToolCompleteId(sdkCorrelationId, runId, toolName);
      const toolInput = this.asRecord((data as Record<string, unknown>).toolInput);
      this.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);

      // Check if this tool belongs to a sub-agent
      const directParentAgentId = this.asString(
        (data as Record<string, unknown>).parentAgentId,
      );
      const parentToolUseId = this.resolveToolCorrelationId(
        this.asString((data as Record<string, unknown>).parentToolUseId),
      );
      const resolvedParentAgentId = directParentAgentId
        ?? (parentToolUseId ? this.toolUseIdToSubagentId.get(parentToolUseId) : undefined);

      // Update sub-agent tool tracker for tool count display
      if (resolvedParentAgentId && this.subagentTracker?.hasAgent(resolvedParentAgentId)) {
        this.subagentTracker.onToolComplete(resolvedParentAgentId);
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
          ...(resolvedParentAgentId ? { parentAgentId: resolvedParentAgentId } : {}),
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
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as ToolPartialResultEventData;
      this.bus.publish({
        type: "stream.tool.partial_result",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolCallId: data.toolCallId,
          partialOutput: data.partialOutput,
        },
      });
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
      if (event.sessionId !== this.sessionId) return;

      const data = event.data as SubagentStartEventData;

      // Resolve correlation ID: prefer toolUseId/toolUseID, fall back to toolCallId,
      // then check alias map for canonical tool ID resolution.
      const rawSdkCorrelationId = this.asString(
        data.toolUseId ?? data.toolUseID ?? data.toolCallId,
      );
      const sdkCorrelationId = this.resolveToolCorrelationId(rawSdkCorrelationId);
      const metadata = sdkCorrelationId
        ? this.taskToolMetadata.get(sdkCorrelationId)
        : undefined;

      const normalizedMetadata = normalizeAgentTaskMetadata(
        {
          task: metadata?.description || data.task,
          agentType: data.subagentType,
          isBackground: metadata?.isBackground
            ?? (data as Record<string, unknown>).isBackground,
          toolInput: (data as Record<string, unknown>).toolInput,
        },
      );

      // Register agent with tracker for tool counting
      this.subagentTracker?.registerAgent(data.subagentId);

      if (sdkCorrelationId) {
        this.toolUseIdToSubagentId.set(sdkCorrelationId, data.subagentId);
      }

      for (const key of [data.subagentId, sdkCorrelationId]) {
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
      if (event.sessionId !== this.sessionId) return;

      const data = event.data as SubagentCompleteEventData;
      this.subagentTracker?.removeAgent(data.subagentId);
      this.earlyToolEvents.delete(data.subagentId);
      for (const [toolUseId, subagentId] of this.toolUseIdToSubagentId.entries()) {
        if (subagentId === data.subagentId) {
          this.toolUseIdToSubagentId.delete(toolUseId);
          this.taskToolMetadata.delete(toolUseId);
          this.earlyToolEvents.delete(toolUseId);
          break;
        }
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
      if (event.sessionId !== this.sessionId) return;

      const data = event.data as SubagentUpdateEventData;
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
    return normalized === "task" || normalized === "launch_agent";
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

  /**
   * Force-complete any tools that received start but no complete event.
   * Prevents tools from being stuck in running state after stream abort.
   */
  private cleanupOrphanedTools(runId: number): void {
    for (const [toolName, toolIds] of this.pendingToolIdsByName.entries()) {
      for (const toolId of toolIds) {
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
          },
        };
        this.bus.publish(event);
      }
    }
    this.pendingToolIdsByName.clear();
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
    this.earlyToolEvents.clear();
    this.toolUseIdToSubagentId.clear();
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
}
