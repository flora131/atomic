import type { AgentEvent } from "@/services/agents/types.ts";
import { isBuiltInTaskTool } from "@/services/events/adapters/provider-shared.ts";
import {
  asString,
  ensureCopilotThinkingStream,
  normalizeCopilotToolInput,
  normalizeToolName,
  recordCopilotActiveSubagentToolContext,
  removeCopilotActiveSubagentToolContext,
  resolveCopilotToolCompleteId,
  resolveCopilotToolStartId,
  storeCopilotTaskToolMetadata,
} from "@/services/events/adapters/providers/copilot/support.ts";
import { queueCopilotEarlyToolEvent } from "@/services/events/adapters/providers/copilot/subagent-handlers.ts";
import type {
  CopilotProviderHandlerDeps,
  CopilotStreamAdapterState,
} from "@/services/events/adapters/providers/copilot/types.ts";

export function handleCopilotMessageDelta(
  state: CopilotStreamAdapterState,
  deps: Pick<
    CopilotProviderHandlerDeps,
    "publishEvent" | "resolveParentAgentId" | "getSyntheticForegroundAgentIdForAttribution"
  >,
  event: AgentEvent<"message.delta">,
): void {
  const { delta, contentType, thinkingSourceKey } = event.data;
  const parentToolCallId = asString(
    (event.data as Record<string, unknown>).parentToolCallId,
  );
  const mappedAgentId = deps.resolveParentAgentId(parentToolCallId);
  const agentId =
    mappedAgentId ?? deps.getSyntheticForegroundAgentIdForAttribution();

  if (contentType === "thinking" && thinkingSourceKey) {
    ensureCopilotThinkingStream(state.thinkingStreams, thinkingSourceKey, agentId);
    deps.publishEvent({
      type: "stream.thinking.delta",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        delta,
        sourceKey: thinkingSourceKey,
        messageId: state.messageId,
        ...(agentId ? { agentId } : {}),
      },
    });
    return;
  }

  if (!agentId) {
    state.accumulatedText += delta;
  }

  if (delta.length > 0) {
    deps.publishEvent({
      type: "stream.text.delta",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        delta,
        messageId: state.messageId,
        ...(agentId ? { agentId } : {}),
      },
    });
  }
}

