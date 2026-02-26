/**
 * OpenCode SDK Stream Adapter
 *
 * Consumes streaming events from the OpenCode SDK's event emitter and
 * AsyncIterable stream, and publishes them to the event bus as normalized BusEvents.
 *
 * Key responsibilities:
 * - Subscribe to SDK events via client.on() (tool, subagent, session events)
 * - Consume session.stream() AsyncIterable for text and thinking deltas
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
 * Note: OpenCode emits most events through the SDK's event emitter,
 * while the stream yields AgentMessage chunks for text and thinking content.
 *
 * Usage:
 * ```typescript
 * const adapter = new OpenCodeStreamAdapter(eventBus, sessionId);
 * await adapter.startStreaming(session, message, { runId, messageId, agent });
 * adapter.dispose(); // Cancel and cleanup
 * ```
 */

import type { AtomicEventBus } from "../event-bus.ts";
import type { BusEvent } from "../bus-events.ts";
import type {
  SDKStreamAdapter,
  StreamAdapterOptions,
} from "./types.ts";
import type {
  Session,
  AgentMessage,
  EventType,
  EventHandler,
  ToolStartEventData,
  ToolCompleteEventData,
  SubagentStartEventData,
  SubagentCompleteEventData,
  MessageDeltaEventData,
} from "../../sdk/types.ts";

/**
 * Stream adapter for OpenCode SDK.
 *
 * Consumes events from both the SDK's event emitter (for tool/subagent/session events)
 * and the AsyncIterable stream from session.stream() (for text/thinking deltas).
 */
export class OpenCodeStreamAdapter implements SDKStreamAdapter {
  private bus: AtomicEventBus;
  private sessionId: string;
  private abortController: AbortController | null = null;
  private textAccumulator = "";
  private unsubscribers: Array<() => void> = [];
  // Track thinking blocks to emit complete events
  private thinkingBlocks = new Map<string, { startTime: number }>();

  /**
   * Create a new OpenCode stream adapter.
   *
   * @param bus - The event bus to publish events to
   * @param sessionId - Session ID for event correlation
   */
  constructor(bus: AtomicEventBus, sessionId: string) {
    this.bus = bus;
    this.sessionId = sessionId;
  }

