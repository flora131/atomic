import type {
  AgentEvent,
  HumanInputRequiredEventData,
  PermissionRequestedEventData,
  ReasoningCompleteEventData,
  ReasoningDeltaEventData,
  SessionCompactionEventData,
  SessionInfoEventData,
  SessionTitleChangedEventData,
  SessionTruncationEventData,
  SessionWarningEventData,
  SkillInvokedEventData,
  ToolPartialResultEventData,
  TurnEndEventData,
  TurnStartEventData,
} from "@/services/agents/types.ts";
import {
  normalizeTurnEndMetadata,
  normalizeTurnStartId,
} from "@/services/events/adapters/task-turn-normalization.ts";
import {
  asString,
  ensureCopilotThinkingStream,
  getCopilotThinkingStreamKey,
  getSyntheticForegroundAgentIdForAttribution,
  publishSyntheticForegroundAgentComplete,
} from "@/services/events/adapters/providers/copilot/support.ts";
import type { CopilotSessionHandlerContext } from "@/services/events/adapters/providers/copilot/types.ts";

export function handleCopilotSessionIdle(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.idle">,
): void {
  const { reason } = event.data;
  publishSyntheticForegroundAgentComplete({
    syntheticForegroundAgent: context.syntheticForegroundAgent,
    subagentTracker: context.subagentTracker,
    publishEvent: context.publishEvent,
    sessionId: context.sessionId,
    runId: context.runId,
    accumulatedText: context.accumulatedText,
    success: reason === "idle",
  });
  context.updatePendingIdleReason(typeof reason === "string" ? reason : null);
}

export function handleCopilotSessionError(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.error">,
): void {
  const { error, code } = event.data;
  publishSyntheticForegroundAgentComplete({
    syntheticForegroundAgent: context.syntheticForegroundAgent,
    subagentTracker: context.subagentTracker,
    publishEvent: context.publishEvent,
    sessionId: context.sessionId,
    runId: context.runId,
    accumulatedText: context.accumulatedText,
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });

  context.publishEvent({
    type: "stream.session.error",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      error: error instanceof Error ? error.message : String(error),
      code,
    },
  });
}

export function handleCopilotUsage(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"usage">,
): void {
  const data = event.data as Record<string, unknown>;
  const inputTokens = (data.inputTokens as number) || 0;
  const outputTokens = (data.outputTokens as number) || 0;
  const model = data.model as string | undefined;

  if (outputTokens <= 0 && inputTokens <= 0) {
    return;
  }

  const nextOutputTokens = context.accumulatedOutputTokens + outputTokens;
  context.updateAccumulatedOutputTokens(nextOutputTokens);

  context.publishEvent({
    type: "stream.usage",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      inputTokens,
      outputTokens: nextOutputTokens,
      model,
    },
  });
}

export function handleCopilotPermissionRequested(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"permission.requested">,
): void {
  const data = event.data as PermissionRequestedEventData;
  context.publishEvent({
    type: "stream.permission.requested",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      requestId: data.requestId,
      toolName: data.toolName,
      toolInput: data.toolInput as Record<string, unknown> | undefined,
      question: data.question,
      header: data.header,
      options: data.options,
      multiSelect: data.multiSelect,
      respond: data.respond as
        | ((...args: unknown[]) => unknown)
        | undefined,
      toolCallId: data.toolCallId,
    },
  });
}

export function handleCopilotHumanInputRequired(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"human_input_required">,
): void {
  const data = event.data as HumanInputRequiredEventData;
  context.publishEvent({
    type: "stream.human_input_required",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      requestId: data.requestId,
      question: data.question,
      header: data.header,
      options: data.options,
      nodeId: data.nodeId,
      respond: data.respond as
        | ((...args: unknown[]) => unknown)
        | undefined,
      toolCallId: data.toolCallId,
    },
  });
}

export function handleCopilotSkillInvoked(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"skill.invoked">,
): void {
  const data = event.data as SkillInvokedEventData;
  const dataRecord = data as Record<string, unknown>;
  const parentToolCallId = asString(
    data.parentToolCallId ??
      dataRecord.parentToolUseId ??
      dataRecord.parent_tool_use_id,
  );
  const parentAgentId =
    asString(dataRecord.parentAgentId) ??
    context.resolveParentAgentId(parentToolCallId);

  context.publishEvent({
    type: "stream.skill.invoked",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      skillName: data.skillName,
      skillPath: data.skillPath,
      ...(parentAgentId ? { agentId: parentAgentId } : {}),
    },
  });
}

