import type {
  AgentEvent,
  SubagentCompleteEventData,
  SubagentStartEventData,
  SubagentUpdateEventData,
} from "@/services/agents/types.ts";
import { normalizeAgentTaskMetadata } from "@/services/events/adapters/task-turn-normalization.ts";
import {
  promoteSyntheticForegroundAgentIdentity,
  recordCopilotActiveSubagentToolContext,
  removeCopilotActiveSubagentToolContext,
} from "@/services/events/adapters/providers/copilot/support.ts";
import type {
  CopilotEarlyToolEvent,
  CopilotProviderHandlerDeps,
  CopilotStreamAdapterState,
} from "@/services/events/adapters/providers/copilot/types.ts";

export function queueCopilotEarlyToolEvent(
  state: CopilotStreamAdapterState,
  key: string,
  event: CopilotEarlyToolEvent,
): void {
  const queue = state.earlyToolEvents.get(key) ?? [];
  if (
    queue.some(entry => entry.phase === event.phase && entry.toolId === event.toolId)
  ) {
    return;
  }
  queue.push(event);
  state.earlyToolEvents.set(key, queue);
}

export function replayCopilotEarlyToolEvent(
  state: CopilotStreamAdapterState,
  deps: Pick<CopilotProviderHandlerDeps, "publishEvent">,
  parentAgentId: string,
  event: CopilotEarlyToolEvent,
): void {
  if (event.phase === "start") {
    recordCopilotActiveSubagentToolContext(
      state.activeSubagentToolsById,
      event.toolId,
      event.toolName,
      parentAgentId,
      event.sdkCorrelationId,
    );
    state.innerToolCallIds.add(event.toolId);
    state.subagentTracker?.onToolStart(parentAgentId, event.toolName);
    deps.publishEvent({
      type: "stream.tool.start",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        toolId: event.toolId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        sdkCorrelationId: event.sdkCorrelationId,
        parentAgentId,
      },
    });
    return;
  }

  removeCopilotActiveSubagentToolContext(
    state.activeSubagentToolsById,
    event.toolId,
    event.sdkCorrelationId,
  );
  state.subagentTracker?.onToolComplete(parentAgentId);
  deps.publishEvent({
    type: "stream.tool.complete",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      toolId: event.toolId,
      toolName: event.toolName,
      ...(event.toolInput ? { toolInput: event.toolInput } : {}),
      toolResult: event.toolResult,
      success: event.success,
      ...(event.error ? { error: event.error } : {}),
      sdkCorrelationId: event.sdkCorrelationId,
      parentAgentId,
    },
  });
}

export function handleCopilotSubagentStart(
  state: CopilotStreamAdapterState,
  deps: Pick<CopilotProviderHandlerDeps, "publishEvent">,
  event: AgentEvent<"subagent.start">,
): void {
  const data = event.data as SubagentStartEventData;
  const toolCallId = data.toolCallId ?? data.subagentId;

  if (state.innerToolCallIds.has(toolCallId)) {
    state.suppressedNestedAgentIds.add(data.subagentId);
    state.suppressedNestedAgentIds.add(toolCallId);
    state.earlyToolEvents.delete(data.subagentId);
    state.earlyToolEvents.delete(toolCallId);
    return;
  }

  const metadata = state.taskToolMetadata.get(toolCallId);
  const normalizedMetadata = normalizeAgentTaskMetadata({
    task: metadata?.description ?? data.task,
    agentType: data.subagentType,
    isBackground: metadata?.isBackground,
  });

  state.subagentTracker?.registerAgent(data.subagentId);
  promoteSyntheticForegroundAgentIdentity({
    syntheticForegroundAgent: state.syntheticForegroundAgent,
    subagentTracker: state.subagentTracker,
    activeSubagentToolsById: state.activeSubagentToolsById,
    earlyToolEvents: state.earlyToolEvents as Map<string, unknown[]>,
    realAgentId: data.subagentId,
  });
  state.toolCallIdToSubagentId.set(toolCallId, data.subagentId);

  deps.publishEvent({
    type: "stream.agent.start",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      agentId: data.subagentId,
      toolCallId,
      agentType: data.subagentType ?? "unknown",
      task: normalizedMetadata.task,
      isBackground: normalizedMetadata.isBackground,
      sdkCorrelationId: toolCallId,
    },
  });

  for (const key of [data.subagentId, toolCallId]) {
    const earlyTools = state.earlyToolEvents.get(key);
    if (!earlyTools) {
      continue;
    }
    for (const earlyTool of earlyTools) {
      replayCopilotEarlyToolEvent(state, deps, data.subagentId, earlyTool);
    }
    state.earlyToolEvents.delete(key);
  }
}

export function handleCopilotSubagentComplete(
  state: CopilotStreamAdapterState,
  deps: CopilotProviderHandlerDeps,
  event: AgentEvent<"subagent.complete">,
): void {
  const data = event.data as SubagentCompleteEventData;
  const dataRecord = data as Record<string, unknown>;
  const error = typeof dataRecord.error === "string" ? dataRecord.error : undefined;

  if (state.suppressedNestedAgentIds.has(data.subagentId)) {
    state.suppressedNestedAgentIds.delete(data.subagentId);
    state.earlyToolEvents.delete(data.subagentId);
    return;
  }

  const taskToolCallId = resolveTaskToolCallIdForSubagent(state, data.subagentId);
  if (taskToolCallId) {
    deps.publishSyntheticTaskToolComplete(taskToolCallId, {
      success: data.success,
      result: data.result,
      error,
    });
  }

  state.suppressedNestedAgentIds.delete(data.subagentId);
  state.subagentTracker?.removeAgent(data.subagentId);
  state.taskToolMetadata.delete(taskToolCallId ?? data.subagentId);
  state.earlyToolEvents.delete(data.subagentId);
  if (taskToolCallId && taskToolCallId !== data.subagentId) {
    state.earlyToolEvents.delete(taskToolCallId);
    state.toolCallIdToSubagentId.delete(taskToolCallId);
  } else {
    for (const [toolCallId, agentId] of state.toolCallIdToSubagentId) {
      if (agentId === data.subagentId) {
        state.toolCallIdToSubagentId.delete(toolCallId);
        break;
      }
    }
  }

  deps.publishEvent({
    type: "stream.agent.complete",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      agentId: data.subagentId,
      success: data.success,
      result: typeof data.result === "string" ? data.result : undefined,
      error,
    },
  });
}

export function handleCopilotSubagentUpdate(
  state: CopilotStreamAdapterState,
  deps: Pick<CopilotProviderHandlerDeps, "publishEvent">,
  event: AgentEvent<"subagent.update">,
): void {
  const data = event.data as SubagentUpdateEventData;
  if (state.suppressedNestedAgentIds.has(data.subagentId)) {
    return;
  }

  deps.publishEvent({
    type: "stream.agent.update",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      agentId: data.subagentId,
      currentTool: data.currentTool,
      toolUses: data.toolUses,
    },
  });
}

function resolveTaskToolCallIdForSubagent(
  state: CopilotStreamAdapterState,
  subagentId: string,
): string | undefined {
  if (state.toolNameById.has(subagentId)) {
    return subagentId;
  }

  for (const [toolCallId, agentId] of state.toolCallIdToSubagentId) {
    if (agentId === subagentId && state.toolNameById.has(toolCallId)) {
      return toolCallId;
    }
  }

  return undefined;
}
