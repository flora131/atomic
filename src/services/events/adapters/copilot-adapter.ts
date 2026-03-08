/**
 * Copilot SDK Stream Adapter
 *
 * Consumer-side adapter that bridges Copilot SDK EventEmitter-based streaming
 * to the event bus. Unlike OpenCode/Claude (pull-based async iteration),
 * Copilot is push-based (EventEmitter), requiring backpressure management.
 *
 * Key responsibilities:
 * - Listen to Copilot client EventEmitter events via client.on()
 * - Map SDK event types to BusEvent types
 * - Implement backpressure using a bounded buffer
 * - Create properly typed BusEvent instances with runId metadata
 * - Clean up event listeners on dispose()
 *
 * Event mappings:
 * - message.delta → stream.text.delta
 * - message.complete → stream.text.complete
 * - tool.start → stream.tool.start
 * - tool.complete → stream.tool.complete
 * - tool.partial_result → stream.tool.partial_result
 * - thinking (from message.delta with thinking content) → stream.thinking.delta
 * - reasoning.delta → stream.thinking.delta
 * - reasoning.complete → stream.thinking.complete
 * - subagent.start → stream.agent.start
 * - subagent.complete → stream.agent.complete
 * - turn.start → stream.turn.start
 * - turn.end → stream.turn.end
 * - session.idle → stream.session.idle
 * - session.error → stream.session.error
 * - session.info → stream.session.info
 * - session.warning → stream.session.warning
 * - session.title_changed → stream.session.title_changed
 * - session.truncation → stream.session.truncation
 * - session.compaction → stream.session.compaction
 * - usage → stream.usage
 *
 * Usage:
 * ```typescript
 * const adapter = new CopilotStreamAdapter(eventBus, client);
 * await adapter.startStreaming(session, "Hello", { runId: 1, messageId: "msg1" });
 * adapter.dispose(); // Clean up listeners
 * ```
 */

import type {
  Session,
  CodingAgentClient,
  AgentEvent,
  EventType,
  PermissionRequestedEventData,
  HumanInputRequiredEventData,
  SkillInvokedEventData,
  ReasoningDeltaEventData,
  ReasoningCompleteEventData,
  TurnStartEventData,
  TurnEndEventData,
  ToolPartialResultEventData,
  SessionInfoEventData,
  SessionWarningEventData,
  SessionTitleChangedEventData,
  SessionTruncationEventData,
  SessionCompactionEventData,
  SubagentStartEventData,
  SubagentCompleteEventData,
  SubagentUpdateEventData,
} from "@/services/agents/types.ts";
import type { CopilotProviderEventSource } from "@/services/agents/provider-events.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import type { SDKStreamAdapter, StreamAdapterOptions } from "@/services/events/adapters/types.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
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

/**
 * Maximum number of events to buffer before dropping oldest events.
 * This prevents memory exhaustion when events arrive faster than they can be processed.
 */
const MAX_BUFFER_SIZE = 1000;
const SYNTHETIC_FOREGROUND_AGENT_PREFIX = "agent-only-";
const SYNTHETIC_TASK_AGENT_PREFIX = "synthetic-task-agent:";

function resolveAgentOnlyTaskLabel(message: string, agentName: string): string {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : agentName;
}

function buildSyntheticTaskAgentId(toolCallId: string): string {
  return `${SYNTHETIC_TASK_AGENT_PREFIX}${toolCallId}`;
}

/**
 * Copilot SDK Stream Adapter for EventEmitter-based streaming.
 *
 * Implements backpressure management using a bounded buffer to handle
 * push-based event delivery from the Copilot SDK client.
 */
export class CopilotStreamAdapter implements SDKStreamAdapter {
  private bus: EventBus;
  private client: CodingAgentClient;
  private unsubscribers: Array<() => void> = [];
  private eventBuffer: BusEvent[] = [];
  private eventBufferHead = 0;
  private isProcessing = false;
  private sessionId: string = "";
  private runId: number = 0;
  private messageId: string = "";
  private isActive = false;
  private toolNameById = new Map<string, string>();
  private subagentTracker: SubagentToolTracker | null = null;

  /**
   * Track tool call IDs that have already had a `stream.tool.start` emitted
   * (from `assistant.message.toolRequests`), so that a later `tool.execution_start`
   * for the same ID is deduplicated.
   */
  private emittedToolStartIds = new Set<string>();
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

  /** Maps task tool toolCallId -> metadata extracted from tool arguments */
  private taskToolMetadata = new Map<string, {
    description: string;
    isBackground: boolean;
    agentType?: string;
  }>();

  /** Buffers tool events that arrive before their parent subagent.started */
  private earlyToolEvents = new Map<string, Array<
    | {
      phase: "start";
      toolId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      sdkCorrelationId: string;
    }
    | {
      phase: "complete";
      toolId: string;
      toolName: string;
      toolInput?: Record<string, unknown>;
      toolResult: unknown;
      success: boolean;
      error?: string;
      sdkCorrelationId: string;
    }
  >>();
  /** Active sub-agent tool contexts keyed by tool call ID */
  private activeSubagentToolsById = new Map<string, { parentAgentId: string; toolName: string }>();

  /** Known agent names that should be treated as task tools (Copilot SDK) */
  private knownAgentNames = new Set<string>();

  /**
   * Maps task-tool toolCallId → subagentId.
   * Copilot SDK tool events from within a sub-agent carry `parentToolCallId`
   * (the ID of the Task tool call that spawned the agent), NOT the sub-agent's
   * own ID. This map lets us resolve the former to the latter for
   * SubagentToolTracker lookups.
   */
  private toolCallIdToSubagentId = new Map<string, string>();

  /**
   * Tool call IDs that belong to a sub-agent (have parentAgentId).
   * Used to detect nested sub-agents in handleSubagentStart: if a
   * subagent.start's toolCallId is in this set, it was spawned by
   * another sub-agent and should NOT appear as a top-level tree entry.
   */
  private innerToolCallIds = new Set<string>();

  /**
   * Nested sub-agent IDs intentionally suppressed from tree lifecycle events.
   * Ensures we do not later emit stream.agent.update/complete without a start.
   */
  private suppressedNestedAgentIds = new Set<string>();

  /**
   * Track thinking streams for timing and correlation without cross-agent collisions.
   */
  private thinkingStreams = new Map<string, {
    startTime: number;
    sourceKey: string;
    agentId?: string;
  }>();

  /**
   * Track accumulated text content for complete events.
   */
  private accumulatedText = "";

  /**
   * Running total of output tokens across all API calls in the current stream.
   * Each assistant.usage event reports per-API-call values; we sum them so
   * the bus event carries the cumulative total.
   */
  private accumulatedOutputTokens = 0;
  private runtimeFeatureFlags: WorkflowRuntimeFeatureFlags = {
    ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  };
  private turnMetadataState = createTurnMetadataState();

