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
  EventType,
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
    this.isActive = true;

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
  private handleMessageComplete(event: AgentEvent<"message.complete">): void {
    const { message } = event.data;

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
    const toolId = toolCallId || toolUseId || `tool_${Date.now()}`;

    this.publishEvent({
      type: "stream.tool.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName,
        toolInput: (toolInput as Record<string, unknown>) || {},
        sdkCorrelationId: toolCallId || toolUseId,
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
    const toolId = toolCallId || toolUseId || `tool_${Date.now()}`;

    this.publishEvent({
      type: "stream.tool.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName,
        toolResult: String(toolResult || ""),
        success,
        error,
        sdkCorrelationId: toolCallId || toolUseId,
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
  }
}
