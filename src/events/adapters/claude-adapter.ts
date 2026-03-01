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
  SDKStreamAdapter,
  StreamAdapterOptions,
} from "./types.ts";
import type {
  CodingAgentClient,
  Session,
  AgentMessage,
  EventHandler,
  SessionIdleEventData,
  ToolStartEventData,
  ToolCompleteEventData,
  SubagentStartEventData,
  SubagentCompleteEventData,
  SubagentUpdateEventData,
  PermissionRequestedEventData,
} from "../../sdk/types.ts";
import { SubagentToolTracker } from "./subagent-tool-tracker.ts";

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
  private syntheticToolCounter = 0;
  private accumulatedOutputTokens = 0;
  private subagentTracker: SubagentToolTracker | null = null;

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
    const { runId, messageId, agent } = options;

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    // Reset text accumulator
    this.textAccumulator = "";
    this.thinkingStartTimes.clear();
    this.pendingToolIdsByName.clear();
    this.toolCorrelationAliases.clear();
    this.syntheticToolCounter = 0;
    this.accumulatedOutputTokens = 0;
    this.subagentTracker = new SubagentToolTracker(this.bus, this.sessionId, runId);

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

      // Publish stream.text.complete event if we accumulated any text
      if (this.textAccumulator.length > 0) {
        this.publishTextComplete(runId, messageId);
      }
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
      const parentAgentId = this.asString(
        (data as Record<string, unknown>).parentAgentId,
      );

      // Update sub-agent tool tracker for tool count display
      if (parentAgentId) {
        this.subagentTracker?.onToolStart(parentAgentId, toolName);
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
          ...(parentAgentId ? { parentAgentId } : {}),
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
      const parentAgentId = this.asString(
        (data as Record<string, unknown>).parentAgentId,
      );

      // Update sub-agent tool tracker for tool count display
      if (parentAgentId) {
        this.subagentTracker?.onToolComplete(parentAgentId);
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
          ...(parentAgentId ? { parentAgentId } : {}),
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

      // Register agent with tracker for tool counting
      this.subagentTracker?.registerAgent(data.subagentId);

      // Resolve correlation ID: prefer toolUseId/toolUseID, fall back to toolCallId,
      // then check alias map for canonical tool ID resolution.
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
          isBackground: false,
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
    this.toolCorrelationAliases.clear();
    this.syntheticToolCounter = 0;
    this.accumulatedOutputTokens = 0;
    this.subagentTracker?.reset();
    this.subagentTracker = null;
  }
}