  /**
   * Create a new Copilot stream adapter.
   *
   * @param bus - The event bus to publish events to
   * @param client - The Copilot client to subscribe to events from
   */
  constructor(bus: EventBus, client: CodingAgentClient) {
    this.bus = bus;
    this.client = client;
  }

  private toAgentEvent<T extends EventType>(
    event: { type: T; sessionId: string; timestamp: number; data: unknown },
  ): AgentEvent<T> {
    const nativeParentEventId = (event as unknown as { nativeParentEventId?: unknown }).nativeParentEventId;
    const eventData = (
      typeof event.data === "object" && event.data !== null && !Array.isArray(event.data)
    )
      ? {
          ...(event.data as Record<string, unknown>),
          ...(typeof nativeParentEventId === "string"
            ? {
                nativeParentEventId,
                parentId: (event.data as Record<string, unknown>).parentId
                  ?? nativeParentEventId,
              }
            : {}),
        }
      : event.data as AgentEvent<T>["data"];
    return {
      type: event.type,
      sessionId: event.sessionId,
      timestamp: new Date(event.timestamp).toISOString(),
      data: eventData as AgentEvent<T>["data"],
    } as AgentEvent<T>;
  }

  /**
   * Start streaming from the Copilot SDK session.
   *
   * Registers event listeners on the client's EventEmitter and translates
   * all SDK events to BusEvents, publishing them to the event bus.
   *
   * @param session - Active SDK session to stream from
   * @param message - User message that initiated the stream
   * @param options - Stream options including runId and messageId
   */
  async startStreaming(
    session: Session,
    message: string,
    options: StreamAdapterOptions,
  ): Promise<void> {
    // Clean up any existing subscriptions from a previous startStreaming() call
    // to prevent subscription accumulation on re-entry without dispose()
    this.cleanupSubscriptions();

    this.sessionId = session.id;
    this.runId = options.runId;
    this.messageId = options.messageId;
    this.accumulatedText = "";
    this.accumulatedOutputTokens = 0;
    this.thinkingStreams.clear();
    this.toolNameById.clear();
    this.emittedToolStartIds.clear();
    this.taskToolMetadata.clear();
    this.earlyToolEvents.clear();
    this.activeSubagentToolsById.clear();
    this.toolCallIdToSubagentId.clear();
    this.innerToolCallIds.clear();
    this.suppressedNestedAgentIds.clear();
    this.syntheticForegroundAgent = options.agent
      ? {
          id: `${SYNTHETIC_FOREGROUND_AGENT_PREFIX}${options.messageId}`,
          name: options.agent,
          task: resolveAgentOnlyTaskLabel(message, options.agent),
          started: false,
          completed: false,
          sawNativeSubagentStart: false,
        }
      : null;
    this.knownAgentNames = new Set(
      (options.knownAgentNames ?? []).map(n => n.toLowerCase())
    );
    this.runtimeFeatureFlags = this.resolveRuntimeFeatureFlags(options.runtimeFeatureFlags);
    resetTurnMetadataState(this.turnMetadataState);
    this.subagentTracker = new SubagentToolTracker(this.bus, this.sessionId, this.runId);
    this.isActive = true;

    this.publishEvent({
      type: "stream.session.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {},
    });
    this.publishSyntheticForegroundAgentStart();

    // Subscribe to all relevant event types from the client
    this.subscribeToEvents();

    let abortedBySignal = false;
    const abortListener = () => {
      abortedBySignal = true;
      this.isActive = false;
      this.cleanupSubscriptions();
    };
    options.abortSignal?.addEventListener("abort", abortListener, { once: true });

    try {
      // Initiate streaming by calling session.stream()
      // This triggers the SDK to start emitting events through the client
      const streamIterator = session.stream(message, options);

      // Consume the stream to completion.
      // The chunks are handled by our event subscribers (subscribeToEvents);
      // we just need to iterate so the underlying generator stays alive.
      // The client-level session.idle subscription (handleSessionIdle)
      // already publishes stream.session.idle to the bus, so we do NOT
      // publish a duplicate idle event when the loop exits.
      for await (const _chunk of streamIterator) {
        // no-op: event subscribers handle content
      }
    } catch (error) {
      if (
        abortedBySignal
        || (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }
      // Publish error event if streaming fails
      if (this.isActive) {
        this.publishSyntheticForegroundAgentComplete(
          false,
          error instanceof Error ? error.message : String(error),
        );
        this.publishEvent({
          type: "stream.session.error",
          sessionId: this.sessionId,
          runId: this.runId,
          timestamp: Date.now(),
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    } finally {
      // Force-complete any tools still pending/running — prevents orphaned tool state
      this.cleanupOrphanedTools();
      this.isActive = false;
      options.abortSignal?.removeEventListener("abort", abortListener);
    }
  }

  /**
   * Subscribe to all relevant events from the Copilot client.
   */
  private subscribeToEvents(): void {
    const providerClient = this.client as CodingAgentClient & CopilotProviderEventSource;
    if (typeof providerClient.onProviderEvent !== "function") {
      throw new Error("Copilot stream adapter requires provider event support.");
    }

    const unsubProvider = providerClient.onProviderEvent((event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) {
        return;
      }

      switch (event.type) {
        case "message.delta":
          this.handleMessageDelta(this.toAgentEvent(event));
          break;
        case "message.complete":
          this.handleMessageComplete(this.toAgentEvent(event));
          break;
        case "tool.start":
          this.handleToolStart(this.toAgentEvent(event));
          break;
        case "tool.complete":
          this.handleToolComplete(this.toAgentEvent(event));
          break;
        case "session.idle":
          this.handleSessionIdle(this.toAgentEvent(event));
          break;
        case "session.error":
          this.handleSessionError(this.toAgentEvent(event));
          break;
        case "usage":
          this.handleUsage(this.toAgentEvent(event));
          break;
        case "permission.requested":
          this.handlePermissionRequested(this.toAgentEvent(event) as AgentEvent<"permission.requested">);
          break;
        case "human_input_required":
          this.handleHumanInputRequired(this.toAgentEvent(event) as AgentEvent<"human_input_required">);
          break;
        case "skill.invoked":
          this.handleSkillInvoked(this.toAgentEvent(event) as AgentEvent<"skill.invoked">);
          break;
        case "reasoning.delta":
          this.handleReasoningDelta(this.toAgentEvent(event) as AgentEvent<"reasoning.delta">);
          break;
        case "reasoning.complete":
          this.handleReasoningComplete(this.toAgentEvent(event) as AgentEvent<"reasoning.complete">);
          break;
        case "subagent.start":
          this.handleSubagentStart(this.toAgentEvent(event) as AgentEvent<"subagent.start">);
          break;
        case "subagent.complete":
          this.handleSubagentComplete(this.toAgentEvent(event) as AgentEvent<"subagent.complete">);
          break;
        case "subagent.update":
          this.handleSubagentUpdate(this.toAgentEvent(event) as AgentEvent<"subagent.update">);
          break;
        case "turn.start":
          this.handleTurnStart(this.toAgentEvent(event) as AgentEvent<"turn.start">);
          break;
        case "turn.end":
          this.handleTurnEnd(this.toAgentEvent(event) as AgentEvent<"turn.end">);
          break;
        case "tool.partial_result":
          this.handleToolPartialResult(this.toAgentEvent(event) as AgentEvent<"tool.partial_result">);
          break;
        case "session.info":
          this.handleSessionInfo(this.toAgentEvent(event) as AgentEvent<"session.info">);
          break;
        case "session.warning":
          this.handleSessionWarning(this.toAgentEvent(event) as AgentEvent<"session.warning">);
          break;
        case "session.title_changed":
          this.handleSessionTitleChanged(this.toAgentEvent(event) as AgentEvent<"session.title_changed">);
          break;
        case "session.truncation":
          this.handleSessionTruncation(this.toAgentEvent(event) as AgentEvent<"session.truncation">);
          break;
        case "session.compaction":
          this.handleSessionCompaction(this.toAgentEvent(event) as AgentEvent<"session.compaction">);
          break;
        default:
          break;
      }
    });
    this.unsubscribers.push(unsubProvider);
  }

  /**
   * Check if a tool name corresponds to a task/agent-launching tool.
   */
  private isTaskTool(toolName: string): boolean {
    const normalized = toolName.toLowerCase();
    return normalized === "task"
      || normalized === "launch_agent"
      || this.knownAgentNames.has(normalized);
  }

  /**
   * Handle message.delta event (text or thinking content).
   */
  private handleMessageDelta(event: AgentEvent<"message.delta">): void {
    const { delta, contentType, thinkingSourceKey } = event.data;

    const parentToolCallId = this.asString((event.data as Record<string, unknown>).parentToolCallId);
    const mappedAgentId = this.resolveParentAgentId(parentToolCallId);
    const agentId = mappedAgentId ?? this.getSyntheticForegroundAgentIdForAttribution();

    // Check if this is thinking/reasoning content
    if (contentType === "thinking" && thinkingSourceKey) {
      // Thinking delta
      this.ensureThinkingStream(thinkingSourceKey, agentId);

      this.publishEvent({
        type: "stream.thinking.delta",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          delta,
          sourceKey: thinkingSourceKey,
          messageId: this.messageId,
          ...(agentId ? { agentId } : {}),
        },
      });
    } else {
      // Regular text delta
      if (!agentId) {
        this.accumulatedText += delta;
      }

      if (delta.length > 0) {
        this.publishEvent({
          type: "stream.text.delta",
          sessionId: this.sessionId,
          runId: this.runId,
          timestamp: Date.now(),
          data: {
            delta,
            messageId: this.messageId,
            ...(agentId ? { agentId } : {}),
          },
        });
      }
    }
  }

  /**
   * Handle message.complete event.
   *
   * In the Copilot CLI, tool call UI entries are created from
   * `assistant.message.toolRequests[]` inside this event — NOT from
   * `tool.execution_start`. We mirror that behaviour here by emitting
   * `stream.tool.start` for each tool request, then deduplicating against
   * the later `tool.execution_start` in `handleToolStart`.
   */
  private handleMessageComplete(event: AgentEvent<"message.complete">): void {
    const parentToolCallId = this.asString((event.data as Record<string, unknown>).parentToolCallId);
    const parentAgentId = this.resolveParentAgentId(parentToolCallId);
    const completionAgentId = parentToolCallId
      ? parentAgentId
      : this.getSyntheticForegroundAgentIdForAttribution();

    // Publish thinking complete events for the relevant message scope.
    for (const [thinkingKey, stream] of this.thinkingStreams.entries()) {
      if ((stream.agentId ?? undefined) !== completionAgentId) {
        continue;
      }
      const durationMs = Date.now() - stream.startTime;
      this.publishEvent({
        type: "stream.thinking.complete",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          sourceKey: stream.sourceKey,
          durationMs,
          ...(stream.agentId ? { agentId: stream.agentId } : {}),
        },
      });
      this.thinkingStreams.delete(thinkingKey);
    }

    // Emit stream.tool.start for each toolRequest in the message.complete payload.
    // This mirrors the Copilot CLI's useTimeline.ts behaviour where tool call UI
    // entries are created from assistant.message.toolRequests.
    const toolRequests = (event.data as Record<string, unknown>).toolRequests;
    const hasToolRequests = Array.isArray(toolRequests) && toolRequests.length > 0;
    const syntheticParentAgentId = parentToolCallId
      ? undefined
      : this.getSyntheticForegroundAgentIdForAttribution();

    if (hasToolRequests) {
      for (const request of toolRequests as Array<Record<string, unknown>>) {
        const toolCallId = this.asString(request.toolCallId);
        const toolName = this.normalizeToolName(request.name);
        const toolInput = this.normalizeToolInput(request.arguments);
        if (!toolCallId) continue;
        const isRootTaskTool = !parentToolCallId && this.isTaskTool(toolName);
        if (isRootTaskTool) {
          this.storeTaskToolMetadata(toolCallId, toolInput);
        }
        const syntheticTaskAgentId = isRootTaskTool
          ? this.ensureSyntheticTaskAgent(toolCallId)
          : undefined;
        const bufferedParentAgentId = parentAgentId ?? syntheticParentAgentId ?? syntheticTaskAgentId;

        this.emittedToolStartIds.add(toolCallId);
        const toolId = this.resolveToolStartId(toolCallId, toolName);
        if (bufferedParentAgentId) {
          this.recordActiveSubagentToolContext(toolId, toolName, bufferedParentAgentId, toolCallId);
          if (this.subagentTracker?.hasAgent(bufferedParentAgentId)) {
            this.subagentTracker.onToolStart(bufferedParentAgentId, toolName);
          }
        } else if (parentToolCallId) {
          this.queueEarlyToolEvent(parentToolCallId, {
            phase: "start",
            toolId,
            toolName,
            toolInput,
            sdkCorrelationId: toolCallId,
          });
          continue;
        }

        this.publishEvent({
          type: "stream.tool.start",
          sessionId: this.sessionId,
          runId: this.runId,
          timestamp: Date.now(),
          data: {
            toolId,
            toolName,
            toolInput,
            sdkCorrelationId: toolCallId,
            ...(bufferedParentAgentId ? { parentAgentId: bufferedParentAgentId } : {}),
          },
        });
      }
    }

    // Only emit stream.text.complete when there are NO pending tool requests.
    //
    // In the Copilot turn-based model, assistant.message events with toolRequests
    // are intermediate — the turn continues with tool execution followed by another
    // assistant message. Emitting stream.text.complete here would trigger
    // handleStreamComplete in the UI (via direct bus subscription), which nulls
    // streamingMessageIdRef BEFORE the batched tool-start events arrive (16ms
    // batch-dispatcher delay), causing tool parts to be silently dropped.
    //
    // When tool requests are present, finalization is deferred to session.idle
    // or a subsequent message.complete without tool requests.
    if (!parentToolCallId && !hasToolRequests && this.accumulatedText.length > 0) {
      this.publishEvent({
        type: "stream.text.complete",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          messageId: this.messageId,
          fullText: this.accumulatedText,
        },
      });
    }
  }

