import type { CodingAgentClient } from "@/services/agents/types.ts";
import type { CopilotProviderEvent } from "@/services/agents/provider-events.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import type { createTurnMetadataState } from "@/services/events/adapters/task-turn-normalization.ts";
import type { WorkflowRuntimeFeatureFlags } from "@/services/workflows/runtime-contracts.ts";

export interface CopilotSyntheticForegroundAgent {
  id: string;
  name: string;
  task: string;
  started: boolean;
  completed: boolean;
  sawNativeSubagentStart: boolean;
}

export interface CopilotTaskToolMetadata {
  description: string;
  isBackground: boolean;
  agentType?: string;
}

export type CopilotEarlyToolEvent =
  | {
      phase: "start";
      toolId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      sdkCorrelationId: string;
    }
  | {
      phase: "complete";
      toolId: string;
      toolName: string;
      toolInput?: Record<string, unknown>;
      toolResult: unknown;
      success: boolean;
      error?: string;
      sdkCorrelationId: string;
    };

export interface CopilotActiveSubagentToolContext {
  parentAgentId: string;
  toolName: string;
}

export interface CopilotThinkingStreamState {
  startTime: number;
  sourceKey: string;
  agentId?: string;
}

export interface CopilotStreamAdapterState {
  unsubscribers: Array<() => void>;
  eventBuffer: BusEvent[];
  eventBufferHead: number;
  isProcessing: boolean;
  sessionId: string;
  runId: number;
  messageId: string;
  isActive: boolean;
  toolNameById: Map<string, string>;
  subagentTracker: SubagentToolTracker | null;
  emittedToolStartIds: Set<string>;
  syntheticForegroundAgent: CopilotSyntheticForegroundAgent | null;
  taskToolMetadata: Map<string, CopilotTaskToolMetadata>;
  earlyToolEvents: Map<string, CopilotEarlyToolEvent[]>;
  activeSubagentToolsById: Map<string, CopilotActiveSubagentToolContext>;
  knownAgentNames: Set<string>;
  toolCallIdToSubagentId: Map<string, string>;
  innerToolCallIds: Set<string>;
  suppressedNestedAgentIds: Set<string>;
  thinkingStreams: Map<string, CopilotThinkingStreamState>;
  accumulatedText: string;
  accumulatedOutputTokens: number;
  runtimeFeatureFlags: WorkflowRuntimeFeatureFlags;
  turnMetadataState: ReturnType<typeof createTurnMetadataState>;
}

export interface CopilotStreamAdapterDeps {
  bus: EventBus;
  client: CodingAgentClient;
}

export interface CopilotSessionHandlerContext {
  sessionId: string;
  runId: number;
  messageId: string;
  accumulatedText: string;
  accumulatedOutputTokens: number;
  thinkingStreams: Map<string, CopilotThinkingStreamState>;
  activeSubagentToolsById: Map<string, CopilotActiveSubagentToolContext>;
  subagentTracker: SubagentToolTracker | null;
  syntheticForegroundAgent: CopilotSyntheticForegroundAgent | null;
  turnMetadataState: ReturnType<typeof createTurnMetadataState>;
  publishEvent: (event: BusEvent) => void;
  resolveParentAgentId: (
    rawParentToolCallId: string | undefined,
  ) => string | undefined;
  updateAccumulatedOutputTokens: (value: number) => void;
}

export interface CopilotProviderHandlerDeps {
  publishEvent: (event: BusEvent) => void;
  resolveParentAgentId: (
    rawParentToolCallId: string | undefined,
  ) => string | undefined;
  getSyntheticForegroundAgentIdForAttribution: () => string | undefined;
  publishSyntheticTaskToolComplete: (
    toolCallId: string,
    completion: { success: boolean; result?: unknown; error?: string },
  ) => void;
}

export interface CopilotProviderEventEnvelope<
  TType extends CopilotProviderEvent["type"] = CopilotProviderEvent["type"],
> {
  type: TType;
  sessionId: string;
  timestamp: number;
  data: Extract<CopilotProviderEvent, { type: TType }>["data"];
  nativeParentEventId?: string;
}
