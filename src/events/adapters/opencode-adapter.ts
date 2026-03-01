/**
 * OpenCode SDK Stream Adapter
 *
 * Consumes streaming events from the OpenCode SDK's event emitter
 * and publishes them to the event bus as normalized BusEvents.
 *
 * Key responsibilities:
 * - Subscribe to SDK events via client.on() (text, thinking, tool, subagent, session events)
 * - Fire prompt via session.sendAsync() (fire-and-forget)
 * - Map OpenCode SDK AgentEvent types to BusEvent types
 * - Support cancellation via AbortController
 * - Publish events directly to the event bus (no batching)
 *
 * Event mapping:
 * - message.delta (text) → stream.text.delta
 * - message.complete → stream.text.complete
 * - message.delta (reasoning) → stream.thinking.delta
 * - tool.start → stream.tool.start
 * - tool.complete → stream.tool.complete
 * - subagent.start → stream.agent.start
 * - subagent.complete → stream.agent.complete
 * - session.idle → stream.session.idle
 * - session.error → stream.session.error
 * - usage → stream.usage
 *
 * Note: All events flow through the SDK's event emitter. The adapter uses
 * session.sendAsync() to fire the prompt and relies exclusively on SSE events
 * for streaming content.
 *
 * Usage:
 * ```typescript
 * const adapter = new OpenCodeStreamAdapter(eventBus, sessionId);
 * await adapter.startStreaming(session, message, { runId, messageId, agent });
 * adapter.dispose(); // Cancel and cleanup
 * ```
 */

import type { EventBus } from "../event-bus.ts";
import type { BusEvent } from "../bus-events.ts";
import type {
  SDKStreamAdapter,
  StreamAdapterOptions,
} from "./types.ts";
import type {
  CodingAgentClient,
  Session,
  AgentMessage,
  EventHandler,
  ToolStartEventData,
  ToolCompleteEventData,
  SubagentStartEventData,
  SubagentCompleteEventData,
  SubagentUpdateEventData,
  PermissionRequestedEventData,
  HumanInputRequiredEventData,
  SkillInvokedEventData,
  SessionCompactionEventData,
  SessionTruncationEventData,
  TurnStartEventData,
  TurnEndEventData,
  ToolPartialResultEventData,
  SessionInfoEventData,
  SessionWarningEventData,
  SessionTitleChangedEventData,
} from "../../sdk/types.ts";
import { classifyError, computeDelay, retrySleep, DEFAULT_MAX_RETRIES } from "./retry.ts";

/**
 * Stream adapter for OpenCode SDK.
 *
 * Consumes events from the SDK's event emitter for all streaming content
 * (text/thinking deltas, tool events, subagent events, session lifecycle).
 * Uses session.sendAsync() to fire the prompt, then waits for session.idle
 * or session.error to signal completion.
 */
export class OpenCodeStreamAdapter implements SDKStreamAdapter {
  private bus: EventBus;
  private sessionId: string;
  private client?: CodingAgentClient;
  private abortController: AbortController | null = null;
  private textAccumulator = "";
  private unsubscribers: Array<() => void> = [];
  // Track thinking blocks to emit complete events
  private thinkingBlocks = new Map<string, { startTime: number }>();
  private pendingToolIdsByName = new Map<string, string[]>();
  private toolCorrelationAliases = new Map<string, string>();
  private syntheticToolCounter = 0;

  /**
   * Running total of output tokens across all messages in the current stream.
   * OpenCode's `message.updated` SSE carries cumulative-within-message tokens
   * (updated multiple times per message). We track the latest per-message value
   * and the total across messages so the bus event carries a session-wide total.
   */
  private lastSeenOutputTokens = 0;
  private accumulatedOutputTokens = 0;