export function handleCopilotMessageComplete(
  state: CopilotStreamAdapterState,
  deps: Pick<
    CopilotProviderHandlerDeps,
    "publishEvent" | "resolveParentAgentId" | "getSyntheticForegroundAgentIdForAttribution"
  >,
  event: AgentEvent<"message.complete">,
): void {
  const eventData = event.data as Record<string, unknown>;
  const parentToolCallId = asString(eventData.parentToolCallId);
  const parentAgentId = deps.resolveParentAgentId(parentToolCallId);
  const completionAgentId = parentToolCallId
    ? parentAgentId
    : deps.getSyntheticForegroundAgentIdForAttribution();

  for (const [thinkingKey, stream] of state.thinkingStreams.entries()) {
    if ((stream.agentId ?? undefined) !== completionAgentId) {
      continue;
    }
    deps.publishEvent({
      type: "stream.thinking.complete",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        sourceKey: stream.sourceKey,
        durationMs: Date.now() - stream.startTime,
        ...(stream.agentId ? { agentId: stream.agentId } : {}),
      },
    });
    state.thinkingStreams.delete(thinkingKey);
  }

  const toolRequests = eventData.toolRequests;
  const hasToolRequests = Array.isArray(toolRequests) && toolRequests.length > 0;
  const syntheticParentAgentId = parentToolCallId
    ? undefined
    : deps.getSyntheticForegroundAgentIdForAttribution();

  if (hasToolRequests) {
    for (const request of toolRequests as Array<Record<string, unknown>>) {
      const toolCallId = asString(request.toolCallId);
      const toolName = normalizeToolName(request.name);
      const toolInput = normalizeCopilotToolInput(request.arguments);
      if (!toolCallId) {
        continue;
      }

      const isRootTaskTool =
        !parentToolCallId && isCopilotTaskTool(state, toolName);
      if (isRootTaskTool) {
        storeCopilotTaskToolMetadata(state.taskToolMetadata, toolCallId, toolInput);
        if (state.knownAgentNames.has(toolName.toLowerCase())) {
          const existing = state.taskToolMetadata.get(toolCallId);
          if (existing && !existing.agentType) {
            existing.agentType = toolName;
          }
        }
      }

      const bufferedParentAgentId = isRootTaskTool
        ? undefined
        : (parentAgentId ?? syntheticParentAgentId);

      state.emittedToolStartIds.add(toolCallId);
      const toolId = resolveCopilotToolStartId(
        state.toolNameById,
        toolCallId,
        toolName,
      );
      if (bufferedParentAgentId) {
        recordCopilotActiveSubagentToolContext(
          state.activeSubagentToolsById,
          toolId,
          toolName,
          bufferedParentAgentId,
          toolCallId,
        );
        if (state.subagentTracker?.hasAgent(bufferedParentAgentId)) {
          state.subagentTracker.onToolStart(bufferedParentAgentId, toolName);
        }
      } else if (parentToolCallId) {
        queueCopilotEarlyToolEvent(state, parentToolCallId, {
          phase: "start",
          toolId,
          toolName,
          toolInput,
          sdkCorrelationId: toolCallId,
        });
        continue;
      }

      deps.publishEvent({
        type: "stream.tool.start",
        sessionId: state.sessionId,
        runId: state.runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolInput,
          sdkCorrelationId: toolCallId,
          ...(bufferedParentAgentId
            ? { parentAgentId: bufferedParentAgentId }
            : {}),
        },
      });
    }
  }

  if (!parentToolCallId && !hasToolRequests && state.accumulatedText.length > 0) {
    deps.publishEvent({
      type: "stream.text.complete",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        messageId: state.messageId,
        fullText: state.accumulatedText,
      },
    });
  }
}

export function handleCopilotToolStart(
  state: CopilotStreamAdapterState,
  deps: Pick<
    CopilotProviderHandlerDeps,
    "publishEvent" | "resolveParentAgentId" | "getSyntheticForegroundAgentIdForAttribution"
  >,
  event: AgentEvent<"tool.start">,
): void {
  const { toolName, toolInput, toolCallId } = event.data;
  const resolvedToolCallId = asString(toolCallId);
  if (!resolvedToolCallId) {
    return;
  }

  if (state.emittedToolStartIds.has(resolvedToolCallId)) {
    return;
  }

  const resolvedToolName = normalizeToolName(toolName);
  const toolId = resolveCopilotToolStartId(
    state.toolNameById,
    resolvedToolCallId,
    resolvedToolName,
  );
  const rawParentToolCallId = asString(
    (event.data as Record<string, unknown>).parentToolCallId,
  );
  const parentAgentId = deps.resolveParentAgentId(rawParentToolCallId);
  const syntheticParentAgentId =
    deps.getSyntheticForegroundAgentIdForAttribution();
  const isRootTaskTool =
    !rawParentToolCallId && isCopilotTaskTool(state, resolvedToolName);
  if (isRootTaskTool) {
    storeCopilotTaskToolMetadata(
      state.taskToolMetadata,
      resolvedToolCallId,
      normalizeCopilotToolInput(toolInput),
    );
    if (state.knownAgentNames.has(resolvedToolName.toLowerCase())) {
      const existing = state.taskToolMetadata.get(resolvedToolCallId);
      if (existing && !existing.agentType) {
        existing.agentType = resolvedToolName;
      }
    }
  }

  const effectiveParentAgentId = isRootTaskTool
    ? undefined
    : (parentAgentId ?? syntheticParentAgentId);
  if (!parentAgentId && rawParentToolCallId) {
    queueCopilotEarlyToolEvent(state, rawParentToolCallId, {
      phase: "start",
      toolId,
      toolName: resolvedToolName,
      toolInput: normalizeCopilotToolInput(toolInput),
      sdkCorrelationId: resolvedToolCallId,
    });
    return;
  }

  deps.publishEvent({
    type: "stream.tool.start",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      toolId,
      toolName: resolvedToolName,
      toolInput: normalizeCopilotToolInput(toolInput),
      sdkCorrelationId: resolvedToolCallId,
      parentAgentId: effectiveParentAgentId,
    },
  });

  if (!effectiveParentAgentId) {
    return;
  }

  recordCopilotActiveSubagentToolContext(
    state.activeSubagentToolsById,
    toolId,
    resolvedToolName,
    effectiveParentAgentId,
    resolvedToolCallId,
  );
  state.innerToolCallIds.add(resolvedToolCallId);
  if (state.subagentTracker?.hasAgent(effectiveParentAgentId)) {
    state.subagentTracker.onToolStart(effectiveParentAgentId, resolvedToolName);
    return;
  }

  queueCopilotEarlyToolEvent(state, effectiveParentAgentId, {
    phase: "start",
    toolId,
    toolName: resolvedToolName,
    toolInput: normalizeCopilotToolInput(toolInput),
    sdkCorrelationId: resolvedToolCallId,
  });
}

