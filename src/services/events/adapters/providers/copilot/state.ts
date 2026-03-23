import { createTurnMetadataState } from "@/services/events/adapters/task-turn-normalization.ts";
import { resetCopilotRuntimeFeatureFlags } from "@/services/events/adapters/providers/copilot/support.ts";
import type { CopilotStreamAdapterState } from "@/services/events/adapters/providers/copilot/types.ts";

export function createCopilotStreamAdapterState(): CopilotStreamAdapterState {
  return {
    unsubscribers: [],
    eventBuffer: [],
    eventBufferHead: 0,
    isProcessing: false,
    sessionId: "",
    runId: 0,
    messageId: "",
    isActive: false,
    isBackgroundOnly: false,
    toolNameById: new Map<string, string>(),
    subagentTracker: null,
    emittedToolStartIds: new Set<string>(),
    syntheticForegroundAgent: null,
    taskToolMetadata: new Map(),
    earlyToolEvents: new Map(),
    activeSubagentToolsById: new Map(),
    knownAgentNames: new Set<string>(),
    toolCallIdToSubagentId: new Map(),
    innerToolCallIds: new Set(),
    suppressedNestedAgentIds: new Set(),
    thinkingStreams: new Map(),
    accumulatedText: "",
    accumulatedOutputTokens: 0,
    pendingIdleReason: null,
    runtimeFeatureFlags: resetCopilotRuntimeFeatureFlags(),
    turnMetadataState: createTurnMetadataState(),
    pendingTextDeltas: new Map(),
    contentTypeResolvedAgents: new Set(),
    backgroundCompletionResolve: null,
  };
}
