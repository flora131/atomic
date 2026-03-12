import type { BusEvent } from "@/services/events/bus-events.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  ClaudeActiveSubagentToolContext,
  ClaudeSyntheticForegroundAgent,
} from "@/services/events/adapters/providers/claude/tool-state.ts";
import type { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";

export function publishClaudeSyntheticAgentStart(args: {
  bus: EventBus;
  runId: number;
  sessionId: string;
  subagentTracker: SubagentToolTracker | null;
  syntheticAgent: ClaudeSyntheticForegroundAgent;
}): void {
  const { bus, runId, sessionId, subagentTracker, syntheticAgent } = args;
  if (syntheticAgent.started || syntheticAgent.sawNativeSubagentStart) {
    return;
  }
  syntheticAgent.started = true;
  subagentTracker?.registerAgent(syntheticAgent.id);
  bus.publish({
    type: "stream.agent.start",
    sessionId,
    runId,
    timestamp: Date.now(),
    data: {
      agentId: syntheticAgent.id,
      toolCallId: syntheticAgent.id,
      agentType: syntheticAgent.name,
      task: syntheticAgent.task,
      isBackground: false,
      sdkCorrelationId: syntheticAgent.id,
    },
  });
}

export function publishClaudeSyntheticAgentComplete(args: {
  bus: EventBus;
  error?: string;
  getTextAccumulator: () => string;
  runId: number;
  sessionId: string;
  subagentTracker: SubagentToolTracker | null;
  success: boolean;
  syntheticAgent: ClaudeSyntheticForegroundAgent;
}): void {
  const {
    bus,
    error,
    getTextAccumulator,
    runId,
    sessionId,
    subagentTracker,
    success,
    syntheticAgent,
  } = args;
  if (!syntheticAgent.started || syntheticAgent.completed) {
    return;
  }
  syntheticAgent.completed = true;
  subagentTracker?.removeAgent(syntheticAgent.id);
  bus.publish({
    type: "stream.agent.complete",
    sessionId,
    runId,
    timestamp: Date.now(),
    data: {
      agentId: syntheticAgent.id,
      success,
      result: success ? getTextAccumulator() : undefined,
      ...(error ? { error } : {}),
    },
  });
}

export function cleanupClaudeOrphanedTools(args: {
  activeSubagentIds: Set<string>;
  activeSubagentToolsById: Map<string, ClaudeActiveSubagentToolContext>;
  activeSubagentBackgroundById: Map<string, boolean>;
  bus: EventBus;
  currentBackgroundAttributionAgentId: string | null;
  nativeSubagentIdToAgentId: Map<string, string>;
  pendingToolIdsByName: Map<string, string[]>;
  removeActiveSubagentToolContext: (toolId: string, ...correlationIds: Array<string | undefined>) => void;
  resolveActiveSubagentToolContext: (...correlationIds: Array<string | undefined>) => ClaudeActiveSubagentToolContext | undefined;
  runId: number;
  sessionId: string;
  subagentSessionToAgentId: Map<string, string>;
}): string | null {
  const {
    activeSubagentIds,
    activeSubagentToolsById,
    activeSubagentBackgroundById,
    bus,
    nativeSubagentIdToAgentId,
    pendingToolIdsByName,
    removeActiveSubagentToolContext,
    resolveActiveSubagentToolContext,
    runId,
    sessionId,
    subagentSessionToAgentId,
  } = args;

  for (const [toolName, toolIds] of pendingToolIdsByName.entries()) {
    for (const toolId of toolIds) {
      const context = resolveActiveSubagentToolContext(toolId);
      const event: BusEvent<"stream.tool.complete"> = {
        type: "stream.tool.complete",
        sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolResult: null,
          success: false,
          error: "Tool execution aborted",
          ...(context ? { parentAgentId: context.parentAgentId } : {}),
        },
      };
      bus.publish(event);
      removeActiveSubagentToolContext(toolId);
    }
  }

  pendingToolIdsByName.clear();
  activeSubagentIds.clear();
  activeSubagentBackgroundById.clear();
  activeSubagentToolsById.clear();
  subagentSessionToAgentId.clear();
  nativeSubagentIdToAgentId.clear();
  return null;
}
