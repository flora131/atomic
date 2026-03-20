import type { AgentEvent } from "@/services/agents/types.ts";
import { isBuiltInTaskTool } from "@/services/events/adapters/provider-shared.ts";
import {
  asString,
  buildCopilotThinkingStreamKey,
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

/**
 * Flush all buffered text deltas for a given agent, emitting them as
 * `stream.text.delta` events. Called when we've resolved whether thinking
 * will happen for this agent (either thinking arrived first, or a second
 * text delta confirmed its absence).
 */
function flushPendingTextDeltas(
  state: CopilotStreamAdapterState,
  deps: Pick<CopilotProviderHandlerDeps, "publishEvent">,
  agentKey: string,
): void {
  const buffer = state.pendingTextDeltas.get(agentKey);
  if (!buffer || buffer.length === 0) {
    return;
  }
  for (const entry of buffer) {
    if (entry.delta.length > 0) {
      deps.publishEvent({
        type: "stream.text.delta",
        sessionId: state.sessionId,
        runId: state.runId,
        timestamp: Date.now(),
        data: {
          delta: entry.delta,
          messageId: state.messageId,
          ...(entry.agentId ? { agentId: entry.agentId } : {}),
        },
      });
    }
  }
  state.pendingTextDeltas.delete(agentKey);
}

/**
 * Flush all pending text delta buffers across all agents. Called at
 * message completion and stream end to ensure no text deltas are left
 * undelivered.
 */
export function flushAllPendingTextDeltas(
  state: CopilotStreamAdapterState,
  deps: Pick<CopilotProviderHandlerDeps, "publishEvent">,
): void {
  for (const agentKey of state.pendingTextDeltas.keys()) {
    flushPendingTextDeltas(state, deps, agentKey);
  }
}

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
  const agentKey = agentId ?? "__foreground__";

  if (contentType === "thinking" && thinkingSourceKey) {
    // Mark this agent's content type as resolved — thinking is present.
    // The reasoning part will get an earlier ID than any subsequent text.
    state.contentTypeResolvedAgents.add(agentKey);

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

    // Flush buffered text deltas now that reasoning has an earlier ID.
    flushPendingTextDeltas(state, deps, agentKey);
    return;
  }

  // Accumulate text for message completion regardless of buffering.
  if (!agentId) {
    state.accumulatedText += delta;
  }

  // If content type is already resolved for this agent, emit immediately.
  if (state.contentTypeResolvedAgents.has(agentKey)) {
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
    return;
  }

  // Content type not yet resolved — buffer text while we wait for
  // the next event to determine if thinking will happen.
  const buffer = state.pendingTextDeltas.get(agentKey);
  if (!buffer || buffer.length === 0) {
    // First text delta for this agent — buffer it.
    state.pendingTextDeltas.set(agentKey, [{ delta, agentId }]);
    return;
  }

  // Second text delta without thinking — resolve as no-thinking.
  state.contentTypeResolvedAgents.add(agentKey);
  flushPendingTextDeltas(state, deps, agentKey);

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

  let hadThinkingStreamForAgent = false;
  for (const [thinkingKey, stream] of state.thinkingStreams.entries()) {
    if ((stream.agentId ?? undefined) !== completionAgentId) {
      continue;
    }
    hadThinkingStreamForAgent = true;
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

  // When no thinking stream was active for this agent but the final message
  // carries a `reasoningText` field (the Copilot SDK does not always stream
  // reasoning deltas -- some models only include reasoning in the completed
  // message), emit a synthetic thinking delta + complete pair so the UI
  // renders the reasoning block in the correct position (before text).
  const reasoningText = asString(eventData.reasoningText);
  if (!hadThinkingStreamForAgent && reasoningText && reasoningText.trim().length > 0) {
    const syntheticSourceKey = `msg-reasoning-${state.messageId}`;
    // Guard against duplicate emission: only emit if there is no existing
    // thinking stream with this synthetic key.
    const existingKey = buildCopilotThinkingStreamKey(syntheticSourceKey, completionAgentId);
    if (!state.thinkingStreams.has(existingKey)) {
      deps.publishEvent({
        type: "stream.thinking.delta",
        sessionId: state.sessionId,
        runId: state.runId,
        timestamp: Date.now(),
        data: {
          delta: reasoningText,
          sourceKey: syntheticSourceKey,
          messageId: state.messageId,
          ...(completionAgentId ? { agentId: completionAgentId } : {}),
        },
      });
      deps.publishEvent({
        type: "stream.thinking.complete",
        sessionId: state.sessionId,
        runId: state.runId,
        timestamp: Date.now(),
        data: {
          sourceKey: syntheticSourceKey,
          durationMs: 0,
          ...(completionAgentId ? { agentId: completionAgentId } : {}),
        },
      });
    }
  }

  // Flush any remaining buffered text deltas. At this point, thinking
  // events (streamed or synthetic) have already been emitted — so any
  // reasoning parts already have earlier IDs. Flushed text parts will
  // get later IDs, preserving correct ordering.
  flushAllPendingTextDeltas(state, deps);

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

  // Suppress the SDK's tool.execution_complete for root task tools.
  // The Copilot SDK fires tool.execution_complete BEFORE subagent.completed,
  // so publishing stream.tool.complete here would cause
  // finalizeCorrelatedSubagentDispatchForToolComplete in the UI layer to
  // prematurely mark the agent as "completed" while it is still running.
  // handleCopilotSubagentComplete already publishes the synthetic task tool
  // complete at the correct time (after the sub-agent actually finishes).
  //
  // We must check this BEFORE resolveCopilotToolCompleteId because that
  // function deletes the entry from toolNameById, which
  // publishSyntheticTaskToolComplete needs to find the tool name.
  const rawParentToolCallId = asString(
    (event.data as Record<string, unknown>).parentToolCallId,
  );
  const isRootTaskToolComplete =
    !rawParentToolCallId && isCopilotTaskTool(state, resolvedToolName);
  if (isRootTaskToolComplete) {
    return;
  }

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

  const effectiveParentAgentId =
    resolvedParentId ??
    activeToolContext?.parentAgentId ??
    deps.getSyntheticForegroundAgentIdForAttribution();
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
