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
} from "../../sdk/types.ts";
import type { EventBus } from "../event-bus.ts";
import type { BusEvent } from "../bus-events.ts";
import type { SDKStreamAdapter, StreamAdapterOptions } from "./types.ts";
import { SubagentToolTracker } from "./subagent-tool-tracker.ts";

/**
 * Maximum number of events to buffer before dropping oldest events.
 * This prevents memory exhaustion when events arrive faster than they can be processed.
 */
const MAX_BUFFER_SIZE = 1000;

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
  private isProcessing = false;
  private sessionId: string = "";
  private runId: number = 0;
  private messageId: string = "";
  private isActive = false;
  private pendingToolIdsByName = new Map<string, string[]>();
  private toolNameById = new Map<string, string>();
  private syntheticToolCounter = 0;
  private subagentTracker: SubagentToolTracker | null = null;

  /**
   * Track tool call IDs that have already had a `stream.tool.start` emitted
   * (from `assistant.message.toolRequests`), so that a later `tool.execution_start`
   * for the same ID is deduplicated.
   */
  private emittedToolStartIds = new Set<string>();

  /** Maps task tool toolCallId -> metadata extracted from tool arguments */
  private taskToolMetadata = new Map<string, { description: string; isBackground: boolean }>();

  /** Buffers tool events that arrive before their parent subagent.started */
  private earlyToolEvents = new Map<string, Array<{ toolName: string }>>();

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
   * Track thinking streams for timing and correlation.
   * Key: reasoningId (thinkingSourceKey), Value: start timestamp
   */
  private thinkingStreams = new Map<string, number>();

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
    this.sessionId = session.id;
    this.runId = options.runId;
    this.messageId = options.messageId;
    this.accumulatedText = "";
    this.accumulatedOutputTokens = 0;
    this.thinkingStreams.clear();
    this.pendingToolIdsByName.clear();
    this.toolNameById.clear();
    this.syntheticToolCounter = 0;
    this.emittedToolStartIds.clear();
    this.taskToolMetadata.clear();
    this.earlyToolEvents.clear();
    this.toolCallIdToSubagentId.clear();
    this.innerToolCallIds.clear();
    this.knownAgentNames = new Set(
      (options.knownAgentNames ?? []).map(n => n.toLowerCase())
    );
    this.subagentTracker = new SubagentToolTracker(this.bus, this.sessionId, this.runId);
    this.isActive = true;

    this.publishEvent({
      type: "stream.session.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {},
    });

    // Subscribe to all relevant event types from the client
    this.subscribeToEvents();

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
      // Publish error event if streaming fails
      if (this.isActive) {
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
      this.isActive = false;
    }
  }

  /**
   * Subscribe to all relevant events from the Copilot client.
   */
  private subscribeToEvents(): void {
    // Subscribe to message.delta events (text streaming)
    const unsubDelta = this.client.on("message.delta", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleMessageDelta(event);
    });
    this.unsubscribers.push(unsubDelta);

    // Subscribe to message.complete events
    const unsubComplete = this.client.on("message.complete", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleMessageComplete(event);
    });
    this.unsubscribers.push(unsubComplete);

    // Subscribe to tool.start events
    const unsubToolStart = this.client.on("tool.start", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleToolStart(event);
    });
    this.unsubscribers.push(unsubToolStart);

    // Subscribe to tool.complete events
    const unsubToolComplete = this.client.on("tool.complete", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleToolComplete(event);
    });
    this.unsubscribers.push(unsubToolComplete);

    // Subscribe to session.idle events
    const unsubIdle = this.client.on("session.idle", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSessionIdle(event);
    });
    this.unsubscribers.push(unsubIdle);

    // Subscribe to session.error events
    const unsubError = this.client.on("session.error", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSessionError(event);
    });
    this.unsubscribers.push(unsubError);

    // Subscribe to usage events
    const unsubUsage = this.client.on("usage", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleUsage(event);
    });
    this.unsubscribers.push(unsubUsage);

    // Subscribe to permission request events
    const unsubPermission = this.client.on("permission.requested", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handlePermissionRequested(event as AgentEvent<"permission.requested">);
    });
    this.unsubscribers.push(unsubPermission);

    // Subscribe to workflow/human-input events
    const unsubHumanInput = this.client.on("human_input_required", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleHumanInputRequired(event as AgentEvent<"human_input_required">);
    });
    this.unsubscribers.push(unsubHumanInput);

    // Subscribe to skill invocation events
    const unsubSkill = this.client.on("skill.invoked", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSkillInvoked(event as AgentEvent<"skill.invoked">);
    });
    this.unsubscribers.push(unsubSkill);

    // Subscribe to reasoning delta events (thinking content)
    const unsubReasoningDelta = this.client.on("reasoning.delta", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleReasoningDelta(event as AgentEvent<"reasoning.delta">);
    });
    this.unsubscribers.push(unsubReasoningDelta);

    // Subscribe to reasoning complete events
    const unsubReasoningComplete = this.client.on("reasoning.complete", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleReasoningComplete(event as AgentEvent<"reasoning.complete">);
    });
    this.unsubscribers.push(unsubReasoningComplete);

    // Subscribe to subagent start events
    const unsubSubagentStart = this.client.on("subagent.start", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSubagentStart(event as AgentEvent<"subagent.start">);
    });
    this.unsubscribers.push(unsubSubagentStart);

    // Subscribe to subagent complete events
    const unsubSubagentComplete = this.client.on("subagent.complete", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSubagentComplete(event as AgentEvent<"subagent.complete">);
    });
    this.unsubscribers.push(unsubSubagentComplete);

    // Subscribe to turn lifecycle events
    const unsubTurnStart = this.client.on("turn.start", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleTurnStart(event as AgentEvent<"turn.start">);
    });
    this.unsubscribers.push(unsubTurnStart);

    const unsubTurnEnd = this.client.on("turn.end", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleTurnEnd(event as AgentEvent<"turn.end">);
    });
    this.unsubscribers.push(unsubTurnEnd);

    // Subscribe to tool partial result events (streaming tool output)
    const unsubToolPartial = this.client.on("tool.partial_result", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleToolPartialResult(event as AgentEvent<"tool.partial_result">);
    });
    this.unsubscribers.push(unsubToolPartial);

    // Subscribe to session info/warning/title/truncation/compaction events
    const unsubInfo = this.client.on("session.info", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSessionInfo(event as AgentEvent<"session.info">);
    });
    this.unsubscribers.push(unsubInfo);

    const unsubWarning = this.client.on("session.warning", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSessionWarning(event as AgentEvent<"session.warning">);
    });
    this.unsubscribers.push(unsubWarning);

    const unsubTitleChanged = this.client.on("session.title_changed", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSessionTitleChanged(event as AgentEvent<"session.title_changed">);
    });
    this.unsubscribers.push(unsubTitleChanged);

    const unsubTruncation = this.client.on("session.truncation", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSessionTruncation(event as AgentEvent<"session.truncation">);
    });
    this.unsubscribers.push(unsubTruncation);

    const unsubCompaction = this.client.on("session.compaction", (event) => {
      if (!this.isActive || event.sessionId !== this.sessionId) return;
      this.handleSessionCompaction(event as AgentEvent<"session.compaction">);
    });
    this.unsubscribers.push(unsubCompaction);
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

    // Skip sub-agent text deltas — they belong to a child agent and should
    // not be accumulated or rendered in the main chat stream.
    const parentToolCallId = (event.data as Record<string, unknown>).parentToolCallId;
    if (parentToolCallId) return;

    // Check if this is thinking/reasoning content
    if (contentType === "thinking" && thinkingSourceKey) {
      // Thinking delta
      if (!this.thinkingStreams.has(thinkingSourceKey)) {
        this.thinkingStreams.set(thinkingSourceKey, Date.now());
      }

      this.publishEvent({
        type: "stream.thinking.delta",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          delta,
          sourceKey: thinkingSourceKey,
          messageId: this.messageId,
        },
      });
    } else {
      // Regular text delta
      this.accumulatedText += delta;

      if (delta.length > 0) {
        this.publishEvent({
          type: "stream.text.delta",
          sessionId: this.sessionId,
          runId: this.runId,
          timestamp: Date.now(),
          data: {
            delta,
            messageId: this.messageId,
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
    // Skip sub-agent message completions — they belong to a child agent.
    // Inner tool calls are tracked via tool.execution_start (which carries
    // parentId) and the SubagentToolTracker, NOT from message.complete.
    const parentToolCallId = (event.data as Record<string, unknown>).parentToolCallId;
    if (parentToolCallId) return;

    // Publish thinking complete events for any active thinking streams
    for (const [sourceKey, startTime] of this.thinkingStreams.entries()) {
      const durationMs = Date.now() - startTime;
      this.publishEvent({
        type: "stream.thinking.complete",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          sourceKey,
          durationMs,
        },
      });
    }

    // Clear thinking streams after completion
    this.thinkingStreams.clear();

    // Emit stream.tool.start for each toolRequest in the message.complete payload.
    // This mirrors the Copilot CLI's useTimeline.ts behaviour where tool call UI
    // entries are created from assistant.message.toolRequests.
    const toolRequests = (event.data as Record<string, unknown>).toolRequests;
    const hasToolRequests = Array.isArray(toolRequests) && toolRequests.length > 0;

    if (hasToolRequests) {
      for (const request of toolRequests as Array<Record<string, unknown>>) {
        const toolCallId = this.asString(request.toolCallId);
        const toolName = this.normalizeToolName(request.name);
        const toolInput = this.normalizeToolInput(request.arguments);
        if (!toolCallId) continue;

        // Extract metadata from task tool arguments for subagent enrichment
        if (this.isTaskTool(toolName) && request.arguments) {
          const args = this.asRecord(request.arguments) ?? {};
          this.taskToolMetadata.set(toolCallId, {
            description: typeof args.description === "string" ? args.description
              : typeof args.prompt === "string" ? args.prompt
              : "",
            isBackground: args.mode === "background" || args.run_in_background === true,
          });
        }

        this.emittedToolStartIds.add(toolCallId);
        const toolId = this.resolveToolStartId(toolCallId, toolName);

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
    if (!hasToolRequests && this.accumulatedText.length > 0) {
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
    const { toolName, toolInput, toolUseId, toolCallId } = event.data;

    // Use toolCallId (Copilot) or toolUseId (Claude) as the unique ID
    const explicitToolId = this.asString(toolCallId || toolUseId);

    // Skip if already emitted from assistant.message.toolRequests
    if (explicitToolId && this.emittedToolStartIds.has(explicitToolId)) {
      return;
    }

    const resolvedToolName = this.normalizeToolName(toolName);
    const toolId = this.resolveToolStartId(explicitToolId, resolvedToolName);

    // Resolve the parent agent ID from either parentId (direct) or
    // parentToolCallId (Copilot SDK: the task tool call ID that spawned the agent).
    const rawParentId = this.asString((event.data as Record<string, unknown>).parentId);
    const rawParentToolCallId = this.asString((event.data as Record<string, unknown>).parentToolCallId);
    const parentAgentId = rawParentId
      ?? (rawParentToolCallId ? this.toolCallIdToSubagentId.get(rawParentToolCallId) : undefined)
      ?? undefined;

    this.publishEvent({
      type: "stream.tool.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName: resolvedToolName,
        toolInput: this.normalizeToolInput(toolInput),
        sdkCorrelationId: explicitToolId ?? toolId,
        parentAgentId,
      },
    });

    // Track tool start for sub-agent if this tool belongs to one.
    // Also record the tool call ID as an "inner" tool call so that
    // nested subagent.start events (whose toolCallId matches) can be
    // detected and suppressed from the top-level agent tree.
    if (parentAgentId) {
      if (explicitToolId) {
        this.innerToolCallIds.add(explicitToolId);
      }
      if (this.subagentTracker?.hasAgent(parentAgentId)) {
        this.subagentTracker.onToolStart(parentAgentId, resolvedToolName);
      } else {
        // Buffer for subagents not yet registered (race condition).
        // Key by parentAgentId when available, otherwise by the raw
        // parentToolCallId so handleSubagentStart can replay them.
        const bufferKey = parentAgentId;
        const queue = this.earlyToolEvents.get(bufferKey) ?? [];
        queue.push({ toolName: resolvedToolName });
        this.earlyToolEvents.set(bufferKey, queue);
      }
    } else if (rawParentToolCallId) {
      // parentToolCallId present but mapping not yet established
      // (subagent.start hasn't arrived). Buffer by toolCallId.
      const queue = this.earlyToolEvents.get(rawParentToolCallId) ?? [];
      queue.push({ toolName: resolvedToolName });
      this.earlyToolEvents.set(rawParentToolCallId, queue);
    }
  }

  /**
   * Handle tool.complete event.
   */
  private handleToolComplete(event: AgentEvent<"tool.complete">): void {
    const { toolName, toolResult, success, error, toolUseId, toolCallId } =
      event.data;

    // Use toolCallId (Copilot) or toolUseId (Claude) as the unique ID
    const explicitToolId = this.asString(toolCallId || toolUseId);
    const toolId = this.resolveToolCompleteId(explicitToolId, toolName);
    const resolvedToolName = this.normalizeToolName(toolName ?? this.toolNameById.get(toolId));
    const toolInput = this.normalizeToolInput((event.data as Record<string, unknown>).toolInput);
    this.toolNameById.delete(toolId);

    // Clean up deduplication tracking
    if (explicitToolId) {
      this.emittedToolStartIds.delete(explicitToolId);
    }
    const normalizedSuccess = typeof success === "boolean" ? success : true;

    // Track tool completion for sub-agent if this tool belongs to one
    const rawParentIdComplete = this.asString((event.data as Record<string, unknown>).parentId);
    const rawParentToolCallIdComplete = this.asString((event.data as Record<string, unknown>).parentToolCallId);
    const resolvedParentId = rawParentIdComplete
      ?? (rawParentToolCallIdComplete ? this.toolCallIdToSubagentId.get(rawParentToolCallIdComplete) : undefined)
      ?? undefined;
    if (resolvedParentId && this.subagentTracker?.hasAgent(resolvedParentId)) {
      this.subagentTracker.onToolComplete(resolvedParentId);
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
        sdkCorrelationId: explicitToolId ?? toolId,
        parentAgentId: resolvedParentId,
      },
    });
  }

  /**
   * Handle session.idle event.
   */
  private handleSessionIdle(event: AgentEvent<"session.idle">): void {
    const { reason } = event.data;

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
    this.publishEvent({
      type: "stream.skill.invoked",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        skillName: data.skillName,
        skillPath: data.skillPath,
      },
    });
  }

  /**
   * Handle reasoning.delta event (thinking content from Copilot SDK).
   */
  private handleReasoningDelta(event: AgentEvent<"reasoning.delta">): void {
    const data = event.data as ReasoningDeltaEventData;
    const reasoningId = data.reasoningId ?? "reasoning";

    if (!this.thinkingStreams.has(reasoningId)) {
      this.thinkingStreams.set(reasoningId, Date.now());
    }

    this.publishEvent({
      type: "stream.thinking.delta",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        delta: data.delta,
        sourceKey: reasoningId,
        messageId: this.messageId,
      },
    });
  }

  /**
   * Handle reasoning.complete event.
   */
  private handleReasoningComplete(event: AgentEvent<"reasoning.complete">): void {
    const data = event.data as ReasoningCompleteEventData;
    const reasoningId = data.reasoningId ?? "reasoning";
    const startTime = this.thinkingStreams.get(reasoningId) ?? Date.now();
    const durationMs = Date.now() - startTime;
    this.thinkingStreams.delete(reasoningId);

    this.publishEvent({
      type: "stream.thinking.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        sourceKey: reasoningId,
        durationMs,
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
      return;
    }

    // Look up task metadata from the parent task tool call
    const metadata = this.taskToolMetadata.get(toolCallId);
    const isBackground = metadata?.isBackground ?? false;
    // Prefer task description from tool arguments over agent type description
    const task = metadata?.description || data.task || "";

    // Register agent with tracker for tool counting
    this.subagentTracker?.registerAgent(data.subagentId);

    // Map task-tool toolCallId → subagentId so inner tool events
    // (which carry parentToolCallId, not parentId) can be resolved.
    if (toolCallId !== data.subagentId) {
      this.toolCallIdToSubagentId.set(toolCallId, data.subagentId);
    }

    // Replay any early tool events that arrived before this subagent.started.
    // Events may be keyed by subagentId (parentId path) or toolCallId
    // (parentToolCallId path, before the mapping existed).
    for (const key of [data.subagentId, toolCallId]) {
      const earlyTools = this.earlyToolEvents.get(key);
      if (earlyTools) {
        for (const tool of earlyTools) {
          this.subagentTracker?.onToolStart(data.subagentId, tool.toolName);
        }
        this.earlyToolEvents.delete(key);
      }
    }

    this.publishEvent({
      type: "stream.agent.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        agentId: data.subagentId,
        agentType: data.subagentType ?? "unknown",
        task,
        isBackground,
        sdkCorrelationId: toolCallId,
      },
    });
  }

  /**
   * Handle subagent.complete event.
   */
  private handleSubagentComplete(event: AgentEvent<"subagent.complete">): void {
    const data = event.data as SubagentCompleteEventData;
    this.subagentTracker?.removeAgent(data.subagentId);
    this.taskToolMetadata.delete(data.subagentId);
    this.earlyToolEvents.delete(data.subagentId);
    // Clean up toolCallId → subagentId mapping
    for (const [tcId, agentId] of this.toolCallIdToSubagentId) {
      if (agentId === data.subagentId) {
        this.toolCallIdToSubagentId.delete(tcId);
        break;
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
        error: typeof (data as Record<string, unknown>).error === "string"
          ? (data as Record<string, unknown>).error as string
          : undefined,
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
        turnId: data.turnId ?? `turn_${Date.now()}`,
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
      data: {
        turnId: data.turnId ?? `turn_${Date.now()}`,
      },
    });
  }

  /**
   * Handle tool.partial_result event (streaming tool output).
   */
  private handleToolPartialResult(event: AgentEvent<"tool.partial_result">): void {
    const data = event.data as ToolPartialResultEventData;
    this.publishEvent({
      type: "stream.tool.partial_result",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolCallId: data.toolCallId,
        partialOutput: data.partialOutput,
      },
    });
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

  private createSyntheticToolId(toolName: string): string {
    this.syntheticToolCounter += 1;
    const normalizedName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `tool_${this.runId}_${normalizedName}_${this.syntheticToolCounter}`;
  }

  private queueToolId(toolName: string, toolId: string): void {
    const queue = this.pendingToolIdsByName.get(toolName) ?? [];
    if (!queue.includes(toolId)) {
      queue.push(toolId);
      this.pendingToolIdsByName.set(toolName, queue);
    }
    this.toolNameById.set(toolId, toolName);
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

  private resolveToolStartId(explicitToolId: string | undefined, toolName: string): string {
    const toolId = explicitToolId ?? this.createSyntheticToolId(toolName);
    this.queueToolId(toolName, toolId);
    return toolId;
  }

  private resolveToolCompleteId(
    explicitToolId: string | undefined,
    toolName: unknown,
  ): string {
    if (explicitToolId) {
      const resolvedName = this.normalizeToolName(toolName ?? this.toolNameById.get(explicitToolId));
      this.removeQueuedToolId(resolvedName, explicitToolId);
      return explicitToolId;
    }

    const resolvedName = this.normalizeToolName(toolName);
    return this.shiftQueuedToolId(resolvedName) ?? this.createSyntheticToolId(resolvedName);
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
    if (this.eventBuffer.length > MAX_BUFFER_SIZE) {
      const dropped = this.eventBuffer.shift();
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
    while (this.eventBuffer.length > 0) {
      const event = this.eventBuffer.shift();
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

    this.isProcessing = false;
  }

  /**
   * Clean up adapter resources.
   *
   * Removes all registered event listeners and clears internal state.
   */
  dispose(): void {
    this.isActive = false;

    // Unsubscribe all event handlers
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    // Clear buffer and state
    this.eventBuffer = [];
    this.thinkingStreams.clear();
    this.accumulatedText = "";
    this.accumulatedOutputTokens = 0;
    this.pendingToolIdsByName.clear();
    this.toolNameById.clear();
    this.syntheticToolCounter = 0;
    this.emittedToolStartIds.clear();
    this.taskToolMetadata.clear();
    this.earlyToolEvents.clear();
    this.toolCallIdToSubagentId.clear();
    this.innerToolCallIds.clear();
    this.knownAgentNames.clear();
    this.subagentTracker?.reset();
    this.subagentTracker = null;
  }
}
