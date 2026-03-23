import type { CodingAgentClient } from "@/services/agents/types.ts";
import type { CopilotProviderEvent } from "@/services/agents/provider-events.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
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

export interface CopilotBufferedTextDelta {
  delta: string;
  agentId: string | undefined;
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
  isBackgroundOnly: boolean;
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
  pendingIdleReason: string | null;
  runtimeFeatureFlags: WorkflowRuntimeFeatureFlags;
  turnMetadataState: ReturnType<typeof createTurnMetadataState>;
  /**
   * Per-agent text delta buffer for correct reasoning-before-text ordering.
   * Keyed by agent key ("__foreground__" for root, or agentId).
   *
   * When the first text delta arrives before we know whether reasoning will
   * happen, we buffer it. Once reasoning arrives (or a second text delta
   * confirms no reasoning), we flush the buffer. This ensures reasoning
   * parts get earlier IDs than text parts — matching OpenCode's pure
   * ID-based ordering methodology.
   */
  pendingTextDeltas: Map<string, CopilotBufferedTextDelta[]>;
  /**
   * Agents for which content type has been resolved: either thinking was
   * seen (so reasoning already has an earlier ID) or confirmed absent
   * (two consecutive text deltas without thinking).
   */
  contentTypeResolvedAgents: Set<string>;
  /**
   * Resolve callback for the background-agent completion promise.
   * Set by `startCopilotStreaming` when background agents remain after the
   * foreground stream ends; called by `handleCopilotSubagentComplete` when
   * the last background agent finishes. This keeps `startCopilotStreaming`
   * alive until all background work is done, preventing the controller's
   * `adapter.dispose()` from tearing down subscriptions prematurely.
   */
  backgroundCompletionResolve: (() => void) | null;
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
  updatePendingIdleReason: (reason: string | null) => void;
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
