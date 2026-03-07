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

import type { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import type {
  SDKStreamAdapter,
  StreamAdapterOptions,
} from "@/services/events/adapters/types.ts";
import type {
  WorkflowRuntimeFeatureFlags,
  WorkflowRuntimeFeatureFlagOverrides,
} from "@/services/workflows/runtime-contracts.ts";
import {
  DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  resolveWorkflowRuntimeFeatureFlags,
} from "@/services/workflows/runtime-contracts.ts";
import {
  createTurnMetadataState,
  normalizeAgentTaskMetadata,
  normalizeTurnEndMetadata,
  normalizeTurnStartId,
  resetTurnMetadataState,
} from "@/services/events/adapters/task-turn-normalization.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import type {
  CodingAgentClient,
  Session,
  AgentMessage,
  AgentEvent,
  EventType,
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
  ReasoningDeltaEventData,
  ReasoningCompleteEventData,
} from "@/services/agents/types.ts";
import type { OpenCodeProviderEventSource } from "@/services/agents/provider-events.ts";
import { classifyError, computeDelay, retrySleep, DEFAULT_MAX_RETRIES } from "@/services/events/adapters/retry.ts";

const DEFAULT_SUBAGENT_TASK_LABEL = "sub-agent task";
const TOOL_START_PLACEHOLDER_SIGNATURE = "__placeholder__";
const TASK_CHILD_SESSION_SYNC_POLL_MS = 500;
const TASK_CHILD_SESSION_FINAL_POLL_MS = 200;
const TASK_CHILD_SESSION_FINAL_STABLE_POLLS = 2;

function isGenericSubagentTaskLabel(task: string | undefined): boolean {
  const normalized = (task ?? "").trim().toLowerCase();
  return normalized === "" || normalized === DEFAULT_SUBAGENT_TASK_LABEL || normalized === "subagent task";
}