  /**
   * Start consuming the OpenCode SDK stream and publishing BusEvents.
   *
   * This method will:
   * 1. Subscribe to SDK events (tool, subagent, session, usage events)
   * 2. Iterate over the AsyncIterable stream from session.stream()
   * 3. Map each AgentMessage to the appropriate BusEvent
   * 4. Publish events directly to the bus
   * 5. Complete with a stream.text.complete event
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

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Reset state
    this.textAccumulator = "";
    this.thinkingBlocks.clear();

    // Get the SDK client from the session to subscribe to events
    // Note: The OpenCode SDK emits most events through the CodingAgentClient event emitter
    const client = (session as any).__client;
    if (client && typeof client.on === "function") {
      // Subscribe to message.delta events (backup - primarily handled in stream)
      const unsubDelta = client.on(
        "message.delta" as EventType,
        this.createMessageDeltaHandler(runId, messageId),
      );
      this.unsubscribers.push(unsubDelta);

      // Subscribe to message.complete events
      const unsubComplete = client.on(
        "message.complete" as EventType,
        this.createMessageCompleteHandler(runId, messageId),
      );
      this.unsubscribers.push(unsubComplete);

      // Subscribe to tool.start events
      const unsubToolStart = client.on(
        "tool.start" as EventType,
        this.createToolStartHandler(runId),
      );
      this.unsubscribers.push(unsubToolStart);

      // Subscribe to tool.complete events
      const unsubToolComplete = client.on(
        "tool.complete" as EventType,
        this.createToolCompleteHandler(runId),
      );
      this.unsubscribers.push(unsubToolComplete);

      // Subscribe to subagent.start events
      const unsubAgentStart = client.on(
        "subagent.start" as EventType,
        this.createSubagentStartHandler(runId),
      );
      this.unsubscribers.push(unsubAgentStart);

      // Subscribe to subagent.complete events
      const unsubAgentComplete = client.on(
        "subagent.complete" as EventType,
        this.createSubagentCompleteHandler(runId),
      );
      this.unsubscribers.push(unsubAgentComplete);

      // Subscribe to session.idle events
      const unsubIdle = client.on(
        "session.idle" as EventType,
        this.createSessionIdleHandler(runId),
      );
      this.unsubscribers.push(unsubIdle);

      // Subscribe to session.error events
      const unsubError = client.on(
        "session.error" as EventType,
        this.createSessionErrorHandler(runId),
      );
      this.unsubscribers.push(unsubError);

      // Subscribe to usage events
      const unsubUsage = client.on(
        "usage" as EventType,
        this.createUsageHandler(runId),
      );
      this.unsubscribers.push(unsubUsage);
    }

    try {
      // Start streaming from the OpenCode SDK
      const stream = session.stream(message, agent ? { agent } : undefined);

      // Iterate over the AsyncIterable stream
      for await (const chunk of stream) {
        // Check for cancellation
        if (this.abortController.signal.aborted) {
          break;
        }

        await this.processStreamChunk(chunk, runId, messageId);
      }

      // Publish stream.text.complete event if we accumulated any text
      if (this.textAccumulator.length > 0) {
        this.publishTextComplete(runId, messageId);
      }
    } catch (error) {
      // Handle stream errors
      if (!this.abortController.signal.aborted) {
        this.publishSessionError(runId, error);
      }
    } finally {
      // Cleanup SDK event subscriptions
      this.cleanupSubscriptions();
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
        | { thinkingMs?: number }
        | undefined;
      if (streamingStats?.thinkingMs !== undefined) {
        const thinkingBlock = this.thinkingBlocks.get(sourceKey);
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
    }
  }

  /**
   * Create a handler for message.delta events from the SDK.
   */
  private createMessageDeltaHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"message.delta"> {
    return (event) => {
      // Only process events for this session
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as MessageDeltaEventData;
      const delta = data.delta;
      const contentType = data.contentType;
      const thinkingSourceKey = data.thinkingSourceKey;

      if (contentType === "thinking") {
        // Handle thinking deltas
        const sourceKey = thinkingSourceKey ?? "default";

        // Track the start time for this thinking block
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
        // Handle text deltas
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

      // Extract tool use ID from various SDK formats
      const sdkCorrelationId =
        data.toolUseId ?? data.toolUseID ?? data.toolCallId;

      const busEvent: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId: sdkCorrelationId ?? `tool_${Date.now()}`,
          toolName: data.toolName,
          toolInput: (data.toolInput ?? {}) as Record<string, unknown>,
          sdkCorrelationId,
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

      // Extract tool use ID from various SDK formats
      const sdkCorrelationId =
        data.toolUseId ?? data.toolUseID ?? data.toolCallId;

      const busEvent: BusEvent<"stream.tool.complete"> = {
        type: "stream.tool.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId: sdkCorrelationId ?? `tool_${Date.now()}`,
          toolName: data.toolName,
          toolResult: String(data.toolResult ?? ""),
          success: data.success,
          error: data.error,
          sdkCorrelationId,
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
      const sdkCorrelationId = data.toolUseID ?? data.toolCallId;

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
   * Create a handler for session.idle events from the SDK.
   */
  private createSessionIdleHandler(
    runId: number,
  ): EventHandler<"session.idle"> {
    return (event) => {
      // Only process events for this session
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const busEvent: BusEvent<"stream.session.idle"> = {
        type: "stream.session.idle",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          reason: event.data.reason,
        },
      };

      this.bus.publish(busEvent);
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
   */
  private createUsageHandler(runId: number): EventHandler<"usage"> {
    return (event) => {
      // Only process events for this session
      if (event.sessionId !== this.sessionId) {
        return;
      }

      // Usage events from the SDK might have inputTokens/outputTokens
      const data = event.data as any;
      const inputTokens = data.inputTokens ?? data.input_tokens ?? 0;
      const outputTokens = data.outputTokens ?? data.output_tokens ?? 0;
      const model = data.model;

      const busEvent: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          inputTokens,
          outputTokens,
          model,
        },
      };

      this.bus.publish(busEvent);
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

  /**
   * Clean up SDK event subscriptions.
   */
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
  }
}