export function handleCopilotReasoningDelta(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"reasoning.delta">,
): void {
  const data = event.data as ReasoningDeltaEventData;
  const reasoningId = data.reasoningId ?? "reasoning";
  const dataRecord = data as Record<string, unknown>;
  const parentToolCallId = asString(dataRecord.parentToolCallId);
  const agentId =
    context.resolveParentAgentId(parentToolCallId) ??
    getSyntheticForegroundAgentIdForAttribution(
      context.syntheticForegroundAgent,
    );

  ensureCopilotThinkingStream(context.thinkingStreams, reasoningId, agentId);

  context.publishEvent({
    type: "stream.thinking.delta",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      delta: data.delta,
      sourceKey: reasoningId,
      messageId: context.messageId,
      ...(agentId ? { agentId } : {}),
    },
  });
}

export function handleCopilotReasoningComplete(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"reasoning.complete">,
): void {
  const data = event.data as ReasoningCompleteEventData;
  const reasoningId = data.reasoningId ?? "reasoning";
  const dataRecord = data as Record<string, unknown>;
  const parentToolCallId = asString(dataRecord.parentToolCallId);
  const agentId =
    context.resolveParentAgentId(parentToolCallId) ??
    getSyntheticForegroundAgentIdForAttribution(
      context.syntheticForegroundAgent,
    );
  const thinkingKey = getCopilotThinkingStreamKey(
    context.thinkingStreams,
    reasoningId,
    agentId,
  );
  const startTime = thinkingKey
    ? context.thinkingStreams.get(thinkingKey)?.startTime ?? Date.now()
    : Date.now();
  const durationMs = Date.now() - startTime;
  if (thinkingKey) {
    context.thinkingStreams.delete(thinkingKey);
  }

  context.publishEvent({
    type: "stream.thinking.complete",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      sourceKey: reasoningId,
      durationMs,
      ...(agentId ? { agentId } : {}),
    },
  });
}

export function handleCopilotTurnStart(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"turn.start">,
): void {
  const data = event.data as TurnStartEventData;
  context.publishEvent({
    type: "stream.turn.start",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      turnId: normalizeTurnStartId(data.turnId, context.turnMetadataState),
    },
  });
}

export function handleCopilotTurnEnd(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"turn.end">,
): void {
  const data = event.data as TurnEndEventData;
  context.publishEvent({
    type: "stream.turn.end",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: normalizeTurnEndMetadata(data, context.turnMetadataState),
  });
}

export function handleCopilotToolPartialResult(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"tool.partial_result">,
): void {
  const data = event.data as ToolPartialResultEventData;
  const toolCallId = asString(data.toolCallId);
  const toolContext = toolCallId
    ? context.activeSubagentToolsById.get(toolCallId)
    : undefined;

  context.publishEvent({
    type: "stream.tool.partial_result",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      toolCallId: data.toolCallId,
      partialOutput: data.partialOutput,
      ...(toolContext ? { parentAgentId: toolContext.parentAgentId } : {}),
    },
  });

  if (
    toolCallId &&
    toolContext &&
    context.subagentTracker?.hasAgent(toolContext.parentAgentId)
  ) {
    context.subagentTracker.onToolProgress(
      toolContext.parentAgentId,
      toolContext.toolName,
    );
  }
}

export function handleCopilotSessionInfo(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.info">,
): void {
  const data = event.data as SessionInfoEventData;
  context.publishEvent({
    type: "stream.session.info",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      infoType: data.infoType ?? "general",
      message: data.message ?? "",
    },
  });
}

export function handleCopilotSessionWarning(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.warning">,
): void {
  const data = event.data as SessionWarningEventData;
  context.publishEvent({
    type: "stream.session.warning",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      warningType: data.warningType ?? "general",
      message: data.message ?? "",
    },
  });
}

export function handleCopilotSessionTitleChanged(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.title_changed">,
): void {
  const data = event.data as SessionTitleChangedEventData;
  context.publishEvent({
    type: "stream.session.title_changed",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      title: data.title ?? "",
    },
  });
}

export function handleCopilotSessionTruncation(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.truncation">,
): void {
  const data = event.data as SessionTruncationEventData;
  context.publishEvent({
    type: "stream.session.truncation",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      tokenLimit: data.tokenLimit ?? 0,
      tokensRemoved: data.tokensRemoved ?? 0,
      messagesRemoved: data.messagesRemoved ?? 0,
    },
  });
}

export function handleCopilotSessionCompaction(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.compaction">,
): void {
  const data = event.data as SessionCompactionEventData;
  context.publishEvent({
    type: "stream.session.compaction",
    sessionId: context.sessionId,
    runId: context.runId,
    timestamp: Date.now(),
    data: {
      phase: data.phase,
      success: data.success,
      error: data.error,
    },
  });
}