  /**
   * Handle tool.start event.
   *
   * Deduplicates against tool starts already emitted from
   * `handleMessageComplete` (via `assistant.message.toolRequests`).
   */
  private handleToolStart(event: AgentEvent<"tool.start">): void {
    const { toolName, toolInput, toolCallId } = event.data;
    const resolvedToolCallId = this.asString(toolCallId);
    if (!resolvedToolCallId) return;

    // Skip if already emitted from assistant.message.toolRequests
    if (this.emittedToolStartIds.has(resolvedToolCallId)) {
      return;
    }

    const resolvedToolName = this.normalizeToolName(toolName);
    const toolId = this.resolveToolStartId(resolvedToolCallId, resolvedToolName);

    // Resolve the parent agent ID from parentToolCallId
    // (Copilot SDK: the task tool call ID that spawned the agent).
    const rawParentToolCallId = this.asString((event.data as Record<string, unknown>).parentToolCallId);
    const parentAgentId = this.resolveParentAgentId(rawParentToolCallId);
    const syntheticParentAgentId = this.getSyntheticForegroundAgentIdForAttribution();
    const isRootTaskTool = !rawParentToolCallId && this.isTaskTool(resolvedToolName);
    if (isRootTaskTool) {
      this.storeTaskToolMetadata(resolvedToolCallId, this.normalizeToolInput(toolInput));
    }
    const syntheticTaskAgentId = isRootTaskTool
      ? this.ensureSyntheticTaskAgent(resolvedToolCallId)
      : undefined;
    const effectiveParentAgentId = parentAgentId ?? syntheticParentAgentId ?? syntheticTaskAgentId;

    if (!parentAgentId && rawParentToolCallId) {
      this.queueEarlyToolEvent(rawParentToolCallId, {
        phase: "start",
        toolId,
        toolName: resolvedToolName,
        toolInput: this.normalizeToolInput(toolInput),
        sdkCorrelationId: resolvedToolCallId,
      });
      return;
    }

    this.publishEvent({
      type: "stream.tool.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName: resolvedToolName,
        toolInput: this.normalizeToolInput(toolInput),
        sdkCorrelationId: resolvedToolCallId,
        parentAgentId: effectiveParentAgentId,
      },
    });

