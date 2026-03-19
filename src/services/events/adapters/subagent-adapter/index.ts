import type { EventBus } from "@/services/events/event-bus.ts";
import type { AgentMessage } from "@/services/agents/types.ts";
import type { SubagentStreamResult } from "@/services/workflows/graph/types.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import { pipelineLog, pipelineError } from "@/services/events/pipeline-logger.ts";
import {
  buildSubagentStreamResult,
  finalizeSubagentThinking,
  processSubagentChunk,
  publishSubagentAgentStart,
  publishSubagentSessionError,
  publishSubagentTextComplete,
  resetSubagentStreamState,
} from "./handlers.ts";
import type { SubagentStreamAdapterState } from "./types.ts";

export interface SubagentStreamAdapterOptions {
  bus: EventBus;
  sessionId: string;
  agentId: string;
  parentAgentId?: string;
  runId: number;
  agentType?: string;
  task?: string;
  isBackground?: boolean;
}

export class SubagentStreamAdapter {
  private readonly state: SubagentStreamAdapterState;

  constructor(options: SubagentStreamAdapterOptions) {
    const toolTracker = new SubagentToolTracker(
      options.bus,
      options.sessionId,
      options.runId,
    );
    toolTracker.registerAgent(options.agentId, {
      isBackground: options.isBackground,
    });

    this.state = {
      bus: options.bus,
      sessionId: options.sessionId,
      agentId: options.agentId,
      runId: options.runId,
      agentType: options.agentType,
      task: options.task,
      isBackground: options.isBackground ?? false,
      toolTracker,
      textAccumulator: "",
      toolUseCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      tokenUsageByAgent: new Map<string, { inputTokens: number; outputTokens: number }>(),
      thinkingDurationMs: 0,
      thinkingStartTimes: new Map<string, number>(),
      toolDetails: [],
      toolStartTimes: new Map<string, number>(),
      toolNames: new Map<string, string>(),
      syntheticToolCounter: 0,
      messageId: `subagent-${options.agentId}`,
      agentStartPublished: false,
    };

    pipelineLog("Subagent", "adapter_init", {
      agentId: options.agentId,
      agentType: options.agentType,
      isBackground: options.isBackground,
    });

    publishSubagentAgentStart(this.state);
  }

  private publishAgentComplete(result: SubagentStreamResult): void {
    if (!this.state.agentStartPublished) return;

    this.state.bus.publish({
      type: "stream.agent.complete",
      sessionId: this.state.sessionId,
      runId: this.state.runId,
      timestamp: Date.now(),
      data: {
        agentId: this.state.agentId,
        success: result.success,
        ...(typeof result.output === "string" && result.output.length > 0
          ? { result: result.output }
          : {}),
        ...(typeof result.error === "string"
          ? { error: result.error }
          : {}),
      },
    });
  }

  async consumeStream(
    stream: AsyncIterable<AgentMessage>,
    abortSignal?: AbortSignal,
    onChunk?: () => void,
  ): Promise<SubagentStreamResult> {
    const startTime = Date.now();

    resetSubagentStreamState(this.state);
    publishSubagentAgentStart(this.state);

    pipelineLog("Subagent", "stream_start", {
      agentId: this.state.agentId,
      runId: this.state.runId,
    });

    try {
      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          break;
        }
        processSubagentChunk(this.state, chunk);
        onChunk?.();
      }

      finalizeSubagentThinking(this.state);
      publishSubagentTextComplete(this.state);

      const result = buildSubagentStreamResult(this.state, {
        startTime,
        success: !abortSignal?.aborted,
        ...(abortSignal?.aborted ? { error: "Sub-agent was aborted" } : {}),
      });

      this.publishAgentComplete(result);

      pipelineLog("Subagent", "stream_complete", {
        agentId: this.state.agentId,
        durationMs: result.durationMs,
        toolUses: result.toolUses,
        aborted: abortSignal?.aborted ?? false,
      });

      return result;
    } catch (error) {
      finalizeSubagentThinking(this.state);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      pipelineError("Subagent", "stream_error", {
        agentId: this.state.agentId,
        error: errorMessage,
      });

      publishSubagentSessionError(this.state, errorMessage);
      publishSubagentTextComplete(this.state);
      const result = buildSubagentStreamResult(this.state, {
        startTime,
        success: false,
        error: errorMessage,
      });

      this.publishAgentComplete(result);

      return result;
    }
  }
}