  /**
   * Create a new OpenCode stream adapter.
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
   * Start consuming the OpenCode SDK stream and publishing BusEvents.
   *
   * This method will:
   * 1. Subscribe to SDK events (text, thinking, tool, subagent, session, usage events)
   * 2. Fire prompt via session.sendAsync() (fire-and-forget)
   * 3. Wait for session.idle or session.error to signal completion
   * 4. Publish events directly to the bus
   * 5. Complete with stream.text.complete and stream.session.idle events
   *
   * @param session - Active OpenCode SDK session
   * @param message - User message to stream
   * @param options - Stream options (runId, messageId, agent)
   */
  async startStreaming(
    session: Session,
    message: string,
    options: StreamAdapterOptions,
  ): Promise<void> {
    const { runId, messageId, agent } = options;

    // Clean up any existing subscriptions from a previous startStreaming() call
    // to prevent subscription accumulation on re-entry without dispose()
    this.cleanupSubscriptions();

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Reset state
    this.textAccumulator = "";
    this.thinkingBlocks.clear();
    this.pendingToolIdsByName.clear();
    this.toolCorrelationAliases.clear();
    this.syntheticToolCounter = 0;
    this.lastSeenOutputTokens = 0;
    this.accumulatedOutputTokens = 0;

    this.publishSessionStart(runId);

    // Get the SDK client from constructor injection first, then legacy session field fallback.
    // Note: The OpenCode SDK emits most events through the CodingAgentClient event emitter
    const client = this.client ?? (session as Session & { __client?: CodingAgentClient }).__client;
    if (client && typeof client.on === "function") {
      // Subscribe to message.delta events for text and thinking content
      const unsubDelta = client.on(
        "message.delta",
        this.createMessageDeltaHandler(runId, messageId),
      );
      this.unsubscribers.push(unsubDelta);

      // Subscribe to message.complete events
      const unsubComplete = client.on(
        "message.complete",
        this.createMessageCompleteHandler(runId, messageId),
      );
      this.unsubscribers.push(unsubComplete);

      // Subscribe to tool.start events
      const unsubToolStart = client.on(
        "tool.start",
        this.createToolStartHandler(runId),
      );
      this.unsubscribers.push(unsubToolStart);

      // Subscribe to tool.complete events
      const unsubToolComplete = client.on(
        "tool.complete",
        this.createToolCompleteHandler(runId),
      );
      this.unsubscribers.push(unsubToolComplete);

      // Subscribe to subagent.start events
      const unsubAgentStart = client.on(
        "subagent.start",
        this.createSubagentStartHandler(runId),
      );
      this.unsubscribers.push(unsubAgentStart);

      // Subscribe to subagent.complete events
      const unsubAgentComplete = client.on(
        "subagent.complete",
        this.createSubagentCompleteHandler(runId),
      );
      this.unsubscribers.push(unsubAgentComplete);

      // Subscribe to subagent.update events (tool progress for sub-agents)
      const unsubAgentUpdate = client.on(
        "subagent.update",
        this.createSubagentUpdateHandler(runId),
      );
      this.unsubscribers.push(unsubAgentUpdate);

      // Subscribe to session.idle events
      const unsubIdle = client.on(
        "session.idle",
        this.createSessionIdleHandler(runId),
      );
      this.unsubscribers.push(unsubIdle);

      // Subscribe to session.error events
      const unsubError = client.on(
        "session.error",
        this.createSessionErrorHandler(runId),
      );
      this.unsubscribers.push(unsubError);

      // Subscribe to usage events
      const unsubUsage = client.on(
        "usage",
        this.createUsageHandler(runId),
      );
      this.unsubscribers.push(unsubUsage);

      // Subscribe to permission request events
      const unsubPermission = client.on(
        "permission.requested",
        this.createPermissionRequestedHandler(runId),
      );
      this.unsubscribers.push(unsubPermission);

      // Subscribe to human input request events
      const unsubHumanInput = client.on(
        "human_input_required",
        this.createHumanInputRequiredHandler(runId),
      );
      this.unsubscribers.push(unsubHumanInput);

      // Subscribe to skill invocation events
      const unsubSkill = client.on(
        "skill.invoked",
        this.createSkillInvokedHandler(runId),
      );
      this.unsubscribers.push(unsubSkill);

      // Subscribe to session compaction events
      const unsubCompaction = client.on(
        "session.compaction",
        this.createSessionCompactionHandler(runId),
      );
      this.unsubscribers.push(unsubCompaction);

      // Subscribe to session truncation events
      const unsubTruncation = client.on(
        "session.truncation",
        this.createSessionTruncationHandler(runId),
      );
      this.unsubscribers.push(unsubTruncation);

      // Subscribe to turn lifecycle events
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

      // Subscribe to tool partial result events
      const unsubToolPartial = client.on(
        "tool.partial_result",
        this.createToolPartialResultHandler(runId),
      );
      this.unsubscribers.push(unsubToolPartial);

      // Subscribe to session info/warning/title events
      const unsubInfo = client.on(
        "session.info",
        this.createSessionInfoHandler(runId),
      );
      this.unsubscribers.push(unsubInfo);

      const unsubWarning = client.on(
        "session.warning",
        this.createSessionWarningHandler(runId),
      );
      this.unsubscribers.push(unsubWarning);

      const unsubTitleChanged = client.on(
        "session.title_changed",
        this.createSessionTitleChangedHandler(runId),
      );
      this.unsubscribers.push(unsubTitleChanged);
    }

    try {
      // Fire prompt via sendAsync (fire-and-forget) — all content arrives via SSE events.
      // Fall back to stream() for clients that don't implement sendAsync.
      if (session.sendAsync) {
        // Create a promise that resolves when session.idle or session.error fires
        const completionPromise = new Promise<{ reason: string; error?: string }>((resolve) => {
          const checkAbort = () => {
            if (this.abortController?.signal.aborted) {
              resolve({ reason: "aborted" });
            }
          };

          const onIdle = client?.on("session.idle", (event) => {
            if (event.sessionId !== this.sessionId) return;
            resolve({ reason: event.data.reason ?? "idle" });
          });
          if (onIdle) this.unsubscribers.push(onIdle);

          const onError = client?.on("session.error", (event) => {
            if (event.sessionId !== this.sessionId) return;
            const error = typeof event.data.error === "string"
              ? event.data.error
              : (event.data.error as Error).message;
            resolve({ reason: "error", error });
          });
          if (onError) this.unsubscribers.push(onError);

          // Also check abort periodically
          this.abortController?.signal.addEventListener("abort", checkAbort, { once: true });
        });

        await session.sendAsync(message, agent ? { agent } : undefined);

        // Wait for completion signal from SSE
        const completion = await completionPromise;

        // Publish stream.text.complete if we accumulated any text
        if (this.textAccumulator.length > 0) {
          this.publishTextComplete(runId, messageId);
        }

        if (completion.error) {
          this.publishSessionError(runId, new Error(completion.error));
        }

        this.publishSessionIdle(runId, completion.reason);
      } else {
        // Legacy fallback with retry: iterate stream for non-OpenCode clients
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
          try {
            const stream = session.stream(message, agent ? { agent } : undefined);
            for await (const chunk of stream) {
              if (this.abortController.signal.aborted) {
                break;
              }
              await this.processStreamChunk(chunk, runId, messageId);
            }

            if (this.textAccumulator.length > 0) {
              this.publishTextComplete(runId, messageId);
            }
            this.publishSessionIdle(runId, "generator-complete");
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
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

            this.textAccumulator = "";
            await retrySleep(delay, this.abortController.signal);
          }
        }
        if (lastError) throw lastError;
      }
    } catch (error) {
      // Handle stream errors
      if (this.abortController && !this.abortController.signal.aborted) {
        this.publishSessionError(runId, error);
      }
      // Always publish idle on error so the UI can finalize.
      this.publishSessionIdle(runId, "error");
    } finally {
      // Force-complete any tools still pending/running — prevents orphaned tool state
      this.cleanupOrphanedTools(runId);
      // Keep subscriptions active until dispose() so late lifecycle events
      // (e.g. delayed tool.complete) can still be published to the bus.
    }
  }

  /**
   * Process a single chunk from the OpenCode stream.
   *
   * Maps AgentMessage to the appropriate BusEvent based on message type.
   */
  private async processStreamChunk(
    chunk: AgentMessage,
    runId: number,
    messageId: string,
  ): Promise<void> {
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

      // Token usage is handled by createUsageHandler (from client "usage" events).
      // Do NOT emit stream.usage here from streamingStats to avoid double-counting
      // when chat.tsx accumulates per-turn values.
    }

    // Handle thinking deltas
    if (chunk.type === "thinking") {
      const metadata = chunk.metadata;
      const thinkingSourceKey = metadata?.thinkingSourceKey as string | undefined;
      const sourceKey = thinkingSourceKey ?? "default";

      // Check if this is a thinking delta (has content)
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        // Track the start time for this thinking block
        if (!this.thinkingBlocks.has(sourceKey)) {
          this.thinkingBlocks.set(sourceKey, { startTime: Date.now() });
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

      // Check if this is a thinking complete event (has streamingStats)
      const streamingStats = metadata?.streamingStats as
        | { thinkingMs?: number; outputTokens?: number }
        | undefined;
      if (streamingStats?.thinkingMs !== undefined) {
        const durationMs = streamingStats.thinkingMs;

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
        this.thinkingBlocks.delete(sourceKey);
      }

      // Token usage is handled by createUsageHandler (from client "usage" events).
      // Do NOT emit stream.usage here from streamingStats to avoid double-counting.
    }

    if (chunk.type === "tool_use") {
      const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
      const content = (chunk.content ?? {}) as Record<string, unknown>;
      const toolCalls = Array.isArray(content.toolCalls)
        ? content.toolCalls as Record<string, unknown>[]
        : [content];

      for (const toolCall of toolCalls) {
        const toolName = this.normalizeToolName(toolCall.name ?? metadata.toolName);
        const input = this.asRecord(toolCall.input) ?? {};
        const explicitToolId = this.asString(
          toolCall.toolUseId
            ?? toolCall.toolUseID
            ?? toolCall.id
            ?? metadata.toolId
            ?? metadata.toolUseId
            ?? metadata.toolUseID
            ?? metadata.toolCallId,
        );
        const toolId = this.resolveToolStartId(explicitToolId, runId, toolName);
        const sdkCorrelationId = explicitToolId ?? toolId;

        const event: BusEvent<"stream.tool.start"> = {
          type: "stream.tool.start",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            toolId,
            toolName,
            toolInput: input,
            sdkCorrelationId,
          },
        };
        this.bus.publish(event);
      }
    }

    if (chunk.type === "tool_result") {
      const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
      const toolName = this.normalizeToolName(metadata.toolName);
      const explicitToolId = this.asString(
        metadata.toolId
          ?? metadata.toolUseId
          ?? metadata.toolUseID
          ?? metadata.toolCallId,
      );
      const toolId = this.resolveToolCompleteId(explicitToolId, runId, toolName);
      const rawContent = chunk.content;
      const contentRecord = this.asRecord(rawContent);
      const isError = metadata.error === true
        || (typeof rawContent === "object" && rawContent !== null && "error" in rawContent);
      const errorValue = contentRecord?.error;
      const error = isError
        ? (typeof errorValue === "string" ? errorValue : "Tool execution failed")
        : undefined;

      const event: BusEvent<"stream.tool.complete"> = {
        type: "stream.tool.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolResult: rawContent,
          success: !isError,
          error,
          sdkCorrelationId: explicitToolId ?? toolId,
        },
      };
      this.bus.publish(event);
    }
  }

  /**
   * Create a handler for message.delta events from the SDK.
   * Handles both text and thinking content from SSE events.
   */
  private createMessageDeltaHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"message.delta"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      if (this.abortController?.signal.aborted) return;

      const { delta, contentType, thinkingSourceKey } = event.data;

      if (!delta || delta.length === 0) return;

      if (contentType === "thinking") {
        const sourceKey = thinkingSourceKey ?? "default";

        if (!this.thinkingBlocks.has(sourceKey)) {
          this.thinkingBlocks.set(sourceKey, { startTime: Date.now() });
        }

        const busEvent: BusEvent<"stream.thinking.delta"> = {
          type: "stream.thinking.delta",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            delta,
            sourceKey,
            messageId,
          },
        };
        this.bus.publish(busEvent);
      } else {
        this.textAccumulator += delta;

        const busEvent: BusEvent<"stream.text.delta"> = {
          type: "stream.text.delta",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            delta,
            messageId,
          },
        };
        this.bus.publish(busEvent);
      }
    };
  }

  /**
   * Create a handler for message.complete events from the SDK.
   */
  private createMessageCompleteHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"message.complete"> {
    return (event) => {
      // Only process events for this session
      if (event.sessionId !== this.sessionId) {
        return;
      }

      // Finalize any open thinking blocks by emitting stream.thinking.complete
      for (const [sourceKey, block] of this.thinkingBlocks.entries()) {
        const durationMs = Date.now() - block.startTime;
        const completeEvent: BusEvent<"stream.thinking.complete"> = {
          type: "stream.thinking.complete",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            sourceKey,
            durationMs,
          },
        };
        this.bus.publish(completeEvent);
      }
      this.thinkingBlocks.clear();

      // Publish text complete if we have accumulated text
      if (this.textAccumulator.length > 0) {
        this.publishTextComplete(runId, messageId);
      }
    };
  }

  /**
   * Create a handler for tool.start events from the SDK.
   */
  private createToolStartHandler(runId: number): EventHandler<"tool.start"> {
    return (event) => {
      // Only process events for this session
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
        },
      };

      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for tool.complete events from the SDK.
   */
  private createToolCompleteHandler(
    runId: number,
  ): EventHandler<"tool.complete"> {
    return (event) => {
      // Only process events for this session
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
        },
      };

      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for subagent.start events from the SDK.
   */
  private createSubagentStartHandler(
    runId: number,
  ): EventHandler<"subagent.start"> {
    return (event) => {
      // Only process events for this session
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as SubagentStartEventData;

      // Extract SDK correlation ID
      const rawSdkCorrelationId = this.asString(
        data.toolUseId ?? data.toolUseID ?? data.toolCallId,
      );
      const sdkCorrelationId = this.resolveToolCorrelationId(rawSdkCorrelationId);

      const busEvent: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: data.subagentId,
          agentType: data.subagentType ?? "unknown",
          task: data.task ?? "",
          isBackground: false, // OpenCode doesn't have background mode
          sdkCorrelationId,
        },
      };

      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for subagent.complete events from the SDK.
   */
  private createSubagentCompleteHandler(
    runId: number,
  ): EventHandler<"subagent.complete"> {
    return (event) => {
      // Only process events for this session
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as SubagentCompleteEventData;

      const busEvent: BusEvent<"stream.agent.complete"> = {
        type: "stream.agent.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: data.subagentId,
          success: data.success,
          result: data.result ? String(data.result) : undefined,
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

  /**
   * Create a handler for session.idle events from the SDK.
   *
   * With the `promptAsync()` pattern, the completion promise in
   * `startStreaming()` handles publishing idle. This handler is a no-op for
   * the `sendAsync` path to avoid double-publishing. For the legacy stream
   * path, idle is published after the `for await` loop completes.
   */
  private createSessionIdleHandler(
    _runId: number,
  ): EventHandler<"session.idle"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }
      // No-op: completion is handled by the sendAsync completion promise
      // or the post-loop logic in the legacy stream fallback path.
    };
  }

  /**
   * Create a handler for session.error events from the SDK.
   */
  private createSessionErrorHandler(
    runId: number,
  ): EventHandler<"session.error"> {
    return (event) => {
      // Only process events for this session
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const error =
        typeof event.data.error === "string"
          ? event.data.error
          : (event.data.error as Error).message;

      const busEvent: BusEvent<"stream.session.error"> = {
        type: "stream.session.error",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          error,
          code: event.data.code,
        },
      };

      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for usage events from the SDK.
   *
   * OpenCode's `message.updated` SSE fires multiple times per message with
   * cumulative-within-message token counts. Across messages (in multi-turn
   * agentic flows), each message starts from 0. We track both the latest
   * within-message value and the cross-message total so the bus event carries
   * a monotonically increasing session-wide total.
   */
  private createUsageHandler(runId: number): EventHandler<"usage"> {
    return (event) => {
      // Only process events for this session
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as Record<string, number | string | undefined>;
      const inputTokens = (data.inputTokens as number) ?? (data.input_tokens as number) ?? 0;
      const outputTokens = (data.outputTokens as number) ?? (data.output_tokens as number) ?? 0;
      const model = data.model as string | undefined;

      // Skip zero-valued events
      if (outputTokens <= 0 && inputTokens <= 0) return;

      // Detect new message: when the incoming outputTokens is LESS than the
      // last seen value, it means a new message started. Add the previous
      // message's final count to the running total and start fresh.
      if (outputTokens < this.lastSeenOutputTokens) {
        this.accumulatedOutputTokens += this.lastSeenOutputTokens;
      }
      this.lastSeenOutputTokens = outputTokens;

      const busEvent: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          inputTokens,
          outputTokens: this.accumulatedOutputTokens + outputTokens,
          model,
        },
      };

      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for permission.requested events from the SDK.
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

  /**
   * Create a handler for human_input_required events from the SDK.
   */
  private createHumanInputRequiredHandler(
    runId: number,
  ): EventHandler<"human_input_required"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as HumanInputRequiredEventData;
      const busEvent: BusEvent<"stream.human_input_required"> = {
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
      };

      this.bus.publish(busEvent);
    };
  }

  /**
   * Create a handler for skill.invoked events from the SDK.
   */
  private createSkillInvokedHandler(
    runId: number,
  ): EventHandler<"skill.invoked"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as SkillInvokedEventData;
      const busEvent: BusEvent<"stream.skill.invoked"> = {
        type: "stream.skill.invoked",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          skillName: data.skillName,
          skillPath: data.skillPath,
        },
      };

      this.bus.publish(busEvent);
    };
  }

  /**
   * Create handler for session.compaction events.
   */
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
   * Create handler for session.truncation events.
   */
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

  /**
   * Create handler for turn.start events.
   */
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
          turnId: data.turnId ?? `turn_${Date.now()}`,
        },
      });
    };
  }

  /**
   * Create handler for turn.end events.
   */
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
        data: {
          turnId: data.turnId ?? `turn_${Date.now()}`,
        },
      });
    };
  }

  /**
   * Create handler for tool.partial_result events.
   */
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

  /**
   * Create handler for session.info events.
   */
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

  /**
   * Create handler for session.warning events.
   */
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

  /**
   * Create handler for session.title_changed events.
   */
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
   * Publish a deferred stream.session.idle event.
   */
  private publishSessionIdle(runId: number, reason: string): void {
    const busEvent: BusEvent<"stream.session.idle"> = {
      type: "stream.session.idle",
      sessionId: this.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        reason,
      },
    };

    this.bus.publish(busEvent);
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

  /**
   * Clean up SDK event subscriptions.
   */
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

  private cleanupSubscriptions(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
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
    this.thinkingBlocks.clear();
    this.pendingToolIdsByName.clear();
    this.toolCorrelationAliases.clear();
    this.syntheticToolCounter = 0;
    this.lastSeenOutputTokens = 0;
    this.accumulatedOutputTokens = 0;
  }
}
