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

import type { AtomicEventBus } from "../event-bus.ts";
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
  private client?: CodingAgentClient;
  private abortController: AbortController | null = null;
  private textAccumulator = "";
  private unsubscribers: Array<() => void> = [];
  /** Tracks thinking source start times for duration computation */
  private thinkingStartTimes = new Map<string, number>();
  private pendingToolIdsByName = new Map<string, string[]>();
  private syntheticToolCounter = 0;

  /**
   * Create a new Claude stream adapter.
   *
   * @param bus - The event bus to publish events to
   * @param sessionId - Session ID for event correlation
   */
  constructor(bus: AtomicEventBus, sessionId: string, client?: CodingAgentClient) {
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
    const { runId, messageId, agent } = options;

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Reset text accumulator
    this.textAccumulator = "";
    this.thinkingStartTimes.clear();
    this.pendingToolIdsByName.clear();
    this.syntheticToolCounter = 0;

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
    }

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
      if (this.abortController && !this.abortController.signal.aborted) {
        this.publishSessionError(runId, error);
      }
    } finally {
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
        | { thinkingMs?: number }
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

    // Handle agent lifecycle events
    if ((chunk.type as string) === "agent_start") {
      const event: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: (chunk as any).agentId ?? `agent_${Date.now()}`,
          agentType: (chunk as any).agentType ?? "unknown",
          task: (chunk as any).task ?? "",
          isBackground: (chunk as any).isBackground ?? false,
          sdkCorrelationId: (chunk as any).correlationId,
        },
      };
      this.bus.publish(event);
    }

    if ((chunk.type as string) === "agent_complete") {
      const event: BusEvent<"stream.agent.complete"> = {
        type: "stream.agent.complete",
        sessionId: this.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: (chunk as any).agentId ?? `agent_${Date.now()}`,
          success: (chunk as any).success ?? true,
          result: (chunk as any).result ? String((chunk as any).result) : undefined,
          error: (chunk as any).error ? String((chunk as any).error) : undefined,
        },
      };
      this.bus.publish(event);
    }
  }

  private createToolStartHandler(runId: number): EventHandler<"tool.start"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as ToolStartEventData;
      const sdkCorrelationId = this.asString(
        data.toolUseId ?? data.toolUseID ?? data.toolCallId,
      );
      const toolName = this.normalizeToolName(data.toolName);
      const toolId = this.resolveToolStartId(sdkCorrelationId, runId, toolName);

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

  private createToolCompleteHandler(runId: number): EventHandler<"tool.complete"> {
    return (event) => {
      if (event.sessionId !== this.sessionId) {
        return;
      }

      const data = event.data as ToolCompleteEventData;
      const sdkCorrelationId = this.asString(
        data.toolUseId ?? data.toolUseID ?? data.toolCallId,
      );
      const toolName = this.normalizeToolName(data.toolName);
      const toolId = this.resolveToolCompleteId(sdkCorrelationId, runId, toolName);
      const toolInput = this.asRecord((data as Record<string, unknown>).toolInput);

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
   * Cancel the ongoing stream and cleanup resources.
   */
  dispose(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.textAccumulator = "";
    this.thinkingStartTimes.clear();
    this.pendingToolIdsByName.clear();
    this.syntheticToolCounter = 0;
  }
}
