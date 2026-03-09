import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  SubagentStreamResult,
  SubagentToolDetail,
} from "@/services/workflows/graph/types.ts";
import type { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";

export interface SubagentStreamAdapterState {
  bus: EventBus;
  sessionId: string;
  agentId: string;
  runId: number;
  agentType?: string;
  task?: string;
  isBackground: boolean;
  toolTracker: SubagentToolTracker;
  textAccumulator: string;
  toolUseCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
  thinkingDurationMs: number;
  thinkingStartTimes: Map<string, number>;
  toolDetails: SubagentToolDetail[];
  toolStartTimes: Map<string, number>;
  toolNames: Map<string, string>;
  syntheticToolCounter: number;
  messageId: string;
  agentStartPublished: boolean;
}

export interface SubagentConsumeResultOptions {
  startTime: number;
  success: boolean;
  error?: string;
}

export type BuildSubagentStreamResult = (
  options: SubagentConsumeResultOptions,
) => SubagentStreamResult;
