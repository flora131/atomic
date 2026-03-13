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
  toolUseIdToSubagentId: Map<string, string>;
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
    toolUseIdToSubagentId,
  } = args;

  // Sub-agent task tools are handled by flushClaudeOrphanedAgentCompletions.
  // Aborting them here would produce null toolResult values in the UI.
  const subagentToolIds = new Set(toolUseIdToSubagentId.keys());

  for (const [toolName, toolIds] of pendingToolIdsByName.entries()) {
    for (const toolId of toolIds) {
      if (subagentToolIds.has(toolId)) {
        continue;
      }
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

  // Preserve pending entries for sub-agent task tools so
  // flushClaudeOrphanedAgentCompletions can emit proper tool completions.
  for (const [toolName, toolIds] of pendingToolIdsByName.entries()) {
    const remaining = toolIds.filter(id => subagentToolIds.has(id));
    if (remaining.length > 0) {
      pendingToolIdsByName.set(toolName, remaining);
    } else {
      pendingToolIdsByName.delete(toolName);
    }
  }

  activeSubagentIds.clear();
  activeSubagentBackgroundById.clear();
  activeSubagentToolsById.clear();
  subagentSessionToAgentId.clear();
  nativeSubagentIdToAgentId.clear();
  return null;
}

/**
 * Synthesize `stream.agent.complete` and `stream.tool.complete` events for
 * background agents whose completion was never received from the Claude SDK.
 *
 * Call this in the `finally` block of `runClaudeStreamConsumer`, after
 * `cleanupOrphanedTools`.
 */
export function flushClaudeOrphanedAgentCompletions(args: {
  bus: EventBus;
  pendingToolIdsByName: Map<string, string[]>;
  runId: number;
  sessionId: string;
  subagentTracker: SubagentToolTracker | null;
  toolUseIdToSubagentId: Map<string, string>;
}): void {
  const { bus, pendingToolIdsByName, runId, sessionId, subagentTracker, toolUseIdToSubagentId } = args;

  for (const [toolId, agentId] of toolUseIdToSubagentId) {
    // Emit the tool completion that cleanupClaudeOrphanedTools skipped.
    let toolName: string | undefined;
    for (const [name, ids] of pendingToolIdsByName) {
      if (ids.includes(toolId)) {
        toolName = name;
        break;
      }
    }
    if (toolName) {
      bus.publish({
        type: "stream.tool.complete",
        sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolResult: null,
          success: true,
          sdkCorrelationId: toolId,
        },
      });
    }

    if (subagentTracker?.hasAgent(agentId)) {
      subagentTracker.removeAgent(agentId);
    }
    bus.publish({
      type: "stream.agent.complete",
      sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        agentId,
        success: true,
      },
    });
  }

  pendingToolIdsByName.clear();
  toolUseIdToSubagentId.clear();
}
