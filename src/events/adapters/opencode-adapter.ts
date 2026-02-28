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
  MessageDeltaEventData,
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

/**
 * Stream adapter for OpenCode SDK.
 *
 * Consumes events from both the SDK's event emitter (for tool/subagent/session events)
 * and the AsyncIterable stream from session.stream() (for text/thinking deltas).
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
    this.pendingToolIdsByName.clear();
    this.syntheticToolCounter = 0;
    this.lastSeenOutputTokens = 0;
    this.accumulatedOutputTokens = 0;

    this.publishSessionStart(runId);

    // Get the SDK client from constructor injection first, then legacy session field fallback.
    // Note: The OpenCode SDK emits most events through the CodingAgentClient event emitter
    const client = this.client ?? (session as Session & { __client?: CodingAgentClient }).__client;
    if (client && typeof client.on === "function") {
      // Subscribe to message.delta events (backup - primarily handled in stream)
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
      if (this.abortController && !this.abortController.signal.aborted) {
        this.publishSessionError(runId, error);
      }
    } finally {
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
    this.syntheticToolCounter = 0;
    this.lastSeenOutputTokens = 0;
    this.accumulatedOutputTokens = 0;
  }
}
