/**
 * Sub-Agent Stream Adapter
 *
 * Lightweight adapter that bridges a sub-agent's SDK session stream to the
 * shared event bus. Unlike the main SDK adapters (which handle full session
 * lifecycle), this adapter is scoped to a single sub-agent execution.
 *
 * Each sub-agent session gets its own adapter instance. The adapter:
 * - Iterates the SDK AsyncIterable stream
 * - Maps AgentMessage types to normalized BusEvents
 * - Publishes events with the PARENT session's sessionId
 * - Tracks agentId in event data for CorrelationService attribution
 * - Accumulates full text output, token usage, thinking duration, tool details
 * - Returns a SubagentStreamResult on completion
 *
 * Event mapping:
 * - AgentMessage (type: "text")        -> stream.text.delta
 * - AgentMessage (type: "thinking")    -> stream.thinking.delta
 * - AgentMessage (type: "tool_use")    -> stream.tool.start
 * - AgentMessage (type: "tool_result") -> stream.tool.complete
 * - stream completion                  -> stream.text.complete
 */

import type { AtomicEventBus } from "../event-bus.ts";
import type { BusEvent } from "../bus-events.ts";
import type { AgentMessage } from "../../sdk/types.ts";
import type {
  SubagentStreamResult,
  SubagentToolDetail,
} from "../../workflows/graph/types.ts";
import { SubagentToolTracker } from "./subagent-tool-tracker.ts";

/**
 * Options for creating a SubagentStreamAdapter.
 */
export interface SubagentStreamAdapterOptions {
  /** The event bus to publish events to */
  bus: AtomicEventBus;
  /** Parent session ID — events are published with this sessionId */
  sessionId: string;
  /** Sub-agent ID for correlation and attribution */
  agentId: string;
  /** Parent agent ID (for nested agents) */
  parentAgentId?: string;
  /** Workflow run ID for staleness detection (monotonically increasing) */
  runId: number;
}

/**
 * Stream adapter for sub-agent SDK sessions.
 *
 * Consumes an AsyncIterable<AgentMessage> stream from any SDK session and
 * publishes normalized BusEvents to the shared event bus. Returns a
 * SubagentStreamResult containing full streaming metadata.
 */
export class SubagentStreamAdapter {
  private readonly bus: AtomicEventBus;
  private readonly sessionId: string;
  private readonly agentId: string;
  private readonly parentAgentId: string | undefined;
  private readonly runId: number;
  private readonly toolTracker: SubagentToolTracker;

  /** Accumulated text output from the sub-agent */
  private textAccumulator = "";
  /** Number of tool invocations */
  private toolUseCount = 0;
  /** Token usage tracking */
  private tokenUsage: { inputTokens: number; outputTokens: number } = {
    inputTokens: 0,
    outputTokens: 0,
  };
  /** Total thinking duration in milliseconds */
  private thinkingDurationMs = 0;
  /** Tracks thinking source start times for duration computation */
  private thinkingStartTimes = new Map<string, number>();
  /** Per-tool invocation details */
  private toolDetails: SubagentToolDetail[] = [];
  /** Maps toolId -> start time for duration computation */
  private toolStartTimes = new Map<string, number>();
  /** Maps toolId -> toolName for correlation on completion */
  private toolNames = new Map<string, string>();
  /** Counter for generating synthetic tool IDs */
  private syntheticToolCounter = 0;
  /** Monotonic message ID derived from agentId */
  private readonly messageId: string;

  constructor(options: SubagentStreamAdapterOptions) {
    this.bus = options.bus;
    this.sessionId = options.sessionId;
    this.agentId = options.agentId;
    this.parentAgentId = options.parentAgentId;
    this.runId = options.runId;
    this.messageId = `subagent-${options.agentId}`;
    this.toolTracker = new SubagentToolTracker(options.bus, options.sessionId, options.runId);
    this.toolTracker.registerAgent(options.agentId);
  }