export function handleCopilotToolComplete(
  state: CopilotStreamAdapterState,
  deps: Pick<
    CopilotProviderHandlerDeps,
    "publishEvent" | "resolveParentAgentId" | "getSyntheticForegroundAgentIdForAttribution"
  >,
  event: AgentEvent<"tool.complete">,
): void {
  const { toolName, toolResult, success, error, toolCallId } = event.data;
  const resolvedToolCallId = asString(toolCallId);
  if (!resolvedToolCallId) {
    return;
  }

  const resolvedToolName = normalizeToolName(
    toolName ?? state.toolNameById.get(resolvedToolCallId),
  );
  const toolId = resolveCopilotToolCompleteId(
    state.toolNameById,
    resolvedToolCallId,
  );
  const toolInput = normalizeCopilotToolInput(
    (event.data as Record<string, unknown>).toolInput,
  );
  const activeToolContext = state.activeSubagentToolsById.get(resolvedToolCallId);
  removeCopilotActiveSubagentToolContext(
    state.activeSubagentToolsById,
    toolId,
    resolvedToolCallId,
  );
  state.emittedToolStartIds.delete(resolvedToolCallId);

  const normalizedSuccess = typeof success === "boolean" ? success : true;
  const rawParentToolCallId = asString(
    (event.data as Record<string, unknown>).parentToolCallId,
  );
  const resolvedParentId = deps.resolveParentAgentId(rawParentToolCallId);
  if (!resolvedParentId && rawParentToolCallId) {
    queueCopilotEarlyToolEvent(state, rawParentToolCallId, {
      phase: "complete",
      toolId,
      toolName: resolvedToolName,
      ...(toolInput ? { toolInput } : {}),
      toolResult,
      success: normalizedSuccess,
      ...(typeof error === "string" ? { error } : {}),
      sdkCorrelationId: resolvedToolCallId,
    });
    return;
  }

  const isRootTaskToolComplete =
    !rawParentToolCallId && isCopilotTaskTool(state, resolvedToolName);
  const effectiveParentAgentId = isRootTaskToolComplete
    ? undefined
    : (resolvedParentId ??
      activeToolContext?.parentAgentId ??
      deps.getSyntheticForegroundAgentIdForAttribution());
  if (effectiveParentAgentId && state.subagentTracker?.hasAgent(effectiveParentAgentId)) {
    state.subagentTracker.onToolComplete(effectiveParentAgentId);
  }

  deps.publishEvent({
    type: "stream.tool.complete",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      toolId,
      toolName: resolvedToolName,
      toolInput,
      toolResult,
      success: normalizedSuccess,
      error,
      sdkCorrelationId: resolvedToolCallId,
      parentAgentId: effectiveParentAgentId,
    },
  });
}

function isCopilotTaskTool(
  state: CopilotStreamAdapterState,
  toolName: string,
): boolean {
  const normalized = toolName.toLowerCase();
  return isBuiltInTaskTool(toolName) || state.knownAgentNames.has(normalized);
}
