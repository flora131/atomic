import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  AgentMessage,
  EventHandler,
  ReasoningCompleteEventData,
  ReasoningDeltaEventData,
} from "@/services/agents/types.ts";

type OpenCodeThinkingBlock = {
  startTime: number;
  sourceKey: string;
  eventSessionId: string;
  agentId?: string;
};

type OpenCodeStreamChunkProcessorDependencies = {
  bus: EventBus;
  sessionId: string;
  getAbortSignal: () => AbortSignal | undefined;
  getTextAccumulator: () => string;
  setTextAccumulator: (value: string) => void;
  thinkingBlocks: Map<string, OpenCodeThinkingBlock>;
  ensureThinkingBlock: (
    sourceKey: string,
    eventSessionId: string,
    agentId: string | undefined,
  ) => void;
  getThinkingBlockKey: (
    sourceKey: string,
    eventSessionId: string,
    agentId: string | undefined,
  ) => string | undefined;
  publishTextComplete: (runId: number, messageId: string) => void;
  asRecord: (value: unknown) => Record<string, unknown> | undefined;
  asString: (value: unknown) => string | undefined;
  normalizeToolName: (value: unknown) => string;
  resolveToolStartId: (
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ) => string;
  resolveToolCompleteId: (
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ) => string;
  removeActiveSubagentToolContext: (
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
};

export class OpenCodeStreamChunkProcessor {
  constructor(private readonly deps: OpenCodeStreamChunkProcessorDependencies) {}

  createReasoningDeltaHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"reasoning.delta"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as ReasoningDeltaEventData;
      if (this.deps.getAbortSignal()?.aborted) return;
      if (!data.delta || data.delta.length === 0) return;
      const sourceKey = data.reasoningId || "reasoning";
      this.deps.ensureThinkingBlock(sourceKey, event.sessionId, undefined);

      this.deps.bus.publish({
        type: "stream.thinking.delta",
        sessionId: this.deps.sessionId,
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

  createReasoningCompleteHandler(
    runId: number,
  ): EventHandler<"reasoning.complete"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as ReasoningCompleteEventData;
      if (this.deps.getAbortSignal()?.aborted) return;
      const sourceKey = data.reasoningId || "reasoning";
      const thinkingKey = this.deps.getThinkingBlockKey(sourceKey, event.sessionId, undefined);
      const start = thinkingKey ? this.deps.thinkingBlocks.get(thinkingKey)?.startTime : undefined;
      const durationMs = start ? Date.now() - start : 0;
      if (thinkingKey) {
        this.deps.thinkingBlocks.delete(thinkingKey);
      }

      this.deps.bus.publish({
        type: "stream.thinking.complete",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          sourceKey,
          durationMs,
        },
      });
    };
  }

  createMessageDeltaHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"message.delta"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      if (this.deps.getAbortSignal()?.aborted) return;

      const { delta, contentType, thinkingSourceKey } = event.data;
      const normalizedContentType = typeof contentType === "string"
        ? contentType.trim().toLowerCase()
        : "";

      if (!delta || delta.length === 0) return;

      if (normalizedContentType === "thinking" || normalizedContentType === "reasoning") {
        const sourceKey = thinkingSourceKey ?? "default";
        this.deps.ensureThinkingBlock(sourceKey, event.sessionId, undefined);

        const busEvent: BusEvent<"stream.thinking.delta"> = {
          type: "stream.thinking.delta",
          sessionId: this.deps.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            delta,
            sourceKey,
            messageId,
          },
        };
        this.deps.bus.publish(busEvent);
        return;
      }

      this.deps.setTextAccumulator(this.deps.getTextAccumulator() + delta);

      const busEvent: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          delta,
          messageId,
        },
      };
      this.deps.bus.publish(busEvent);
    };
  }

  createMessageCompleteHandler(
    runId: number,
    messageId: string,
    publishThinkingCompleteForScope: (
      runId: number,
      eventSessionId: string,
      agentId: string | undefined,
    ) => void,
  ): EventHandler<"message.complete"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;

      publishThinkingCompleteForScope(runId, event.sessionId, undefined);

      if (this.deps.getTextAccumulator().length > 0) {
        this.deps.publishTextComplete(runId, messageId);
      }
    };
  }

  process(
    chunk: AgentMessage,
    runId: number,
    messageId: string,
  ): void {
    if (chunk.type === "text" && typeof chunk.content === "string") {
      this.processTextChunk(
        chunk as AgentMessage & { type: "text"; content: string },
        runId,
        messageId,
      );
      return;
    }

    if (chunk.type === "thinking") {
      this.processThinkingChunk(chunk, runId, messageId);
      return;
    }

    if (chunk.type === "tool_use") {
      this.processToolUseChunk(chunk, runId);
      return;
    }

    if (chunk.type === "tool_result") {
      this.processToolResultChunk(chunk, runId);
    }
  }

  private processTextChunk(
    chunk: AgentMessage & { type: "text"; content: string },
    runId: number,
    messageId: string,
  ): void {
    const delta = chunk.content;
    this.deps.setTextAccumulator(this.deps.getTextAccumulator() + delta);

    if (delta.length === 0) {
      return;
    }

    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        delta,
        messageId,
      },
    };
    this.deps.bus.publish(event);
  }

  private processThinkingChunk(
    chunk: AgentMessage,
    runId: number,
    messageId: string,
  ): void {
    const metadata = chunk.metadata;
    const thinkingSourceKey = metadata?.thinkingSourceKey as string | undefined;
    const sourceKey = thinkingSourceKey ?? "default";

    if (typeof chunk.content === "string" && chunk.content.length > 0) {
      this.deps.ensureThinkingBlock(sourceKey, this.deps.sessionId, undefined);

      const event: BusEvent<"stream.thinking.delta"> = {
        type: "stream.thinking.delta",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          delta: chunk.content,
          sourceKey,
          messageId,
        },
      };
      this.deps.bus.publish(event);
    }

    const streamingStats = metadata?.streamingStats as
      | { thinkingMs?: number; outputTokens?: number }
      | undefined;
    if (streamingStats?.thinkingMs === undefined) {
      return;
    }

    const durationMs = streamingStats.thinkingMs;
    const thinkingKey = this.deps.getThinkingBlockKey(sourceKey, this.deps.sessionId, undefined);
    const event: BusEvent<"stream.thinking.complete"> = {
      type: "stream.thinking.complete",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        sourceKey,
        durationMs,
      },
    };

    this.deps.bus.publish(event);
    if (thinkingKey) {
      this.deps.thinkingBlocks.delete(thinkingKey);
    }
  }

  private processToolUseChunk(
    chunk: AgentMessage,
    runId: number,
  ): void {
    const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
    const content = (chunk.content ?? {}) as Record<string, unknown>;
    const toolCalls = Array.isArray(content.toolCalls)
      ? content.toolCalls as Record<string, unknown>[]
      : [content];

    for (const toolCall of toolCalls) {
      const toolName = this.deps.normalizeToolName(toolCall.name ?? metadata.toolName);
      const input = this.deps.asRecord(toolCall.input) ?? {};
      const explicitToolId = this.deps.asString(
        toolCall.toolUseId
          ?? toolCall.toolUseID
          ?? toolCall.id
          ?? metadata.toolId
          ?? metadata.toolUseId
          ?? metadata.toolUseID
          ?? metadata.toolCallId,
      );
      const toolId = this.deps.resolveToolStartId(explicitToolId, runId, toolName);
      const sdkCorrelationId = explicitToolId ?? toolId;

      const event: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolInput: input,
          sdkCorrelationId,
        },
      };
      this.deps.bus.publish(event);
    }
  }

  private processToolResultChunk(
    chunk: AgentMessage,
    runId: number,
  ): void {
    const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
    const toolName = this.deps.normalizeToolName(metadata.toolName);
    const explicitToolId = this.deps.asString(
      metadata.toolId
        ?? metadata.toolUseId
        ?? metadata.toolUseID
        ?? metadata.toolCallId,
    );
    const toolId = this.deps.resolveToolCompleteId(explicitToolId, runId, toolName);
    const rawContent = chunk.content;
    const contentRecord = this.deps.asRecord(rawContent);
    const isError = metadata.error === true
      || (typeof rawContent === "object" && rawContent !== null && "error" in rawContent);
    const errorValue = contentRecord?.error;
    const error = isError
      ? (typeof errorValue === "string" ? errorValue : "Tool execution failed")
      : undefined;
    this.deps.removeActiveSubagentToolContext(toolId, explicitToolId);

    const event: BusEvent<"stream.tool.complete"> = {
      type: "stream.tool.complete",
      sessionId: this.deps.sessionId,
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
    this.deps.bus.publish(event);
  }
}