    // Track tool start for sub-agent if this tool belongs to one.
    // Also record the tool call ID as an "inner" tool call so that
    // nested subagent.start events (whose toolCallId matches) can be
    // detected and suppressed from the top-level agent tree.
    if (effectiveParentAgentId) {
      this.recordActiveSubagentToolContext(toolId, resolvedToolName, effectiveParentAgentId, resolvedToolCallId);
      this.innerToolCallIds.add(resolvedToolCallId);
      if (this.subagentTracker?.hasAgent(effectiveParentAgentId)) {
        this.subagentTracker.onToolStart(effectiveParentAgentId, resolvedToolName);
      } else {
        this.queueEarlyToolEvent(effectiveParentAgentId, {
          phase: "start",
          toolId,
          toolName: resolvedToolName,
          toolInput: this.normalizeToolInput(toolInput),
          sdkCorrelationId: resolvedToolCallId,
        });
      }
    }
  }

  /**
   * Handle tool.complete event.
   */
  private handleToolComplete(event: AgentEvent<"tool.complete">): void {
    const { toolName, toolResult, success, error, toolCallId } = event.data;
    const resolvedToolCallId = this.asString(toolCallId);
    if (!resolvedToolCallId) return;

    const resolvedToolName = this.normalizeToolName(toolName ?? this.toolNameById.get(resolvedToolCallId));
    const toolId = this.resolveToolCompleteId(resolvedToolCallId, resolvedToolName);
    const toolInput = this.normalizeToolInput((event.data as Record<string, unknown>).toolInput);
    const activeToolContext = this.activeSubagentToolsById.get(resolvedToolCallId);
    this.removeActiveSubagentToolContext(toolId, resolvedToolCallId);

    // Clean up deduplication tracking
    this.emittedToolStartIds.delete(resolvedToolCallId);
    const normalizedSuccess = typeof success === "boolean" ? success : true;

    // Track tool completion for sub-agent if this tool belongs to one
    const rawParentToolCallId = this.asString((event.data as Record<string, unknown>).parentToolCallId);
    const resolvedParentId = this.resolveParentAgentId(rawParentToolCallId);
    if (!resolvedParentId && rawParentToolCallId) {
      this.queueEarlyToolEvent(rawParentToolCallId, {
        phase: "complete",
        toolId,
        toolName: resolvedToolName,
        ...(toolInput ? { toolInput } : {}),
        toolResult,
        success: normalizedSuccess,
        ...(typeof error === "string" ? { error } : {}),
        sdkCorrelationId: resolvedToolCallId,
      });
      return;
    }
    const effectiveParentAgentId = resolvedParentId
      ?? activeToolContext?.parentAgentId
      ?? (this.isTaskTool(resolvedToolName) ? buildSyntheticTaskAgentId(resolvedToolCallId) : undefined)
      ?? this.getSyntheticForegroundAgentIdForAttribution();
    if (effectiveParentAgentId && this.subagentTracker?.hasAgent(effectiveParentAgentId)) {
      this.subagentTracker.onToolComplete(effectiveParentAgentId);
    }

    this.publishEvent({
      type: "stream.tool.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName: resolvedToolName,
        toolInput,
        toolResult,
        success: normalizedSuccess,
        error,
        sdkCorrelationId: resolvedToolCallId,
        parentAgentId: effectiveParentAgentId,
      },
    });
  }

  /**
   * Handle session.idle event.
   */
  private handleSessionIdle(event: AgentEvent<"session.idle">): void {
    const { reason } = event.data;
    this.publishSyntheticForegroundAgentComplete(reason === "idle");

    this.publishEvent({
      type: "stream.session.idle",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        reason,
      },
    });
  }

  /**
   * Handle session.error event.
   */
  private handleSessionError(event: AgentEvent<"session.error">): void {
    const { error, code } = event.data;
    this.publishSyntheticForegroundAgentComplete(false, error instanceof Error ? error.message : String(error));

    this.publishEvent({
      type: "stream.session.error",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        error: error instanceof Error ? error.message : String(error),
        code,
      },
    });
  }

  /**
   * Handle usage event.
   *
   * Copilot SDK emits `assistant.usage` per API call with per-call token
   * counts. We accumulate output tokens across calls so the bus event
   * carries a running total (suitable for direct display in the UI).
   */
  private handleUsage(event: AgentEvent<"usage">): void {
    const data = event.data as Record<string, unknown>;

    const inputTokens = (data.inputTokens as number) || 0;
    const outputTokens = (data.outputTokens as number) || 0;
    const model = data.model as string | undefined;

    // Skip zero-valued events (e.g. from unmapped metadata events)
    if (outputTokens <= 0 && inputTokens <= 0) return;

    // Accumulate output tokens across multi-turn API calls
    this.accumulatedOutputTokens += outputTokens;

    this.publishEvent({
      type: "stream.usage",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        inputTokens,
        outputTokens: this.accumulatedOutputTokens,
        model,
      },
    });
  }

  /**
   * Handle permission.requested event.
   */
  private handlePermissionRequested(event: AgentEvent<"permission.requested">): void {
    const data = event.data as PermissionRequestedEventData;
    this.publishEvent({
      type: "stream.permission.requested",
      sessionId: this.sessionId,
      runId: this.runId,
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
    });
  }

  /**
   * Handle human_input_required event.
   */
  private handleHumanInputRequired(event: AgentEvent<"human_input_required">): void {
    const data = event.data as HumanInputRequiredEventData;
    this.publishEvent({
      type: "stream.human_input_required",
      sessionId: this.sessionId,
      runId: this.runId,
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
  }

  /**
   * Handle skill.invoked event.
   */
  private handleSkillInvoked(event: AgentEvent<"skill.invoked">): void {
    const data = event.data as SkillInvokedEventData;
    const dataRecord = data as Record<string, unknown>;
    const parentToolCallId = this.asString(
      data.parentToolCallId
        ?? dataRecord.parentToolUseId
        ?? dataRecord.parent_tool_use_id
    );
    const parentAgentId = this.asString(dataRecord.parentAgentId)
      ?? this.resolveParentAgentId(parentToolCallId);
    this.publishEvent({
      type: "stream.skill.invoked",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        skillName: data.skillName,
        skillPath: data.skillPath,
        ...(parentAgentId ? { agentId: parentAgentId } : {}),
      },
    });
  }

  /**
   * Handle reasoning.delta event (thinking content from Copilot SDK).
   */
  private handleReasoningDelta(event: AgentEvent<"reasoning.delta">): void {
    const data = event.data as ReasoningDeltaEventData;
    const reasoningId = data.reasoningId ?? "reasoning";
    const dataRecord = data as Record<string, unknown>;
    const parentToolCallId = this.asString(dataRecord.parentToolCallId);
    const agentId = this.resolveParentAgentId(parentToolCallId)
      ?? this.getSyntheticForegroundAgentIdForAttribution();

    this.ensureThinkingStream(reasoningId, agentId);

    this.publishEvent({
      type: "stream.thinking.delta",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        delta: data.delta,
        sourceKey: reasoningId,
        messageId: this.messageId,
        ...(agentId ? { agentId } : {}),
      },
    });
  }

  /**
   * Handle reasoning.complete event.
   */
  private handleReasoningComplete(event: AgentEvent<"reasoning.complete">): void {
    const data = event.data as ReasoningCompleteEventData;
    const reasoningId = data.reasoningId ?? "reasoning";
    const dataRecord = data as Record<string, unknown>;
    const parentToolCallId = this.asString(dataRecord.parentToolCallId);
    const agentId = this.resolveParentAgentId(parentToolCallId)
      ?? this.getSyntheticForegroundAgentIdForAttribution();
    const thinkingKey = this.getThinkingStreamKey(reasoningId, agentId);
    const startTime = thinkingKey
      ? this.thinkingStreams.get(thinkingKey)?.startTime ?? Date.now()
      : Date.now();
    const durationMs = Date.now() - startTime;
    if (thinkingKey) {
      this.thinkingStreams.delete(thinkingKey);
    }

    this.publishEvent({
      type: "stream.thinking.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        sourceKey: reasoningId,
        durationMs,
        ...(agentId ? { agentId } : {}),
      },
    });
  }

  /**
   * Handle subagent.start event.
   */
  private handleSubagentStart(event: AgentEvent<"subagent.start">): void {
    const data = event.data as SubagentStartEventData;
    const toolCallId = data.toolCallId ?? data.subagentId;

    // Skip nested sub-agents (spawned by another sub-agent).
    // If toolCallId was recorded as an inner tool call (from handleToolStart
    // with parentAgentId), this is a nested agent and should not appear as
    // a top-level entry in the agent tree.
    if (this.innerToolCallIds.has(toolCallId)) {
      this.suppressedNestedAgentIds.add(data.subagentId);
      this.suppressedNestedAgentIds.add(toolCallId);
      this.earlyToolEvents.delete(data.subagentId);
      this.earlyToolEvents.delete(toolCallId);
      return;
    }

    // Look up task metadata from the parent task tool call
    const metadata = this.taskToolMetadata.get(toolCallId);
    const normalizedMetadata = normalizeAgentTaskMetadata(
      {
        task: metadata?.description ?? data.task,
        agentType: data.subagentType,
        isBackground: metadata?.isBackground,
      },
    );

    const syntheticTaskAgentId = buildSyntheticTaskAgentId(toolCallId);
    // Register agent with tracker for tool counting
    this.subagentTracker?.registerAgent(data.subagentId);
    this.promoteSyntheticForegroundAgentIdentity(data.subagentId);

    // Map task-tool toolCallId → subagentId so inner tool events
    // (which carry parentToolCallId, not parentId) can be resolved.
    this.toolCallIdToSubagentId.set(toolCallId, data.subagentId);

    this.publishEvent({
      type: "stream.agent.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId: data.subagentId,
        toolCallId,
        agentType: data.subagentType ?? "unknown",
        task: normalizedMetadata.task,
        isBackground: normalizedMetadata.isBackground,
        sdkCorrelationId: toolCallId,
      },
    });

    this.promoteSyntheticTaskAgentIdentity(toolCallId, data.subagentId);

    // Replay any early tool events that arrived before this subagent.started.
    // Events may be keyed by subagentId (parentId path), toolCallId
    // (parentToolCallId path, before the mapping existed), or the synthetic
    // task-agent placeholder used before the native lifecycle event arrived.
    for (const key of [data.subagentId, toolCallId, syntheticTaskAgentId]) {
      const earlyTools = this.earlyToolEvents.get(key);
      if (earlyTools) {
        for (const tool of earlyTools) {
          this.replayEarlyToolEvent(data.subagentId, tool);
        }
        this.earlyToolEvents.delete(key);
      }
    }
  }

  /**
   * Handle subagent.complete event.
   */
  private handleSubagentComplete(event: AgentEvent<"subagent.complete">): void {
    const data = event.data as SubagentCompleteEventData;
    const error = typeof (data as Record<string, unknown>).error === "string"
      ? (data as Record<string, unknown>).error as string
      : undefined;

    if (this.suppressedNestedAgentIds.has(data.subagentId)) {
      this.suppressedNestedAgentIds.delete(data.subagentId);
      this.earlyToolEvents.delete(data.subagentId);
      return;
    }

    const taskToolCallId = this.resolveTaskToolCallIdForSubagent(data.subagentId);
    if (taskToolCallId) {
      this.publishSyntheticTaskToolComplete(taskToolCallId, {
        success: data.success,
        result: data.result,
        error,
      });
    }

    this.suppressedNestedAgentIds.delete(data.subagentId);
    this.subagentTracker?.removeAgent(data.subagentId);
    this.taskToolMetadata.delete(taskToolCallId ?? data.subagentId);
    this.earlyToolEvents.delete(data.subagentId);
    if (taskToolCallId && taskToolCallId !== data.subagentId) {
      this.earlyToolEvents.delete(taskToolCallId);
      this.toolCallIdToSubagentId.delete(taskToolCallId);
    } else {
      // Clean up any remaining toolCallId → subagentId mapping.
      for (const [tcId, agentId] of this.toolCallIdToSubagentId) {
        if (agentId === data.subagentId) {
          this.toolCallIdToSubagentId.delete(tcId);
          break;
        }
      }
    }
    this.publishEvent({
      type: "stream.agent.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId: data.subagentId,
        success: data.success,
        result: typeof data.result === "string" ? data.result : undefined,
        error,
      },
    });
  }

  /**
   * Handle subagent.update event.
   */
  private handleSubagentUpdate(event: AgentEvent<"subagent.update">): void {
    const data = event.data as SubagentUpdateEventData;
    if (this.suppressedNestedAgentIds.has(data.subagentId)) {
      return;
    }
    this.publishEvent({
      type: "stream.agent.update",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId: data.subagentId,
        currentTool: data.currentTool,
        toolUses: data.toolUses,
      },
    });
  }

  private queueEarlyToolEvent(
    key: string,
    event: {
      phase: "start";
      toolId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      sdkCorrelationId: string;
    } | {
      phase: "complete";
      toolId: string;
      toolName: string;
      toolInput?: Record<string, unknown>;
      toolResult: unknown;
      success: boolean;
      error?: string;
      sdkCorrelationId: string;
    },
  ): void {
    const queue = this.earlyToolEvents.get(key) ?? [];
    if (queue.some((entry) => entry.phase === event.phase && entry.toolId === event.toolId)) {
      return;
    }
    queue.push(event);
    this.earlyToolEvents.set(key, queue);
  }

  private replayEarlyToolEvent(
    parentAgentId: string,
    event: {
      phase: "start";
      toolId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      sdkCorrelationId: string;
    } | {
      phase: "complete";
      toolId: string;
      toolName: string;
      toolInput?: Record<string, unknown>;
      toolResult: unknown;
      success: boolean;
      error?: string;
      sdkCorrelationId: string;
    },
  ): void {
    if (event.phase === "start") {
      this.recordActiveSubagentToolContext(
        event.toolId,
        event.toolName,
        parentAgentId,
        event.sdkCorrelationId,
      );
      this.innerToolCallIds.add(event.toolId);
      this.subagentTracker?.onToolStart(parentAgentId, event.toolName);
      this.publishEvent({
        type: "stream.tool.start",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          toolId: event.toolId,
          toolName: event.toolName,
          toolInput: event.toolInput,
          sdkCorrelationId: event.sdkCorrelationId,
          parentAgentId,
        },
      });
      return;
    }

    this.removeActiveSubagentToolContext(event.toolId, event.sdkCorrelationId);
    this.subagentTracker?.onToolComplete(parentAgentId);
    this.publishEvent({
      type: "stream.tool.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId: event.toolId,
        toolName: event.toolName,
        ...(event.toolInput ? { toolInput: event.toolInput } : {}),
        toolResult: event.toolResult,
        success: event.success,
        ...(event.error ? { error: event.error } : {}),
        sdkCorrelationId: event.sdkCorrelationId,
        parentAgentId,
      },
    });
  }

  /**
   * Handle turn.start event.
   */
  private handleTurnStart(event: AgentEvent<"turn.start">): void {
    const data = event.data as TurnStartEventData;
    this.publishEvent({
      type: "stream.turn.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        turnId: normalizeTurnStartId(
          data.turnId,
          this.turnMetadataState,
        ),
      },
    });
  }

  /**
   * Handle turn.end event.
   */
  private handleTurnEnd(event: AgentEvent<"turn.end">): void {
    const data = event.data as TurnEndEventData;
    this.publishEvent({
      type: "stream.turn.end",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: normalizeTurnEndMetadata(
        data,
        this.turnMetadataState,
      ),
    });
  }

  /**
   * Handle tool.partial_result event (streaming tool output).
   */
  private handleToolPartialResult(event: AgentEvent<"tool.partial_result">): void {
    const data = event.data as ToolPartialResultEventData;
    const toolCallId = this.asString(data.toolCallId);
    const context = toolCallId
      ? this.activeSubagentToolsById.get(toolCallId)
      : undefined;
    this.publishEvent({
      type: "stream.tool.partial_result",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolCallId: data.toolCallId,
        partialOutput: data.partialOutput,
        ...(context ? { parentAgentId: context.parentAgentId } : {}),
      },
    });

    if (!toolCallId) {
      return;
    }
    if (context && this.subagentTracker?.hasAgent(context.parentAgentId)) {
      this.subagentTracker.onToolProgress(context.parentAgentId, context.toolName);
    }
  }

  /**
   * Handle session.info event.
   */
  private handleSessionInfo(event: AgentEvent<"session.info">): void {
    const data = event.data as SessionInfoEventData;
    this.publishEvent({
      type: "stream.session.info",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        infoType: data.infoType ?? "general",
        message: data.message ?? "",
      },
    });
  }

  /**
   * Handle session.warning event.
   */
  private handleSessionWarning(event: AgentEvent<"session.warning">): void {
    const data = event.data as SessionWarningEventData;
    this.publishEvent({
      type: "stream.session.warning",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        warningType: data.warningType ?? "general",
        message: data.message ?? "",
      },
    });
  }

  /**
   * Handle session.title_changed event.
   */
  private handleSessionTitleChanged(event: AgentEvent<"session.title_changed">): void {
    const data = event.data as SessionTitleChangedEventData;
    this.publishEvent({
      type: "stream.session.title_changed",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        title: data.title ?? "",
      },
    });
  }

  /**
   * Handle session.truncation event.
   */
  private handleSessionTruncation(event: AgentEvent<"session.truncation">): void {
    const data = event.data as SessionTruncationEventData;
    this.publishEvent({
      type: "stream.session.truncation",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        tokenLimit: data.tokenLimit ?? 0,
        tokensRemoved: data.tokensRemoved ?? 0,
        messagesRemoved: data.messagesRemoved ?? 0,
      },
    });
  }

  /**
   * Handle session.compaction event.
   */
  private handleSessionCompaction(event: AgentEvent<"session.compaction">): void {
    const data = event.data as SessionCompactionEventData;
    this.publishEvent({
      type: "stream.session.compaction",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        phase: data.phase,
        success: data.success,
        error: data.error,
      },
    });
  }

  private asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
      ? value
      : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return undefined;
  }

  private normalizeToolName(value: unknown): string {
    return this.asString(value) ?? "unknown";
  }

  private normalizeToolInput(value: unknown): Record<string, unknown> {
    const record = this.asRecord(value);
    if (record) {
      return record;
    }

    if (value === undefined || value === null) {
      return {};
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {};
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const parsedRecord = this.asRecord(parsed);
        if (parsedRecord) {
          return parsedRecord;
        }
      } catch {
        // Keep the raw string payload when it's not valid JSON.
      }
      return { value };
    }

    return { value };
  }

  private resolveToolStartId(toolCallId: string, toolName: string): string {
    this.toolNameById.set(toolCallId, toolName);
    return toolCallId;
  }

  private resolveToolCompleteId(toolCallId: string, toolName: unknown): string {
    this.toolNameById.delete(toolCallId);
    return toolCallId;
  }

  private extractTaskToolMetadata(
    toolInput: unknown,
  ): { description: string; isBackground: boolean; agentType?: string } {
    const record = this.asRecord(toolInput) ?? {};
    return {
      description: this.asString(record.description)
        ?? this.asString(record.prompt)
        ?? this.asString(record.task)
        ?? "",
      isBackground: record.run_in_background === true
        || this.asString(record.mode)?.toLowerCase() === "background",
      agentType: this.asString(record.subagent_type)
        ?? this.asString(record.subagentType)
        ?? this.asString(record.agent_type)
        ?? this.asString(record.agentType)
        ?? this.asString(record.agent),
    };
  }

  private mergeTaskToolMetadata(
    existing: { description: string; isBackground: boolean; agentType?: string } | undefined,
    incoming: { description: string; isBackground: boolean; agentType?: string },
  ): { description: string; isBackground: boolean; agentType?: string } {
    if (!existing) {
      return incoming;
    }
    return {
      description: incoming.description || existing.description,
      isBackground: incoming.isBackground || existing.isBackground,
      agentType: incoming.agentType ?? existing.agentType,
    };
  }

  private storeTaskToolMetadata(toolCallId: string, toolInput: unknown): void {
    this.taskToolMetadata.set(
      toolCallId,
      this.mergeTaskToolMetadata(
        this.taskToolMetadata.get(toolCallId),
        this.extractTaskToolMetadata(toolInput),
      ),
    );
  }

  private ensureSyntheticTaskAgent(toolCallId: string): string {
    const existingAgentId = this.toolCallIdToSubagentId.get(toolCallId);
    const syntheticAgentId = buildSyntheticTaskAgentId(toolCallId);
    if (existingAgentId && existingAgentId !== syntheticAgentId) {
      return existingAgentId;
    }

    this.toolCallIdToSubagentId.set(toolCallId, syntheticAgentId);

    if (this.subagentTracker?.hasAgent(syntheticAgentId)) {
      return syntheticAgentId;
    }

    const metadata = this.taskToolMetadata.get(toolCallId);
    const normalizedMetadata = normalizeAgentTaskMetadata({
      task: metadata?.description,
      agentType: metadata?.agentType,
      isBackground: metadata?.isBackground,
    });
    this.subagentTracker?.registerAgent(syntheticAgentId);
    this.publishEvent({
      type: "stream.agent.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId: syntheticAgentId,
        toolCallId,
        agentType: metadata?.agentType ?? "unknown",
        task: normalizedMetadata.task,
        isBackground: normalizedMetadata.isBackground,
        sdkCorrelationId: toolCallId,
      },
    });
    return syntheticAgentId;
  }

  private resolveTaskToolCallIdForSubagent(subagentId: string): string | undefined {
    if (this.toolNameById.has(subagentId)) {
      return subagentId;
    }

    for (const [toolCallId, agentId] of this.toolCallIdToSubagentId) {
      if (agentId === subagentId && this.toolNameById.has(toolCallId)) {
        return toolCallId;
      }
    }

    return undefined;
  }

  private resolveParentAgentId(
    rawParentToolCallId: string | undefined,
  ): string | undefined {
    if (rawParentToolCallId) {
      if (this.subagentTracker?.hasAgent(rawParentToolCallId)) {
        return rawParentToolCallId;
      }
      const mappedParentAgentId = this.toolCallIdToSubagentId.get(rawParentToolCallId);
      if (mappedParentAgentId) {
        return mappedParentAgentId;
      }
    }

    return undefined;
  }

  private promoteSyntheticTaskAgentIdentity(taskToolCallId: string, realAgentId: string): void {
    const syntheticAgentId = buildSyntheticTaskAgentId(taskToolCallId);
    if (syntheticAgentId === realAgentId) {
      return;
    }

    if (this.subagentTracker?.hasAgent(syntheticAgentId)) {
      this.subagentTracker.transferAgent(syntheticAgentId, realAgentId);
    }

    for (const [contextKey, context] of this.activeSubagentToolsById.entries()) {
      if (context.parentAgentId === syntheticAgentId) {
        this.activeSubagentToolsById.set(contextKey, {
          ...context,
          parentAgentId: realAgentId,
        });
      }
    }

    const syntheticQueue = this.earlyToolEvents.get(syntheticAgentId);
    if (syntheticQueue) {
      const existingQueue = this.earlyToolEvents.get(realAgentId) ?? [];
      this.earlyToolEvents.set(realAgentId, [...existingQueue, ...syntheticQueue]);
      this.earlyToolEvents.delete(syntheticAgentId);
    }
  }

  private buildThinkingStreamKey(
    sourceKey: string,
    agentId: string | undefined,
  ): string {
    return `${agentId ?? "__root__"}::${sourceKey}`;
  }

  private getThinkingStreamKey(
    sourceKey: string,
    agentId: string | undefined,
  ): string | undefined {
    const key = this.buildThinkingStreamKey(sourceKey, agentId);
    return this.thinkingStreams.has(key) ? key : undefined;
  }

  private ensureThinkingStream(
    sourceKey: string,
    agentId: string | undefined,
  ): void {
    const key = this.buildThinkingStreamKey(sourceKey, agentId);
    if (!this.thinkingStreams.has(key)) {
      this.thinkingStreams.set(key, {
        startTime: Date.now(),
        sourceKey,
        ...(agentId ? { agentId } : {}),
      });
    }
  }

  private publishSyntheticTaskToolComplete(
    toolCallId: string,
    completion: { success: boolean; result?: unknown; error?: string },
  ): void {
    const toolName = this.toolNameById.get(toolCallId);
    if (!toolName) {
      return;
    }

    const toolId = this.resolveToolCompleteId(toolCallId, toolName);
    const activeToolContext = this.activeSubagentToolsById.get(toolCallId);
    this.removeActiveSubagentToolContext(toolId, toolCallId);
    this.emittedToolStartIds.delete(toolCallId);
    if (activeToolContext?.parentAgentId && this.subagentTracker?.hasAgent(activeToolContext.parentAgentId)) {
      this.subagentTracker.onToolComplete(activeToolContext.parentAgentId);
    }

    this.publishEvent({
      type: "stream.tool.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName,
        toolResult: completion.result,
        success: completion.success,
        error: completion.error,
        sdkCorrelationId: toolCallId,
        ...(activeToolContext?.parentAgentId ? { parentAgentId: activeToolContext.parentAgentId } : {}),
      },
    });
  }

  private recordActiveSubagentToolContext(
    toolId: string,
    toolName: string,
    parentAgentId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    const context = { parentAgentId, toolName };
    const ids = [toolId, ...correlationIds].filter((id): id is string => Boolean(id));
    for (const id of ids) {
      this.activeSubagentToolsById.set(id, context);
    }
  }

  private removeActiveSubagentToolContext(
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ): void {
    const ids = [toolId, ...correlationIds].filter((id): id is string => Boolean(id));
    for (const id of ids) {
      this.activeSubagentToolsById.delete(id);
    }
  }

  /**
   * Publish an event to the bus with backpressure management.
   *
   * Uses a bounded buffer to prevent memory exhaustion when events
   * arrive faster than they can be processed.
   */
  private publishEvent(event: BusEvent): void {
    // Add to buffer
    this.eventBuffer.push(event);

    // Enforce buffer size limit (drop oldest events if overflow)
    if (this.eventBuffer.length - this.eventBufferHead > MAX_BUFFER_SIZE) {
      const dropped = this.eventBuffer[this.eventBufferHead];
      this.eventBufferHead += 1;
      this.compactEventBuffer();
      console.warn(
        `[CopilotStreamAdapter] Buffer overflow: dropped event type=${dropped?.type}`,
      );
    }

    // Start processing buffer if not already processing
    if (!this.isProcessing) {
      this.processBuffer();
    }
  }

  /**
   * Process events from the buffer.
   * Flushes all buffered events to the event bus.
   */
  private processBuffer(): void {
    this.isProcessing = true;

    // Process all buffered events
    while (this.eventBufferHead < this.eventBuffer.length) {
      const event = this.eventBuffer[this.eventBufferHead];
      this.eventBufferHead += 1;
      if (event) {
        try {
          this.bus.publish(event);
        } catch (error) {
          console.error(
            `[CopilotStreamAdapter] Error publishing event type=${event.type}:`,
            error,
          );
        }
      }
    }

    this.compactEventBuffer(true);
    this.isProcessing = false;
  }

  private compactEventBuffer(force = false): void {
    if (this.eventBufferHead === 0) {
      return;
    }

    if (force || this.eventBufferHead >= this.eventBuffer.length) {
      this.eventBuffer.length = 0;
      this.eventBufferHead = 0;
      return;
    }

    if (this.eventBufferHead >= 128 && this.eventBufferHead * 2 >= this.eventBuffer.length) {
      this.eventBuffer = this.eventBuffer.slice(this.eventBufferHead);
      this.eventBufferHead = 0;
    }
  }

  /**
   * Clean up adapter resources.
   *
   * Removes all registered event listeners and clears internal state.
   */
  /**
   * Force-complete any tools that received start but no complete event.
   * Prevents tools from being stuck in running state after stream abort.
   */
  private cleanupOrphanedTools(): void {
    for (const [toolId, toolName] of this.toolNameById.entries()) {
      this.publishEvent({
        type: "stream.tool.complete",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolResult: null,
          success: false,
          error: "Tool execution aborted",
        },
      });
    }
    this.toolNameById.clear();
    this.activeSubagentToolsById.clear();
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

  dispose(): void {
    this.isActive = false;

    // Unsubscribe all event handlers
    this.cleanupSubscriptions();

    // Clear buffer and state
    this.eventBuffer = [];
    this.eventBufferHead = 0;
    this.thinkingStreams.clear();
    this.accumulatedText = "";
    this.accumulatedOutputTokens = 0;
    this.toolNameById.clear();
    this.emittedToolStartIds.clear();
    this.taskToolMetadata.clear();
    this.earlyToolEvents.clear();
    this.activeSubagentToolsById.clear();
    this.toolCallIdToSubagentId.clear();
    this.innerToolCallIds.clear();
    this.suppressedNestedAgentIds.clear();
    this.syntheticForegroundAgent = null;
    this.knownAgentNames.clear();
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

  private getSyntheticForegroundAgentIdForAttribution(): string | undefined {
    if (!this.syntheticForegroundAgent) {
      return undefined;
    }
    if (this.syntheticForegroundAgent.completed || this.syntheticForegroundAgent.sawNativeSubagentStart) {
      return undefined;
    }
    return this.syntheticForegroundAgent.id;
  }

  private publishSyntheticForegroundAgentStart(): void {
    const syntheticAgent = this.syntheticForegroundAgent;
    if (!syntheticAgent || syntheticAgent.started || syntheticAgent.sawNativeSubagentStart) {
      return;
    }
    syntheticAgent.started = true;
    this.subagentTracker?.registerAgent(syntheticAgent.id);
    this.publishEvent({
      type: "stream.agent.start",
      sessionId: this.sessionId,
      runId: this.runId,
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

  private publishSyntheticForegroundAgentComplete(
    success: boolean,
    error?: string,
  ): void {
    const syntheticAgent = this.syntheticForegroundAgent;
    if (!syntheticAgent || !syntheticAgent.started || syntheticAgent.completed) {
      return;
    }
    syntheticAgent.completed = true;
    this.subagentTracker?.removeAgent(syntheticAgent.id);
    this.publishEvent({
      type: "stream.agent.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId: syntheticAgent.id,
        success,
        result: success ? this.accumulatedText : undefined,
        ...(error ? { error } : {}),
      },
    });
  }

  private promoteSyntheticForegroundAgentIdentity(realAgentId: string): void {
    const syntheticAgent = this.syntheticForegroundAgent;
    if (
      !syntheticAgent
      || !syntheticAgent.started
      || syntheticAgent.id === realAgentId
    ) {
      return;
    }

    syntheticAgent.sawNativeSubagentStart = true;
    this.subagentTracker?.transferAgent(syntheticAgent.id, realAgentId);

    for (const [contextKey, context] of this.activeSubagentToolsById.entries()) {
      if (context.parentAgentId === syntheticAgent.id) {
        this.activeSubagentToolsById.set(contextKey, {
          ...context,
          parentAgentId: realAgentId,
        });
      }
    }

    const syntheticQueue = this.earlyToolEvents.get(syntheticAgent.id);
    if (syntheticQueue) {
      const existingQueue = this.earlyToolEvents.get(realAgentId) ?? [];
      this.earlyToolEvents.set(realAgentId, [...existingQueue, ...syntheticQueue]);
      this.earlyToolEvents.delete(syntheticAgent.id);
    }
  }
}
