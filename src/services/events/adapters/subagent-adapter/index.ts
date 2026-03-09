import type { EventBus } from "@/services/events/event-bus.ts";
import type { AgentMessage } from "@/services/agents/types.ts";
import type { SubagentStreamResult } from "@/services/workflows/graph/types.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
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
    toolTracker.registerAgent(options.agentId);

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
      thinkingDurationMs: 0,
      thinkingStartTimes: new Map<string, number>(),
      toolDetails: [],
      toolStartTimes: new Map<string, number>(),
      toolNames: new Map<string, string>(),
      syntheticToolCounter: 0,
      messageId: `subagent-${options.agentId}`,
      agentStartPublished: false,
    };

    publishSubagentAgentStart(this.state);
  }

  async consumeStream(
    stream: AsyncIterable<AgentMessage>,
    abortSignal?: AbortSignal,
  ): Promise<SubagentStreamResult> {
    const startTime = Date.now();

    resetSubagentStreamState(this.state);
    publishSubagentAgentStart(this.state);

    try {
      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          break;
        }
        processSubagentChunk(this.state, chunk);
      }

      finalizeSubagentThinking(this.state);
      publishSubagentTextComplete(this.state);

      return buildSubagentStreamResult(this.state, {
        startTime,
        success: !abortSignal?.aborted,
        ...(abortSignal?.aborted ? { error: "Sub-agent was aborted" } : {}),
      });
    } catch (error) {
      finalizeSubagentThinking(this.state);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      publishSubagentSessionError(this.state, errorMessage);
      publishSubagentTextComplete(this.state);
      return buildSubagentStreamResult(this.state, {
        startTime,
        success: false,
        error: errorMessage,
      });
    }
  }
}