  /**
   * Consume an SDK session stream, publishing normalized events to the bus.
   *
   * For each AgentMessage in the stream:
   * - text        -> stream.text.delta (accumulates full text)
   * - thinking    -> stream.thinking.delta (tracks thinking duration)
   * - tool_use    -> stream.tool.start (increments toolUses)
   * - tool_result -> stream.tool.complete (records tool detail)
   *
   * On completion, publishes stream.text.complete and returns SubagentStreamResult.
   *
   * @param stream - AsyncIterable of AgentMessage from an SDK session
   * @param abortSignal - Optional signal to cancel stream consumption
   * @returns SubagentStreamResult with full streaming metadata
   */
  async consumeStream(
    stream: AsyncIterable<AgentMessage>,
    abortSignal?: AbortSignal,
  ): Promise<SubagentStreamResult> {
    const startTime = Date.now();

    this.reset();

    try {
      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          break;
        }

        this.processChunk(chunk);
      }

      // Finalize any open thinking blocks
      this.finalizeThinking();

      // Publish stream completion
      if (abortSignal?.aborted) {
        this.publishTextComplete();
        return this.buildResult(startTime, false, "Sub-agent was aborted");
      }

      this.publishTextComplete();
      return this.buildResult(startTime, true);
    } catch (error) {
      // Finalize any open thinking blocks before returning
      this.finalizeThinking();

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Publish error event
      this.publishSessionError(errorMessage);

      // Publish text complete with whatever was accumulated
      this.publishTextComplete();

      return this.buildResult(startTime, false, errorMessage);
    }
  }

  /**
   * Process a single chunk from the SDK stream.
   */
  private processChunk(chunk: AgentMessage): void {
    switch (chunk.type) {
      case "text":
        this.handleText(chunk);
        break;
      case "thinking":
        this.handleThinking(chunk);
        break;
      case "tool_use":
        this.handleToolUse(chunk);
        break;
      case "tool_result":
        this.handleToolResult(chunk);
        break;
    }

    // Handle token usage from chunk metadata
    this.handleUsage(chunk);
  }

  /**
   * Handle a text delta chunk.
   */
  private handleText(chunk: AgentMessage): void {
    if (typeof chunk.content !== "string") return;

    const delta = chunk.content;
    this.textAccumulator += delta;

    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        delta,
        messageId: this.messageId,
        agentId: this.agentId,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Handle a thinking delta or thinking complete chunk.
   */
  private handleThinking(chunk: AgentMessage): void {
    const metadata = chunk.metadata;
    const thinkingSourceKey =
      (metadata?.thinkingSourceKey as string | undefined) ?? "default";

    // Thinking delta (has content)
    if (typeof chunk.content === "string" && chunk.content.length > 0) {
      // Track start time for this thinking source
      if (!this.thinkingStartTimes.has(thinkingSourceKey)) {
        this.thinkingStartTimes.set(thinkingSourceKey, Date.now());
      }

      const event: BusEvent<"stream.thinking.delta"> = {
        type: "stream.thinking.delta",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          delta: chunk.content,
          sourceKey: thinkingSourceKey,
          messageId: this.messageId,
          agentId: this.agentId,
        },
      };

      this.bus.publish(event);
    }

    // Thinking complete (has streamingStats with thinkingMs, empty content)
    const streamingStats = metadata?.streamingStats as
      | { thinkingMs?: number; outputTokens?: number }
      | undefined;
    if (streamingStats?.thinkingMs !== undefined && chunk.content === "") {
      const startTime = this.thinkingStartTimes.get(thinkingSourceKey);
      const durationMs =
        streamingStats.thinkingMs ?? (startTime ? Date.now() - startTime : 0);
      this.thinkingStartTimes.delete(thinkingSourceKey);
      this.thinkingDurationMs += durationMs;

      const event: BusEvent<"stream.thinking.complete"> = {
        type: "stream.thinking.complete",
        sessionId: this.sessionId,
        runId: this.runId,
        timestamp: Date.now(),
        data: {
          sourceKey: thinkingSourceKey,
          durationMs,
        },
      };

      this.bus.publish(event);
    }
  }

  /**
   * Handle a tool_use chunk (tool invocation started).
   */
  private handleToolUse(chunk: AgentMessage): void {
    this.toolUseCount++;

    const chunkRecord = chunk as unknown as Record<string, unknown>;
    const contentRecord = this.asRecord(chunkRecord.content) ?? {};
    const metadataRecord = this.asRecord(chunk.metadata) ?? {};

    const toolName = this.normalizeToolName(
      contentRecord.name ?? chunkRecord.name ?? metadataRecord.toolName,
    );
    const explicitToolId = this.asString(
      contentRecord.toolUseId ??
        contentRecord.toolUseID ??
        contentRecord.id ??
        chunkRecord.toolUseId ??
        chunkRecord.toolUseID ??
        chunkRecord.id ??
        metadataRecord.toolId ??
        metadataRecord.toolUseId ??
        metadataRecord.toolUseID ??
        metadataRecord.toolCallId,
    );
    const toolInput =
      this.asRecord(contentRecord.input ?? chunkRecord.input) ?? {};
    const toolId = explicitToolId ?? this.createSyntheticToolId(toolName);

    // Track for duration computation and correlation
    this.toolStartTimes.set(toolId, Date.now());
    this.toolNames.set(toolId, toolName);

    // Publish stream.agent.update with tool count and current tool
    this.toolTracker.onToolStart(this.agentId, toolName);

    const event: BusEvent<"stream.tool.start"> = {
      type: "stream.tool.start",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName,
        toolInput,
        sdkCorrelationId: explicitToolId ?? toolId,
        parentAgentId: this.agentId,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Handle a tool_result chunk (tool invocation completed).
   */
  private handleToolResult(chunk: AgentMessage): void {
    const chunkRecord = chunk as unknown as Record<string, unknown>;
    const content = chunkRecord.content;
    const metadataRecord = this.asRecord(chunk.metadata) ?? {};

    const toolName = this.normalizeToolName(
      chunkRecord.toolName ?? metadataRecord.toolName,
    );
    const explicitToolId = this.asString(
      chunkRecord.tool_use_id ??
        chunkRecord.toolUseId ??
        chunkRecord.toolUseID ??
        metadataRecord.toolId ??
        metadataRecord.toolUseId ??
        metadataRecord.toolUseID ??
        metadataRecord.toolCallId,
    );

    // Resolve toolId: use explicit ID, or fall back to matching by name
    const toolId = explicitToolId ?? this.resolveToolCompleteId(toolName);

    const contentRecord = this.asRecord(content);
    const isError =
      chunkRecord.is_error === true ||
      (typeof content === "object" && content !== null && "error" in content);
    const errorValue = contentRecord?.error;

    // Compute tool duration
    const startTime = this.toolStartTimes.get(toolId);
    const durationMs = startTime ? Date.now() - startTime : 0;
    this.toolStartTimes.delete(toolId);

    // Record tool detail
    const resolvedToolName = this.toolNames.get(toolId) ?? toolName;
    this.toolNames.delete(toolId);

    this.toolDetails.push({
      toolId,
      toolName: resolvedToolName,
      durationMs,
      success: !isError,
    });

    // Publish stream.agent.update clearing current tool
    this.toolTracker.onToolComplete(this.agentId);

    const event: BusEvent<"stream.tool.complete"> = {
      type: "stream.tool.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName: resolvedToolName,
        toolResult: content,
        success: !isError,
        error: isError
          ? typeof errorValue === "string"
            ? errorValue
            : String(content)
          : undefined,
        sdkCorrelationId: explicitToolId ?? toolId,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Handle token usage from chunk metadata.
   */
  private handleUsage(chunk: AgentMessage): void {
    const tokenUsage = chunk.metadata?.tokenUsage as
      | { inputTokens?: number; outputTokens?: number }
      | undefined;
    if (!tokenUsage) return;

    const inputTokens = tokenUsage.inputTokens ?? 0;
    const outputTokens = tokenUsage.outputTokens ?? 0;

    if (inputTokens <= 0 && outputTokens <= 0) return;

    this.tokenUsage.inputTokens += inputTokens;
    this.tokenUsage.outputTokens += outputTokens;

    const event: BusEvent<"stream.usage"> = {
      type: "stream.usage",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        inputTokens: this.tokenUsage.inputTokens,
        outputTokens: this.tokenUsage.outputTokens,
        model: chunk.metadata?.model as string | undefined,
        agentId: this.agentId,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Publish a stream.text.complete event.
   */
  private publishTextComplete(): void {
    const event: BusEvent<"stream.text.complete"> = {
      type: "stream.text.complete",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        messageId: this.messageId,
        fullText: this.textAccumulator,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Publish a stream.session.error event.
   */
  private publishSessionError(errorMessage: string): void {
    const event: BusEvent<"stream.session.error"> = {
      type: "stream.session.error",
      sessionId: this.sessionId,
      runId: this.runId,
      timestamp: Date.now(),
      data: {
        error: errorMessage,
      },
    };

    this.bus.publish(event);
  }

  /**
   * Finalize any open thinking blocks by computing their duration
   * and accumulating into thinkingDurationMs.
   */
  private finalizeThinking(): void {
    const now = Date.now();
    for (const [, startTime] of this.thinkingStartTimes) {
      this.thinkingDurationMs += now - startTime;
    }
    this.thinkingStartTimes.clear();
  }

  /**
   * Build the SubagentStreamResult from accumulated state.
   */
  private buildResult(
    startTime: number,
    success: boolean,
    error?: string,
  ): SubagentStreamResult {
    const result: SubagentStreamResult = {
      agentId: this.agentId,
      success,
      output: this.textAccumulator,
      toolUses: this.toolUseCount,
      durationMs: Date.now() - startTime,
    };

    if (error) {
      result.error = error;
    }

    if (this.tokenUsage.inputTokens > 0 || this.tokenUsage.outputTokens > 0) {
      result.tokenUsage = { ...this.tokenUsage };
    }

    if (this.thinkingDurationMs > 0) {
      result.thinkingDurationMs = this.thinkingDurationMs;
    }

    if (this.toolDetails.length > 0) {
      result.toolDetails = [...this.toolDetails];
    }

    return result;
  }

  /**
   * Reset internal accumulation state for a fresh stream.
   */
  private reset(): void {
    this.textAccumulator = "";
    this.toolUseCount = 0;
    this.tokenUsage = { inputTokens: 0, outputTokens: 0 };
    this.thinkingDurationMs = 0;
    this.thinkingStartTimes.clear();
    this.toolDetails = [];
    this.toolStartTimes.clear();
    this.toolNames.clear();
    this.syntheticToolCounter = 0;
    this.toolTracker.removeAgent(this.agentId);
    this.toolTracker.registerAgent(this.agentId);
  }

  // ---- Utility helpers (same patterns as ClaudeStreamAdapter) ----

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

  private createSyntheticToolId(toolName: string): string {
    this.syntheticToolCounter += 1;
    const normalizedName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `tool_${this.agentId}_${normalizedName}_${this.syntheticToolCounter}`;
  }

  /**
   * Resolve tool ID for a tool_result when no explicit ID is provided.
   * Falls back to the first tracked tool with a matching name.
   */
  private resolveToolCompleteId(toolName: string): string {
    // Find the first tracked tool start with this name
    for (const [toolId, name] of this.toolNames) {
      if (name === toolName) {
        return toolId;
      }
    }
    // No match found — create a synthetic ID
    return this.createSyntheticToolId(toolName);
  }
}