interface TaskChildSessionSyncState {
  childSessionId: string;
  taskCorrelationId: string;
  runId: number;
  taskCompleted: boolean;
  stablePollsAfterCompletion: number;
  lastSnapshotSignature: string;
  pollHandle: ReturnType<typeof setTimeout> | null;
}

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
  // Track thinking blocks to emit complete events without cross-session leakage.
  private thinkingBlocks = new Map<string, {
    startTime: number;
    sourceKey: string;
    eventSessionId: string;
    agentId?: string;
  }>();
  private pendingToolIdsByName = new Map<string, string[]>();
  private toolStartSignatureByToolId = new Map<string, string>();
  private toolCorrelationAliases = new Map<string, string>();
  /** Maps task-tool correlation ID -> task metadata for subagent label hydration */
  private taskToolMetadata = new Map<string, {
    description: string;
    isBackground: boolean;
    agentType?: string;
    subagentSessionId?: string;
  }>();
  /** Ordered task tool IDs awaiting subagent.start correlation fallback */
  private pendingTaskToolCorrelationIds: string[] = [];
  /** Ordered subagent correlation IDs awaiting task tool alias hydration */
  private pendingSubagentCorrelationIds: string[] = [];
  /** Maps task-tool correlation ID -> subagentId */
  private toolUseIdToSubagentId = new Map<string, string>();
  /** Maps subagentId -> correlation ID for replayed start events missing IDs */
  private subagentIdToCorrelationId = new Map<string, string>();
  /** Maps subagentSessionId -> correlation ID for replayed start events missing IDs */
  private subagentSessionToCorrelationId = new Map<string, string>();
  /** Parent-agent/tool pairs already counted by SubagentToolTracker */
  private trackedToolStartKeys = new Set<string>();
  /** Tool starts that arrived before parent sub-agent registration */
  private earlyToolEvents = new Map<string, Array<{ toolId: string; toolName: string }>>();
  /** Active sub-agent tool contexts keyed by tool correlation ID */
  private activeSubagentToolsById = new Map<string, { parentAgentId: string; toolName: string }>();
  /** Child sessions already hydrated from OpenCode session.messages() */
  private hydratedChildSessions = new Set<string>();
  /** Tool IDs that have already completed for this run */
  private completedToolIds = new Set<string>();
  /** Active child-session sync loops keyed by child session ID */
  private taskChildSessionSyncStates = new Map<string, TaskChildSessionSyncState>();
  private syntheticToolCounter = 0;
  private ownedSessionIds = new Set<string>();
  private subagentSessionToAgentId = new Map<string, string>();
  private subagentTracker: SubagentToolTracker | null = null;
  private runtimeFeatureFlags: WorkflowRuntimeFeatureFlags = {
    ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  };
  private turnMetadataState = createTurnMetadataState();

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

  private toAgentEvent<T extends EventType>(
    event: { type: T; sessionId: string; timestamp: number; data: unknown },
  ): AgentEvent<T> {
    return {
      type: event.type,
      sessionId: event.sessionId,
      timestamp: new Date(event.timestamp).toISOString(),
      data: event.data as AgentEvent<T>["data"],
    } as AgentEvent<T>;
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
    const { runId, messageId, agent, runtimeFeatureFlags, abortSignal, skillCommand } = options;

    // Clean up any existing subscriptions from a previous startStreaming() call
    // to prevent subscription accumulation on re-entry without dispose()
    this.cleanupSubscriptions();

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Reset state
    this.textAccumulator = "";
    this.thinkingBlocks.clear();
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
    this.hydratedChildSessions.clear();
    this.completedToolIds.clear();
    this.clearTaskChildSessionSyncStates();
    this.syntheticToolCounter = 0;
    this.ownedSessionIds = new Set([this.sessionId]);
    this.subagentSessionToAgentId.clear();
    this.subagentTracker = new SubagentToolTracker(this.bus, this.sessionId, runId);
    this.lastSeenOutputTokens = 0;
    this.accumulatedOutputTokens = 0;
    this.runtimeFeatureFlags = this.resolveRuntimeFeatureFlags(runtimeFeatureFlags);
    resetTurnMetadataState(this.turnMetadataState);

    this.publishSessionStart(runId);

    const client = this.client ?? (session as Session & { __client?: CodingAgentClient }).__client;
    const providerClient = client as (CodingAgentClient & OpenCodeProviderEventSource) | undefined;
    if (!providerClient || typeof providerClient.onProviderEvent !== "function") {
      throw new Error("OpenCode stream adapter requires provider event support.");
    }

    const messageDeltaHandler = this.createMessageDeltaHandler(runId, messageId);
    const messageCompleteHandler = this.createMessageCompleteHandler(runId, messageId);
    const reasoningDeltaHandler = this.createReasoningDeltaHandler(runId, messageId);
    const reasoningCompleteHandler = this.createReasoningCompleteHandler(runId);
    const toolStartHandler = this.createToolStartHandler(runId);
    const toolCompleteHandler = this.createToolCompleteHandler(runId);
    const subagentStartHandler = this.createSubagentStartHandler(runId);
    const subagentCompleteHandler = this.createSubagentCompleteHandler(runId);
    const subagentUpdateHandler = this.createSubagentUpdateHandler(runId);
    const sessionIdleHandler = this.createSessionIdleHandler(runId);
    const sessionErrorHandler = this.createSessionErrorHandler(runId);
    const usageHandler = this.createUsageHandler(runId);
    const permissionHandler = this.createPermissionRequestedHandler(runId);
    const humanInputHandler = this.createHumanInputRequiredHandler(runId);
    const skillHandler = this.createSkillInvokedHandler(runId);
    const sessionCompactionHandler = this.createSessionCompactionHandler(runId);
    const sessionTruncationHandler = this.createSessionTruncationHandler(runId);
    const turnStartHandler = this.createTurnStartHandler(runId);
    const turnEndHandler = this.createTurnEndHandler(runId);
    const toolPartialHandler = this.createToolPartialResultHandler(runId);
    const sessionInfoHandler = this.createSessionInfoHandler(runId);
    const sessionWarningHandler = this.createSessionWarningHandler(runId);
    const sessionTitleChangedHandler = this.createSessionTitleChangedHandler(runId);

    const unsubProvider = providerClient.onProviderEvent((event) => {
      switch (event.type) {
        case "message.delta":
          messageDeltaHandler(this.toAgentEvent(event));
          break;
        case "message.complete":
          messageCompleteHandler(this.toAgentEvent(event));
          break;
        case "reasoning.delta":
          reasoningDeltaHandler(this.toAgentEvent(event));
          break;
        case "reasoning.complete":
          reasoningCompleteHandler(this.toAgentEvent(event));
          break;
        case "tool.start":
          toolStartHandler(this.toAgentEvent(event));
          break;
        case "tool.complete":
          toolCompleteHandler(this.toAgentEvent(event));
          break;
        case "tool.partial_result":
          toolPartialHandler(this.toAgentEvent(event));
          break;
        case "subagent.start":
          subagentStartHandler(this.toAgentEvent(event));
          break;
        case "subagent.complete":
          subagentCompleteHandler(this.toAgentEvent(event));
          break;
        case "subagent.update":
          subagentUpdateHandler(this.toAgentEvent(event));
          break;
        case "session.idle":
          sessionIdleHandler(this.toAgentEvent(event));
          break;
        case "session.error":
          sessionErrorHandler(this.toAgentEvent(event));
          break;
        case "usage":
          usageHandler(this.toAgentEvent(event));
          break;
        case "permission.requested":
          permissionHandler(this.toAgentEvent(event));
          break;
        case "human_input_required":
          humanInputHandler(this.toAgentEvent(event));
          break;
        case "skill.invoked":
          skillHandler(this.toAgentEvent(event));
          break;
        case "session.compaction":
          sessionCompactionHandler(this.toAgentEvent(event));
          break;
        case "session.truncation":
          sessionTruncationHandler(this.toAgentEvent(event));
          break;
        case "turn.start":
          turnStartHandler(this.toAgentEvent(event));
          break;
        case "turn.end":
          turnEndHandler(this.toAgentEvent(event));
          break;
        case "session.info":
          sessionInfoHandler(this.toAgentEvent(event));
          break;
        case "session.warning":
          sessionWarningHandler(this.toAgentEvent(event));
          break;
        case "session.title_changed":
          sessionTitleChangedHandler(this.toAgentEvent(event));
          break;
        default:
          break;
      }
    });
    this.unsubscribers.push(unsubProvider);

    try {
      // Fire prompt via sendAsync (fire-and-forget) — all content arrives via SSE events.
      // Fall back to stream() for clients that don't implement sendAsync.
      if (session.sendAsync) {
        // Create a promise that resolves when session.idle or session.error fires
        const completionPromise = new Promise<{ reason: string; error?: string }>((resolve) => {
          let resolved = false;
          const safeResolve = (value: { reason: string; error?: string }) => {
            if (resolved) return;
            resolved = true;
            resolve(value);
          };
          const handleAbort = () => safeResolve({ reason: "aborted" });

          const onIdle = providerClient.onProviderEvent((event) => {
            if (event.type !== "session.idle" || event.sessionId !== this.sessionId) return;
            safeResolve({ reason: event.data.reason ?? "idle" });
          });
          this.unsubscribers.push(onIdle);

          const onError = providerClient.onProviderEvent((event) => {
            if (event.type !== "session.error" || event.sessionId !== this.sessionId) return;
            safeResolve({ reason: "error", error: event.data.error });
          });
          this.unsubscribers.push(onError);

          const adapterAbortSignal = this.abortController?.signal;
          if (adapterAbortSignal) {
            if (adapterAbortSignal.aborted) {
              handleAbort();
            } else {
              adapterAbortSignal.addEventListener("abort", handleAbort, { once: true });
              this.unsubscribers.push(
                () => adapterAbortSignal.removeEventListener("abort", handleAbort),
              );
            }
          }

          if (abortSignal) {
            if (abortSignal.aborted) {
              handleAbort();
            } else {
              abortSignal.addEventListener("abort", handleAbort, { once: true });
              this.unsubscribers.push(
                () => abortSignal.removeEventListener("abort", handleAbort),
              );
            }
          }
        });

        const dispatchAbortSignal = (() => {
          const adapterAbortSignal = this.abortController?.signal;
          if (adapterAbortSignal && abortSignal) {
            return AbortSignal.any([adapterAbortSignal, abortSignal]);
          }
          return adapterAbortSignal ?? abortSignal;
        })();

        const isDispatchAbortError = (error: unknown): boolean => {
          if (dispatchAbortSignal?.aborted) {
            return true;
          }
          if (error instanceof DOMException && error.name === "AbortError") {
            return true;
          }
          if (!(error instanceof Error)) {
            return false;
          }
          const errorWithCode = error as Error & { code?: string };
          if (
            error.name === "AbortError"
            || errorWithCode.code === "ABORT_ERR"
            || errorWithCode.code === "ERR_CANCELED"
          ) {
            return true;
          }
          return error.message.toLowerCase().includes("aborted");
        };

        const dispatchOptions = agent || dispatchAbortSignal
          ? { agent: agent ?? undefined, abortSignal: dispatchAbortSignal }
          : undefined;

        try {
          if (skillCommand) {
            await session.command!(skillCommand.name, skillCommand.args, dispatchOptions);
          } else {
            await session.sendAsync(message, dispatchOptions);
          }
        } catch (error) {
          if (!isDispatchAbortError(error)) {
            throw error;
          }
        }

        // Wait for completion signal from SSE
        const completion = await completionPromise;

        // Publish stream.text.complete if we accumulated any text
        if (this.textAccumulator.length > 0) {
          this.publishTextComplete(runId, messageId);
        }

        if (completion.error) {
          this.publishSessionError(runId, new Error(completion.error));
        }

        // Flush orphaned tool completions before idle so the UI does not
        // evaluate session.idle against stale pending tool state.
        this.cleanupOrphanedTools(runId);
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
            // Flush orphaned tool completions before idle so tool lifecycle
            // reaches a terminal state prior to stream finalization.
            this.cleanupOrphanedTools(runId);
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
      // Flush orphaned tool completions before idle so the UI can finalize
      // without being blocked by stale pending tools.
      this.cleanupOrphanedTools(runId);
      // Always publish idle on error so the UI can finalize.
      this.publishSessionIdle(runId, "error");
    } finally {
      // Safety net: if any late orphaned tools remain, force-complete them.
      this.cleanupOrphanedTools(runId);
      // Keep subscriptions active until dispose() so late lifecycle events
      // (e.g. delayed tool.complete) can still be published to the bus.
    }
  }

  private createReasoningDeltaHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"reasoning.delta"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) return;
      const data = event.data as ReasoningDeltaEventData;
      if (this.abortController?.signal.aborted) return;
      if (!data.delta || data.delta.length === 0) return;
      const sourceKey = data.reasoningId || "reasoning";
      this.ensureThinkingBlock(sourceKey, event.sessionId, undefined);

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
      if (this.abortController?.signal.aborted) return;
      const sourceKey = data.reasoningId || "reasoning";
      const thinkingKey = this.getThinkingBlockKey(sourceKey, event.sessionId, undefined);
      const start = thinkingKey ? this.thinkingBlocks.get(thinkingKey)?.startTime : undefined;
      const durationMs = start ? Date.now() - start : 0;
      if (thinkingKey) {
        this.thinkingBlocks.delete(thinkingKey);
      }

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
        this.ensureThinkingBlock(sourceKey, this.sessionId, undefined);

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
        const thinkingKey = this.getThinkingBlockKey(sourceKey, this.sessionId, undefined);

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
        if (thinkingKey) {
          this.thinkingBlocks.delete(thinkingKey);
        }
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
      this.removeActiveSubagentToolContext(toolId, explicitToolId);

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
      const normalizedContentType = typeof contentType === "string"
        ? contentType.trim().toLowerCase()
        : "";

      if (!delta || delta.length === 0) return;

      if (normalizedContentType === "thinking" || normalizedContentType === "reasoning") {
        const sourceKey = thinkingSourceKey ?? "default";
        this.ensureThinkingBlock(sourceKey, event.sessionId, undefined);

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
      if (event.sessionId !== this.sessionId) return;

      this.publishThinkingCompleteForScope(runId, event.sessionId, undefined);

      // Publish text complete only for the parent session.
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
      const data = event.data as ToolStartEventData;
      const dataRecord = data as Record<string, unknown>;
      const parentToolUseId = this.resolveParentToolCorrelationId(dataRecord);
      const parentAgentId = this.resolveParentAgentId(
        event.sessionId,
        dataRecord,
      );
      if (event.sessionId !== this.sessionId && !parentAgentId) {
        return;
      }
      const sdkToolUseId = this.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.asString(data.toolCallId);
      const sdkCorrelationId = sdkToolUseId ?? sdkToolCallId;
      const resolvedSdkCorrelationId = this.resolveToolCorrelationId(sdkCorrelationId);
      const toolName = this.normalizeToolName(data.toolName);
      const taskCorrelationId = resolvedSdkCorrelationId ?? sdkCorrelationId;
      const toolId = this.resolveToolStartId(
        resolvedSdkCorrelationId ?? sdkCorrelationId,
        runId,
        toolName,
      );
      const toolMetadata = this.asRecord(dataRecord.toolMetadata);
      const toolStartSignature = this.buildToolStartSignature(
        toolName,
        (data.toolInput ?? {}) as Record<string, unknown>,
        toolMetadata,
        parentAgentId,
      );
      const previousStartSignature = this.toolStartSignatureByToolId.get(toolId);
      if (previousStartSignature === toolStartSignature) {
        return;
      }
      const hasTaskDispatchDetails = this.hasTaskDispatchDetails(data.toolInput);
      if (
        this.isTaskTool(toolName)
        && !hasTaskDispatchDetails
        && !previousStartSignature
      ) {
        // OpenCode may emit an initial placeholder task.start with empty input
        // before the hydrated payload. Suppress the placeholder to avoid a
        // brief generic task widget.
        this.toolStartSignatureByToolId.set(toolId, TOOL_START_PLACEHOLDER_SIGNATURE);
        this.removeQueuedToolId(toolName, toolId);
        this.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);
        if (taskCorrelationId) {
          this.recordPendingTaskToolCorrelationId(taskCorrelationId);
        }
        return;
      }
      this.toolStartSignatureByToolId.set(toolId, toolStartSignature);
      this.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);
      if (this.isTaskTool(toolName) && taskCorrelationId) {
        const metadata = this.extractTaskToolMetadata(data.toolInput, dataRecord);
        const existingMetadata = this.taskToolMetadata.get(taskCorrelationId);
        const mergedMetadata = this.mergeTaskToolMetadata(existingMetadata, metadata);
        this.taskToolMetadata.set(taskCorrelationId, mergedMetadata);
        this.recordPendingTaskToolCorrelationId(taskCorrelationId);
        this.resolvePendingSubagentTaskCorrelation(taskCorrelationId);
        this.registerTaskSubagentSessionCorrelation(taskCorrelationId, mergedMetadata.subagentSessionId);
        this.maybeHydrateTaskChildSession(
          runId,
          taskCorrelationId,
          mergedMetadata.subagentSessionId,
          parentAgentId,
        );
      }
      const effectiveParentAgentId = parentAgentId;
      if (effectiveParentAgentId) {
        this.recordActiveSubagentToolContext(
          toolId,
          toolName,
          effectiveParentAgentId,
          sdkToolUseId,
          sdkToolCallId,
          taskCorrelationId,
        );
        const trackerKey = this.buildTrackedToolStartKey(effectiveParentAgentId, toolId);
        if (!this.trackedToolStartKeys.has(trackerKey)) {
          if (this.subagentTracker?.hasAgent(effectiveParentAgentId)) {
            this.trackedToolStartKeys.add(trackerKey);
            this.subagentTracker.onToolStart(effectiveParentAgentId, toolName);
          } else {
            this.queueEarlyToolEvent(effectiveParentAgentId, toolId, toolName);
            if (parentToolUseId) {
              this.queueEarlyToolEvent(parentToolUseId, toolId, toolName);
            }
          }
        }
      } else if (parentToolUseId) {
        this.queueEarlyToolEvent(parentToolUseId, toolId, toolName);
        const correlatedParentAgentId = this.toolUseIdToSubagentId.get(parentToolUseId);
        if (correlatedParentAgentId) {
          this.recordActiveSubagentToolContext(
            toolId,
            toolName,
            correlatedParentAgentId,
            sdkToolUseId,
            sdkToolCallId,
            parentToolUseId,
          );
        }
      }
      const attributedParentAgentId = parentAgentId
        ?? this.activeSubagentToolsById.get(toolId)?.parentAgentId;

      if (event.sessionId === this.sessionId && parentToolUseId && !attributedParentAgentId) {
        return;
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
          ...(toolMetadata ? { toolMetadata } : {}),
          ...(attributedParentAgentId ? { parentAgentId: attributedParentAgentId } : {}),
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
      const data = event.data as ToolCompleteEventData;
      const dataRecord = data as Record<string, unknown>;
      const parentToolUseId = this.resolveParentToolCorrelationId(dataRecord);
      const parentAgentId = this.resolveParentAgentId(
        event.sessionId,
        dataRecord,
      );
      const sdkToolUseId = this.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.asString(data.toolCallId);
      const sdkCorrelationId = this.resolveToolCorrelationId(
        sdkToolUseId ?? sdkToolCallId,
      );
      const knownParentAgentId = sdkCorrelationId
        ? this.activeSubagentToolsById.get(sdkCorrelationId)?.parentAgentId
        : undefined;
      if (event.sessionId !== this.sessionId && !parentAgentId && !knownParentAgentId) {
        return;
      }
      const toolName = this.normalizeToolName(data.toolName);
      const taskCorrelationId = this.isTaskTool(toolName) ? sdkCorrelationId : undefined;
      const toolId = this.resolveToolCompleteId(sdkCorrelationId, runId, toolName);
      const startSignature = this.toolStartSignatureByToolId.get(toolId);
      this.toolStartSignatureByToolId.delete(toolId);
      if (
        this.isTaskTool(toolName)
        && startSignature === TOOL_START_PLACEHOLDER_SIGNATURE
      ) {
        return;
      }
      const toolInput = this.asRecord((data as Record<string, unknown>).toolInput);
      const toolMetadata = this.asRecord((data as Record<string, unknown>).toolMetadata);
      const taskMetadata = taskCorrelationId ? this.taskToolMetadata.get(taskCorrelationId) : undefined;
      this.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);
      const activeToolContext = this.activeSubagentToolsById.get(toolId);
      this.removeActiveSubagentToolContext(toolId, sdkToolUseId, sdkToolCallId);
      const effectiveParentAgentId = parentAgentId
        ?? knownParentAgentId
        ?? activeToolContext?.parentAgentId;
      if (effectiveParentAgentId) {
        const trackerKey = this.buildTrackedToolStartKey(effectiveParentAgentId, toolId);
        const wasTracked = this.trackedToolStartKeys.delete(trackerKey);
        if (wasTracked) {
          this.subagentTracker?.onToolComplete(effectiveParentAgentId);
          this.removeEarlyToolEvent(effectiveParentAgentId, toolId);
        }
      }
      if (parentToolUseId && this.toolUseIdToSubagentId.has(parentToolUseId)) {
        this.removeEarlyToolEvent(parentToolUseId, toolId);
      }
      const attributedParentAgentId = parentAgentId
        ?? knownParentAgentId
        ?? activeToolContext?.parentAgentId;

      if (event.sessionId === this.sessionId && parentToolUseId && !attributedParentAgentId) {
        return;
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
          ...(toolMetadata
            ? { toolMetadata }
            : taskMetadata?.subagentSessionId
              ? { toolMetadata: { sessionId: taskMetadata.subagentSessionId } }
              : {}),
          ...(attributedParentAgentId ? { parentAgentId: attributedParentAgentId } : {}),
        },
      };

      this.bus.publish(busEvent);
      this.completedToolIds.add(toolId);

      if (
        this.isTaskTool(toolName)
        && data.success
        && taskCorrelationId
      ) {
        void this.hydrateCompletedTaskDispatch(
          runId,
          event.sessionId,
          taskCorrelationId,
          toolId,
          attributedParentAgentId,
        );
      }
    };
  }

  /**
   * Create a handler for subagent.start events from the SDK.
   */
  private createSubagentStartHandler(
    runId: number,
  ): EventHandler<"subagent.start"> {
    return (event) => {
      const data = event.data as SubagentStartEventData;
      const dataRecord = data as Record<string, unknown>;
      const subagentSessionId = this.asString(
        dataRecord.subagentSessionId,
      );
      const rawSdkCorrelationId = this.asString(
        data.toolUseId ?? data.toolUseID ?? data.toolCallId,
      );
      const canonicalRawCorrelationId = this.resolveToolCorrelationId(rawSdkCorrelationId)
        ?? rawSdkCorrelationId;
      const hasTaskCorrelation = Boolean(
        canonicalRawCorrelationId
          && (
            this.taskToolMetadata.has(canonicalRawCorrelationId)
            || this.pendingTaskToolCorrelationIds.includes(canonicalRawCorrelationId)
          ),
      );
      const isKnownSubagent = this.subagentIdToCorrelationId.has(data.subagentId);
      // Accept events from parent/owned sessions, plus correlation-backed
      // subagent starts that may arrive on a child session frame.
      if (
        !this.isOwnedSession(event.sessionId)
        && !hasTaskCorrelation
        && !isKnownSubagent
      ) {
        return;
      }

      this.subagentTracker?.registerAgent(data.subagentId);
      if (subagentSessionId) {
        this.ownedSessionIds.add(subagentSessionId);
        this.subagentSessionToAgentId.set(subagentSessionId, data.subagentId);
      }

      // Extract SDK correlation IDs and canonicalize through alias mappings.
      let sdkCorrelationId = this.resolveToolCorrelationId(rawSdkCorrelationId);
      let parentToolUseId = this.resolveToolCorrelationId(this.asString(
        dataRecord.parentToolUseId
          ?? dataRecord.parent_tool_use_id
          ?? dataRecord.parentToolUseID,
      ));

      if (!sdkCorrelationId) {
        sdkCorrelationId = this.resolveKnownSubagentCorrelation(data.subagentId, subagentSessionId);
      }
      if (!parentToolUseId) {
        parentToolUseId = this.resolveKnownSubagentCorrelation(data.subagentId, subagentSessionId);
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
      } else if (!this.taskToolMetadata.has(sdkCorrelationId)) {
        const inferredTaskToolId = this.resolveNextPendingTaskToolCorrelationId();
        if (inferredTaskToolId && inferredTaskToolId !== sdkCorrelationId) {
          this.registerPreferredToolCorrelationAlias(inferredTaskToolId, sdkCorrelationId);
          sdkCorrelationId = inferredTaskToolId;
          parentToolUseId = parentToolUseId ?? inferredTaskToolId;
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

      if (sdkCorrelationId) {
        const existingMappedAgentId = this.toolUseIdToSubagentId.get(sdkCorrelationId);
        if (existingMappedAgentId && existingMappedAgentId !== data.subagentId) {
          return;
        }
        this.toolUseIdToSubagentId.set(sdkCorrelationId, data.subagentId);
        this.subagentIdToCorrelationId.set(data.subagentId, sdkCorrelationId);
        this.removePendingTaskToolCorrelationId(sdkCorrelationId);
      }
      if (parentToolUseId && parentToolUseId !== sdkCorrelationId) {
        this.toolUseIdToSubagentId.set(parentToolUseId, data.subagentId);
        if (!sdkCorrelationId) {
          this.subagentIdToCorrelationId.set(data.subagentId, parentToolUseId);
        }
        this.removePendingTaskToolCorrelationId(parentToolUseId);
      }
      if (subagentSessionId) {
        const knownCorrelationId = sdkCorrelationId ?? parentToolUseId;
        if (knownCorrelationId) {
          this.subagentSessionToCorrelationId.set(subagentSessionId, knownCorrelationId);
        }
      }
      for (const [knownSubagentSessionId, knownCorrelationId] of this.subagentSessionToCorrelationId.entries()) {
        const resolvedKnownCorrelationId = this.resolveToolCorrelationId(knownCorrelationId)
          ?? knownCorrelationId;
        const resolvedSdkCorrelationId = sdkCorrelationId
          ? (this.resolveToolCorrelationId(sdkCorrelationId) ?? sdkCorrelationId)
          : undefined;
        const resolvedParentToolUseId = parentToolUseId
          ? (this.resolveToolCorrelationId(parentToolUseId) ?? parentToolUseId)
          : undefined;
        if (
          resolvedKnownCorrelationId !== resolvedSdkCorrelationId
          && resolvedKnownCorrelationId !== resolvedParentToolUseId
        ) {
          continue;
        }
        this.ownedSessionIds.add(knownSubagentSessionId);
        this.subagentSessionToAgentId.set(knownSubagentSessionId, data.subagentId);
      }

      this.replayEarlyToolEvents(
        data.subagentId,
        data.subagentId,
        rawSdkCorrelationId,
        sdkCorrelationId,
        parentToolUseId,
      );

      if (rawSdkCorrelationId && !this.taskToolMetadata.has(rawSdkCorrelationId)) {
        this.recordPendingSubagentCorrelationId(rawSdkCorrelationId);
      } else if (rawSdkCorrelationId) {
        this.removePendingSubagentCorrelationId(rawSdkCorrelationId);
      }
      if (sdkCorrelationId) {
        this.removePendingSubagentCorrelationId(sdkCorrelationId);
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
   */
  private createSubagentCompleteHandler(
    runId: number,
  ): EventHandler<"subagent.complete"> {
    return (event) => {
      const data = event.data as SubagentCompleteEventData;
      const isKnownSubagent = this.subagentIdToCorrelationId.has(data.subagentId)
        || Array.from(this.subagentSessionToAgentId.values()).includes(data.subagentId);
      if (!this.isOwnedSession(event.sessionId) && !isKnownSubagent) {
        return;
      }

      this.subagentTracker?.removeAgent(data.subagentId);
      this.subagentIdToCorrelationId.delete(data.subagentId);
      for (const [subagentSessionId, agentId] of this.subagentSessionToAgentId.entries()) {
        if (agentId === data.subagentId) {
          this.subagentSessionToAgentId.delete(subagentSessionId);
          this.ownedSessionIds.delete(subagentSessionId);
          this.subagentSessionToCorrelationId.delete(subagentSessionId);
        }
      }
      for (const [toolUseId, subagentId] of this.toolUseIdToSubagentId.entries()) {
        if (subagentId === data.subagentId) {
          this.toolUseIdToSubagentId.delete(toolUseId);
          this.taskToolMetadata.delete(toolUseId);
          this.removePendingTaskToolCorrelationId(toolUseId);
          this.removePendingSubagentCorrelationId(toolUseId);
          this.earlyToolEvents.delete(toolUseId);
        }
      }
      this.earlyToolEvents.delete(data.subagentId);

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
      const data = event.data as SubagentUpdateEventData;
      const isKnownSubagent = this.subagentIdToCorrelationId.has(data.subagentId)
        || Array.from(this.subagentSessionToAgentId.values()).includes(data.subagentId);
      if (!this.isOwnedSession(event.sessionId) && !isKnownSubagent) return;

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
      if (!this.isOwnedSession(event.sessionId)) {
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
      if (!this.isOwnedSession(event.sessionId)) {
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
      const data = event.data as SkillInvokedEventData;
      const parentAgentId = this.resolveParentAgentId(
        event.sessionId,
        data as Record<string, unknown>,
      );
      if (event.sessionId !== this.sessionId && !parentAgentId) {
        return;
      }
      const busEvent: BusEvent<"stream.skill.invoked"> = {
        type: "stream.skill.invoked",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          skillName: data.skillName,
          skillPath: data.skillPath,
          ...(parentAgentId ? { agentId: parentAgentId } : {}),
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
          turnId: normalizeTurnStartId(
            data.turnId,
            this.turnMetadataState,
          ),
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
        data: normalizeTurnEndMetadata(
          data,
          this.turnMetadataState,
        ),
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
      const data = event.data as ToolPartialResultEventData;
      const toolCallId = this.resolveToolCorrelationId(this.asString(data.toolCallId))
        ?? this.asString(data.toolCallId);
      const activeContext = toolCallId
        ? this.activeSubagentToolsById.get(toolCallId)
        : undefined;
      const parentAgentId = activeContext?.parentAgentId
        ?? this.resolveParentAgentId(event.sessionId, data as Record<string, unknown>);
      if (event.sessionId !== this.sessionId && !parentAgentId) return;

      this.bus.publish({
        type: "stream.tool.partial_result",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolCallId: data.toolCallId,
          partialOutput: data.partialOutput,
          ...(parentAgentId ? { parentAgentId } : {}),
        },
      });

      if (!toolCallId || !activeContext || !parentAgentId) {
        return;
      }
      if (this.subagentTracker?.hasAgent(parentAgentId)) {
        this.subagentTracker.onToolProgress(parentAgentId, activeContext.toolName);
      }
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

  private isTaskTool(toolName: string): boolean {
    const normalized = toolName.toLowerCase();
    return normalized === "task" || normalized === "launch_agent" || normalized === "agent";
  }

  private extractTaskToolMetadata(
    toolInput: unknown,
    eventData?: Record<string, unknown>,
  ): { description: string; isBackground: boolean; agentType?: string; subagentSessionId?: string } {
    const record = this.asRecord(toolInput) ?? {};
    const toolMetadata = this.asRecord(eventData?.toolMetadata)
      ?? this.asRecord(record.metadata)
      ?? {};
    const agentType = this.asString(record.subagent_type)
      ?? this.asString(record.subagentType)
      ?? this.asString(record.agent_type)
      ?? this.asString(record.agentType)
      ?? this.asString(record.agent);
    return {
      description: this.asString(record.description)
        ?? this.asString(record.prompt)
        ?? this.asString(record.task)
        ?? "",
      isBackground: record.run_in_background === true
        || this.asString(record.mode)?.toLowerCase() === "background",
      agentType,
      subagentSessionId: this.asString(toolMetadata.sessionId)
        ?? this.asString(toolMetadata.sessionID),
    };
  }

  private mergeTaskToolMetadata(
    existing: { description: string; isBackground: boolean; agentType?: string; subagentSessionId?: string } | undefined,
    incoming: { description: string; isBackground: boolean; agentType?: string; subagentSessionId?: string },
  ): { description: string; isBackground: boolean; agentType?: string; subagentSessionId?: string } {
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

  private hasTaskDispatchDetails(toolInput: unknown): boolean {
    const record = this.asRecord(toolInput) ?? {};
    const description = this.asString(record.description)
      ?? this.asString(record.task)
      ?? this.asString(record.title)
      ?? this.asString(record.prompt);
    const agentName = this.asString(record.subagent_type)
      ?? this.asString(record.subagentType)
      ?? this.asString(record.agent_type)
      ?? this.asString(record.agentType)
      ?? this.asString(record.agent);
    return Boolean(description || agentName);
  }

  private serializeForSignature(value: unknown): string {
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

  private buildToolStartSignature(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolMetadata: Record<string, unknown> | undefined,
    parentAgentId: string | undefined,
  ): string {
    return `${toolName}|${parentAgentId ?? ""}|${this.serializeForSignature(toolInput)}|${this.serializeForSignature(toolMetadata ?? {})}`;
  }

  private resolveToolCorrelationId(correlationId: string | undefined): string | undefined {
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

  private registerPreferredToolCorrelationAlias(
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

  private repointToolCorrelationAliases(
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

  private registerToolCorrelationAliases(
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

  private recordPendingSubagentCorrelationId(correlationId: string): void {
    if (this.pendingSubagentCorrelationIds.includes(correlationId)) {
      return;
    }
    this.pendingSubagentCorrelationIds.push(correlationId);
  }

  private removePendingSubagentCorrelationId(correlationId: string): void {
    this.pendingSubagentCorrelationIds = this.pendingSubagentCorrelationIds.filter(
      (candidate) => candidate !== correlationId,
    );
  }

  private resolvePendingSubagentTaskCorrelation(taskCorrelationId: string): void {
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

  private resolveKnownSubagentCorrelation(
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

  private buildTrackedToolStartKey(parentAgentId: string, toolId: string): string {
    return `${parentAgentId}::${toolId}`;
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

  private queueEarlyToolEvent(
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

  private removeEarlyToolEvent(
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

  private replayEarlyToolEvents(
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
        this.subagentTracker?.onToolStart(agentId, tool.toolName);
      }
      this.earlyToolEvents.delete(key);
    }
  }

  private registerTaskSubagentSessionCorrelation(
    taskCorrelationId: string,
    subagentSessionId: string | undefined,
  ): void {
    if (!subagentSessionId) {
      return;
    }
    this.subagentSessionToCorrelationId.set(subagentSessionId, taskCorrelationId);
    const mappedAgentId = this.toolUseIdToSubagentId.get(taskCorrelationId);
    if (!mappedAgentId) {
      return;
    }
    this.ownedSessionIds.add(subagentSessionId);
    this.subagentSessionToAgentId.set(subagentSessionId, mappedAgentId);
  }

  private maybeHydrateTaskChildSession(
    runId: number,
    taskCorrelationId: string,
    childSessionId: string | undefined,
    parentAgentId: string | undefined,
  ): void {
    if (!childSessionId) {
      return;
    }

    const resolvedParentAgentId = parentAgentId
      ?? this.toolUseIdToSubagentId.get(taskCorrelationId)
      ?? taskCorrelationId;
    this.ensureTaskChildSessionSync(
      runId,
      taskCorrelationId,
      childSessionId,
      resolvedParentAgentId,
    );
  }

  private async hydrateCompletedTaskDispatch(
    runId: number,
    parentSessionId: string,
    taskCorrelationId: string,
    toolId: string,
    attributedParentAgentId: string | undefined,
  ): Promise<void> {
    const childSessionId = await this.resolveCompletedTaskChildSessionId(
      parentSessionId,
      taskCorrelationId,
      toolId,
    );
    if (!childSessionId) {
      return;
    }

    const existingTaskMetadata = this.taskToolMetadata.get(taskCorrelationId);
    this.taskToolMetadata.set(taskCorrelationId, {
      description: existingTaskMetadata?.description ?? "",
      isBackground: existingTaskMetadata?.isBackground ?? false,
      agentType: existingTaskMetadata?.agentType,
      subagentSessionId: childSessionId,
    });
    this.registerTaskSubagentSessionCorrelation(taskCorrelationId, childSessionId);

    const parentAgentId = this.toolUseIdToSubagentId.get(taskCorrelationId)
      ?? attributedParentAgentId
      ?? taskCorrelationId;
    this.ensureTaskChildSessionSync(runId, taskCorrelationId, childSessionId, parentAgentId);
    await this.pollTaskChildSession(childSessionId);
    this.markTaskChildSessionSyncComplete(childSessionId);
  }

  private async resolveCompletedTaskChildSessionId(
    parentSessionId: string,
    taskCorrelationId: string,
    toolId: string,
  ): Promise<string | undefined> {
    const knownTaskMetadata = this.taskToolMetadata.get(taskCorrelationId);
    if (knownTaskMetadata?.subagentSessionId) {
      return knownTaskMetadata.subagentSessionId;
    }

    const messageFetcher = this.client;
    if (!messageFetcher?.getSessionMessagesWithParts) {
      return undefined;
    }

    try {
      const parentMessages = await messageFetcher.getSessionMessagesWithParts(parentSessionId);
      for (let messageIndex = parentMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = parentMessages[messageIndex];
        if (!message) {
          continue;
        }
        for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
          const rawPart = message.parts[partIndex];
          if (!rawPart || this.asString(rawPart.type)?.toLowerCase() !== "tool") {
            continue;
          }

          const toolName = this.normalizeToolName(this.asString(rawPart.tool));
          if (!this.isTaskTool(toolName)) {
            continue;
          }

          const partId = this.asString(rawPart.id);
          const callId = this.asString(rawPart.callID);
          const correlationId = this.resolveToolCorrelationId(partId ?? callId) ?? partId ?? callId;
          if (
            correlationId !== taskCorrelationId
            && correlationId !== toolId
            && partId !== toolId
            && callId !== toolId
          ) {
            continue;
          }

          const toolState = this.asRecord(rawPart.state);
          const toolMetadata = this.asRecord(toolState?.metadata);
          const childSessionId = this.asString(toolMetadata?.sessionId)
            ?? this.asString(toolMetadata?.sessionID);
          if (childSessionId) {
            return childSessionId;
          }
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private ensureTaskChildSessionSync(
    runId: number,
    taskCorrelationId: string,
    childSessionId: string,
    _parentAgentId: string,
  ): void {
    const existing = this.taskChildSessionSyncStates.get(childSessionId);
    if (existing) {
      existing.runId = runId;
      existing.taskCorrelationId = taskCorrelationId;
      if (existing.pollHandle === null) {
        this.scheduleTaskChildSessionSyncPoll(childSessionId, 0);
      }
      return;
    }

    this.taskChildSessionSyncStates.set(childSessionId, {
      childSessionId,
      taskCorrelationId,
      runId,
      taskCompleted: false,
      stablePollsAfterCompletion: 0,
      lastSnapshotSignature: "",
      pollHandle: null,
    });
    this.scheduleTaskChildSessionSyncPoll(childSessionId, 0);
  }

  private markTaskChildSessionSyncComplete(childSessionId: string): void {
    const state = this.taskChildSessionSyncStates.get(childSessionId);
    if (!state) {
      return;
    }
    state.taskCompleted = true;
    state.stablePollsAfterCompletion = 0;
    this.scheduleTaskChildSessionSyncPoll(childSessionId, 0);
  }

  private scheduleTaskChildSessionSyncPoll(childSessionId: string, delayMs: number): void {
    const state = this.taskChildSessionSyncStates.get(childSessionId);
    if (!state || state.pollHandle !== null) {
      return;
    }

    state.pollHandle = setTimeout(() => {
      const current = this.taskChildSessionSyncStates.get(childSessionId);
      if (!current) {
        return;
      }
      current.pollHandle = null;
      void this.pollTaskChildSession(childSessionId);
    }, delayMs);
  }

  private stopTaskChildSessionSync(childSessionId: string): void {
    const state = this.taskChildSessionSyncStates.get(childSessionId);
    if (!state) {
      return;
    }
    if (state.pollHandle !== null) {
      clearTimeout(state.pollHandle);
    }
    this.taskChildSessionSyncStates.delete(childSessionId);
  }

  private clearTaskChildSessionSyncStates(): void {
    for (const childSessionId of this.taskChildSessionSyncStates.keys()) {
      this.stopTaskChildSessionSync(childSessionId);
    }
  }

  private buildTaskChildSessionSnapshotSignature(
    messages: Awaited<ReturnType<NonNullable<CodingAgentClient["getSessionMessagesWithParts"]>>>,
  ): string {
    const parts: string[] = [];
    for (const message of messages) {
      const messageId = this.asString(message.info.id) ?? "message";
      for (let index = 0; index < message.parts.length; index += 1) {
        const rawPart = message.parts[index];
        if (!rawPart) {
          continue;
        }
        const partType = this.asString(rawPart.type)?.toLowerCase();
        if (partType !== "tool") {
          continue;
        }
        const toolState = this.asRecord(rawPart.state);
        const toolName = this.normalizeToolName(this.asString(rawPart.tool));
        const status = this.asString(toolState?.status)?.toLowerCase() ?? "unknown";
        const partId = this.asString(rawPart.id) ?? `${messageId}:${index}:${toolName}`;
        parts.push(`${partId}:${status}`);
      }
    }
    return parts.join("|");
  }

  private async pollTaskChildSession(childSessionId: string): Promise<void> {
    const state = this.taskChildSessionSyncStates.get(childSessionId);
    if (!state) {
      return;
    }

    const messageFetcher = this.client;
    if (!messageFetcher?.getSessionMessagesWithParts) {
      this.stopTaskChildSessionSync(childSessionId);
      return;
    }

    try {
      const messages = await messageFetcher.getSessionMessagesWithParts(childSessionId);
      const snapshotSignature = this.buildTaskChildSessionSnapshotSignature(messages);
      if (messages.length > 0) {
        this.hydratedChildSessions.add(childSessionId);
      }
      this.publishTaskChildSessionTools(state.runId, state, messages);

      if (state.taskCompleted) {
        if (snapshotSignature === state.lastSnapshotSignature) {
          state.stablePollsAfterCompletion += 1;
        } else {
          state.stablePollsAfterCompletion = 0;
        }
      }
      state.lastSnapshotSignature = snapshotSignature;

      if (state.taskCompleted && state.stablePollsAfterCompletion >= TASK_CHILD_SESSION_FINAL_STABLE_POLLS) {
        this.stopTaskChildSessionSync(childSessionId);
        return;
      }
    } catch {
      if (state.taskCompleted) {
        state.stablePollsAfterCompletion += 1;
        if (state.stablePollsAfterCompletion >= TASK_CHILD_SESSION_FINAL_STABLE_POLLS) {
          this.stopTaskChildSessionSync(childSessionId);
          return;
        }
      }
    }

    this.scheduleTaskChildSessionSyncPoll(
      childSessionId,
      state.taskCompleted ? TASK_CHILD_SESSION_FINAL_POLL_MS : TASK_CHILD_SESSION_SYNC_POLL_MS,
    );
  }

  private buildHydratedChildToolId(
    childSessionId: string,
    messageId: string | undefined,
    toolName: string,
    partId: string | undefined,
    callId: string | undefined,
    partIndex: number,
  ): string {
    const explicitId = this.resolveToolCorrelationId(partId ?? callId) ?? partId ?? callId;
    if (explicitId) {
      return explicitId;
    }
    return `${childSessionId}:${messageId ?? "message"}:${toolName}:${partIndex}`;
  }

  private publishTaskChildSessionTools(
    runId: number,
    state: TaskChildSessionSyncState,
    messages: Awaited<ReturnType<NonNullable<CodingAgentClient["getSessionMessagesWithParts"]>>>,
  ): void {
    const parentAgentId = this.toolUseIdToSubagentId.get(state.taskCorrelationId)
      ?? state.taskCorrelationId;

    for (const message of messages) {
      const messageId = this.asString(message.info.id);
      for (let partIndex = 0; partIndex < message.parts.length; partIndex += 1) {
        const rawPart = message.parts[partIndex];
        if (!rawPart) {
          continue;
        }
        const partType = this.asString(rawPart.type)?.toLowerCase();
        if (partType !== "tool") {
          continue;
        }

        const toolName = this.normalizeToolName(this.asString(rawPart.tool));
        const partId = this.asString(rawPart.id);
        const callId = this.asString(rawPart.callID);
        const toolState = this.asRecord(rawPart.state);
        const toolMetadata = this.asRecord(toolState?.metadata);
        const toolInput = this.asRecord(toolState?.input) ?? {};
        const toolId = this.buildHydratedChildToolId(
          state.childSessionId,
          messageId,
          toolName,
          partId,
          callId,
          partIndex,
        );
        const sdkCorrelationId = this.resolveToolCorrelationId(partId ?? callId) ?? partId ?? callId ?? toolId;
        const status = this.asString(toolState?.status)?.toLowerCase();
        const startSignature = this.buildToolStartSignature(
          toolName,
          toolInput,
          toolMetadata,
          parentAgentId,
        );

        this.registerToolCorrelationAliases(toolId, partId, callId);

        if (this.toolStartSignatureByToolId.get(toolId) !== startSignature && !this.completedToolIds.has(toolId)) {
          this.toolStartSignatureByToolId.set(toolId, startSignature);
          this.recordActiveSubagentToolContext(
            toolId,
            toolName,
            parentAgentId,
            partId,
            callId,
            state.taskCorrelationId,
          );
          this.bus.publish({
            type: "stream.tool.start",
            sessionId: this.sessionId,
            runId,
            timestamp: Date.now(),
            data: {
              toolId,
              toolName,
              toolInput,
              sdkCorrelationId,
              ...(toolMetadata ? { toolMetadata } : {}),
              parentAgentId,
            },
          });
        }

        if (status !== "completed" && status !== "error") {
          continue;
        }

        if (this.completedToolIds.has(toolId)) {
          continue;
        }

        this.toolStartSignatureByToolId.delete(toolId);
        this.completedToolIds.add(toolId);
        this.removeActiveSubagentToolContext(toolId, partId, callId);
        this.bus.publish({
          type: "stream.tool.complete",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            toolId,
            toolName,
            toolInput,
            toolResult: status === "completed"
              ? toolState?.output
              : (toolState?.error ?? "Tool execution failed"),
            success: status === "completed",
            ...(status === "error"
              ? { error: this.asString(toolState?.error) ?? "Tool execution failed" }
              : {}),
            sdkCorrelationId,
            ...(toolMetadata ? { toolMetadata } : {}),
            parentAgentId,
          },
        });
      }
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
        const activeContext = this.activeSubagentToolsById.get(toolId);
        if (activeContext && this.subagentTracker?.hasAgent(activeContext.parentAgentId)) {
          const trackerKey = this.buildTrackedToolStartKey(activeContext.parentAgentId, toolId);
          this.trackedToolStartKeys.delete(trackerKey);
          this.subagentTracker.onToolComplete(activeContext.parentAgentId);
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
    this.pendingToolIdsByName.clear();
    this.toolStartSignatureByToolId.clear();
    this.completedToolIds.clear();
    this.trackedToolStartKeys.clear();
    this.earlyToolEvents.clear();
    this.activeSubagentToolsById.clear();
  }

  private cleanupSubscriptions(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.clearTaskChildSessionSyncStates();
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
    this.clearTaskChildSessionSyncStates();
    this.syntheticToolCounter = 0;
    this.ownedSessionIds.clear();
    this.subagentSessionToAgentId.clear();
    this.subagentTracker?.reset();
    this.subagentTracker = null;
    this.runtimeFeatureFlags = { ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS };
    resetTurnMetadataState(this.turnMetadataState);
    this.lastSeenOutputTokens = 0;
    this.accumulatedOutputTokens = 0;
  }

  private resolveRuntimeFeatureFlags(
    overrides: WorkflowRuntimeFeatureFlagOverrides | undefined,
  ): WorkflowRuntimeFeatureFlags {
    return resolveWorkflowRuntimeFeatureFlags(overrides);
  }

  private buildThinkingBlockKey(
    sourceKey: string,
    eventSessionId: string,
    agentId: string | undefined,
  ): string {
    return `${eventSessionId}::${agentId ?? "__root__"}::${sourceKey}`;
  }

  private getThinkingBlockKey(
    sourceKey: string,
    eventSessionId: string,
    agentId: string | undefined,
  ): string | undefined {
    const key = this.buildThinkingBlockKey(sourceKey, eventSessionId, agentId);
    return this.thinkingBlocks.has(key) ? key : undefined;
  }

  private ensureThinkingBlock(
    sourceKey: string,
    eventSessionId: string,
    agentId: string | undefined,
  ): void {
    const key = this.buildThinkingBlockKey(sourceKey, eventSessionId, agentId);
    if (!this.thinkingBlocks.has(key)) {
      this.thinkingBlocks.set(key, {
        startTime: Date.now(),
        sourceKey,
        eventSessionId,
        ...(agentId ? { agentId } : {}),
      });
    }
  }

  private publishThinkingCompleteForScope(
    runId: number,
    eventSessionId: string,
    agentId: string | undefined,
  ): void {
    for (const [thinkingKey, block] of this.thinkingBlocks.entries()) {
      if (block.eventSessionId !== eventSessionId) {
        continue;
      }
      if ((block.agentId ?? undefined) !== agentId) {
        continue;
      }
      this.bus.publish({
        type: "stream.thinking.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          sourceKey: block.sourceKey,
          durationMs: Date.now() - block.startTime,
          ...(block.agentId ? { agentId: block.agentId } : {}),
        },
      });
      this.thinkingBlocks.delete(thinkingKey);
    }
  }

  private isOwnedSession(eventSessionId: string): boolean {
    return eventSessionId === this.sessionId || this.ownedSessionIds.has(eventSessionId);
  }

  private resolveParentToolCorrelationId(
    data: Record<string, unknown>,
  ): string | undefined {
    return this.resolveToolCorrelationId(this.asString(
      data.parentToolUseId
        ?? data.parent_tool_use_id
        ?? data.parentToolUseID
        ?? data.parentToolCallId,
    ));
  }

  private resolveParentAgentId(
    eventSessionId: string,
    data: Record<string, unknown>,
  ): string | undefined {
    const explicitParentAgentId = this.asString(data.parentAgentId ?? data.parentId);
    if (explicitParentAgentId) {
      return explicitParentAgentId;
    }
    if (eventSessionId !== this.sessionId) {
      const mappedAgentId = this.subagentSessionToAgentId.get(eventSessionId);
      if (mappedAgentId) {
        return mappedAgentId;
      }
    }
    const parentToolUseId = this.resolveParentToolCorrelationId(data);
    if (parentToolUseId) {
      const mappedAgentId = this.toolUseIdToSubagentId.get(parentToolUseId);
      if (mappedAgentId) {
        return mappedAgentId;
      }
      return parentToolUseId;
    }
    if (eventSessionId === this.sessionId) {
      return undefined;
    }
    const subagentCorrelationId = this.subagentSessionToCorrelationId.get(eventSessionId);
    if (subagentCorrelationId) {
      const resolvedCorrelationId = this.resolveToolCorrelationId(subagentCorrelationId)
        ?? subagentCorrelationId;
      return this.toolUseIdToSubagentId.get(resolvedCorrelationId) ?? resolvedCorrelationId;
    }
    return undefined;
  }
}
