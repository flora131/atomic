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
 * - thinking (from message.delta with thinking content) → stream.thinking.delta
 * - session.idle → stream.session.idle
 * - session.error → stream.session.error
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
} from "../../sdk/types.ts";
import type { AtomicEventBus } from "../event-bus.ts";
import type { BusEvent } from "../bus-events.ts";
import type { SDKStreamAdapter, StreamAdapterOptions } from "./types.ts";

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
  private bus: AtomicEventBus;
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
   * Create a new Copilot stream adapter.
   *
   * @param bus - The event bus to publish events to
   * @param client - The Copilot client to subscribe to events from
   */
  constructor(bus: AtomicEventBus, client: CodingAgentClient) {
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
    this.thinkingStreams.clear();
    this.pendingToolIdsByName.clear();
    this.toolNameById.clear();
    this.syntheticToolCounter = 0;
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

      // Consume the stream to completion
      for await (const _chunk of streamIterator) {
        // The chunks are handled by our event subscribers
        // We just need to consume the iterator to keep it running
      }

      // Stream completed successfully
      if (this.isActive) {
        this.publishEvent({
          type: "stream.session.idle",
          sessionId: this.sessionId,
          runId: this.runId,
          timestamp: Date.now(),
          data: {
            reason: "stream_complete",
          },
        });
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
  }

  /**
   * Handle message.delta event (text or thinking content).
   */
  private handleMessageDelta(event: AgentEvent<"message.delta">): void {
    const { delta, contentType, thinkingSourceKey } = event.data;

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

  /**
   * Handle message.complete event.
   */
  private handleMessageComplete(_event: AgentEvent<"message.complete">): void {
    // Publish text complete event
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
  }

  /**
   * Handle tool.start event.
   */
  private handleToolStart(event: AgentEvent<"tool.start">): void {
    const { toolName, toolInput, toolUseId, toolCallId } = event.data;

    // Use toolCallId (Copilot) or toolUseId (Claude) as the unique ID
    const explicitToolId = this.asString(toolCallId || toolUseId);
    const resolvedToolName = this.normalizeToolName(toolName);
    const toolId = this.resolveToolStartId(explicitToolId, resolvedToolName);

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
        parentAgentId: this.asString((event.data as Record<string, unknown>).parentId),
      },
    });
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
    const normalizedSuccess = typeof success === "boolean" ? success : true;

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
   */
  private handleUsage(event: AgentEvent<"usage">): void {
    // The usage event data structure varies by SDK
    // For Copilot, it might be in different formats
    const data = event.data as Record<string, unknown>;

    const inputTokens = (data.inputTokens as number) || 0;
    const outputTokens = (data.outputTokens as number) || 0;
    const model = data.model as string | undefined;

    this.publishEvent({
      type: "stream.usage",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        inputTokens,
        outputTokens,
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
    this.pendingToolIdsByName.clear();
    this.toolNameById.clear();
    this.syntheticToolCounter = 0;
  }
}
