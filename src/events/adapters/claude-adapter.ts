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
 * Note: Tool events, session events, and usage events from the SDK's event emitter
 * are handled at a higher level (where the adapter is instantiated), not by the adapter itself.
 *
 * Usage:
 * ```typescript
 * const adapter = new ClaudeStreamAdapter(eventBus, sessionId);
 * await adapter.startStreaming(session, message, { runId, messageId });
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
} from "../../sdk/types.ts";

/**
 * Stream adapter for Claude Agent SDK.
 *
 * Consumes the AsyncIterable stream from session.stream() and publishes
 * normalized BusEvents to the event bus.
 */
export class ClaudeStreamAdapter implements SDKStreamAdapter {
  private bus: AtomicEventBus;
  private sessionId: string;
  private abortController: AbortController | null = null;
  private textAccumulator = "";

  /**
   * Create a new Claude stream adapter.
   *
   * @param bus - The event bus to publish events to
   * @param sessionId - Session ID for event correlation
   */
  constructor(bus: AtomicEventBus, sessionId: string) {
    this.bus = bus;
    this.sessionId = sessionId;
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
    const { runId, messageId, agent } = options;

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Reset text accumulator
    this.textAccumulator = "";

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

      // Publish stream.text.complete event
      this.publishTextComplete(runId, messageId);
    } catch (error) {
      // Handle stream errors
      if (!this.abortController.signal.aborted) {
        this.publishSessionError(runId, error);
      }
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

    // Handle thinking deltas and completion
    if (chunk.type === "thinking") {
      const metadata = chunk.metadata;
      const thinkingSourceKey = metadata?.thinkingSourceKey as string | undefined;

      // Check if this is a thinking delta (has content)
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        const event: BusEvent<"stream.thinking.delta"> = {
          type: "stream.thinking.delta",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            delta: chunk.content,
            sourceKey: thinkingSourceKey ?? "default",
            messageId,
          },
        };

        this.bus.publish(event);
      }

      // Check if this is a thinking complete event (has streamingStats but no content)
      const streamingStats = metadata?.streamingStats as
        | { thinkingMs?: number }
        | undefined;
      if (streamingStats?.thinkingMs !== undefined && chunk.content === "") {
        const event: BusEvent<"stream.thinking.complete"> = {
          type: "stream.thinking.complete",
          sessionId: this.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            sourceKey: thinkingSourceKey ?? "default",
            durationMs: streamingStats.thinkingMs,
          },
        };

        this.bus.publish(event);
      }
    }
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
   * Cancel the ongoing stream and cleanup resources.
   */
  dispose(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.textAccumulator = "";
  }
}
