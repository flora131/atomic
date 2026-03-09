import type {
  SessionEvent as SdkSessionEvent,
  SessionEventPayload as SdkSessionEventPayload,
} from "@github/copilot-sdk";

import type {
  ProviderStreamEventDataMap,
  ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";

import type { CopilotSessionState } from "@/services/agents/clients/copilot/types.ts";

export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function extractCopilotToolResult(result: unknown): unknown {
  const resultRecord = asRecord(result);
  if (!resultRecord) {
    return result;
  }

  const content = resultRecord.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }

  const detailedContent = resultRecord.detailedContent;
  if (typeof detailedContent === "string" && detailedContent.trim().length > 0) {
    return detailedContent;
  }

  if ("contents" in resultRecord) {
    return resultRecord.contents;
  }

  return result;
}

export function extractCopilotErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (error instanceof Error) {
    return error.message;
  }

  const direct = asNonEmptyString(error);
  if (direct) {
    return direct;
  }

  const record = asRecord(error);
  if (!record) {
    return fallback;
  }

  const directFields = [
    record.message,
    record.error,
    record.details,
    record.reason,
    record.stderr,
    record.stdout,
  ];

  for (const field of directFields) {
    const value = asNonEmptyString(field);
    if (value) {
      return value;
    }
  }

  const nestedError = record.error;
  if (nestedError !== undefined && nestedError !== error) {
    const nested = extractCopilotErrorMessage(nestedError, "");
    if (nested.length > 0) {
      return nested;
    }
  }

  if (Array.isArray(record.errors) && record.errors.length > 0) {
    const entries = record.errors
      .map((entry) => extractCopilotErrorMessage(entry, ""))
      .filter((entry) => entry.length > 0);
    if (entries.length > 0) {
      return entries.join("; ");
    }
  }

  try {
    return JSON.stringify(record);
  } catch {
    return fallback;
  }
}

export function getCopilotNativeMeta(
  native: SdkSessionEvent | undefined,
): Readonly<Record<string, string | number | boolean | null | undefined>> | undefined {
  if (!native) {
    return undefined;
  }

  const meta: Record<string, string | number | boolean | null | undefined> = {
    nativeEventId: native.id,
    nativeParentEventId: native.parentId,
  };

  if ("messageId" in native.data && typeof native.data.messageId === "string") {
    meta.nativeMessageId = native.data.messageId;
  }
  if ("toolCallId" in native.data && typeof native.data.toolCallId === "string") {
    meta.toolCallId = native.data.toolCallId;
  }
  if ("interactionId" in native.data && typeof native.data.interactionId === "string") {
    meta.interactionId = native.data.interactionId;
  }

  return meta;
}

function updateUsageState(
  state: CopilotSessionState | undefined,
  event: SdkSessionEvent,
): void {
  if (!state) {
    return;
  }

  if (event.type === "assistant.usage") {
    state.inputTokens = event.data.inputTokens ?? state.inputTokens;
    state.outputTokens = event.data.outputTokens ?? state.outputTokens;
    const eventData = event.data as Record<string, unknown>;
    const cache = (eventData.cacheWriteTokens as number | undefined)
      ?? (eventData.cacheReadTokens as number | undefined)
      ?? 0;
    if (cache > 0) {
      state.systemToolsBaseline = cache;
    }
    return;
  }

  if (event.type !== "session.usage_info") {
    return;
  }

  const data = event.data as Record<string, unknown>;
  const currentTokens = typeof data.currentTokens === "number"
    ? data.currentTokens
    : null;
  if (
    currentTokens !== null
    && currentTokens > 0
    && (state.systemToolsBaseline === null || state.systemToolsBaseline <= 0)
  ) {
    state.systemToolsBaseline = currentTokens;
  }
  if (typeof data.tokenLimit === "number") {
    state.contextWindow = data.tokenLimit;
  }
  if (currentTokens !== null) {
    state.inputTokens = currentTokens;
    state.outputTokens = 0;
  }
}

export function dispatchCopilotSdkEvent(args: {
  sessionId: string;
  event: SdkSessionEvent;
  state?: CopilotSessionState;
  isDuplicateEvent: (
    state: CopilotSessionState,
    event: SdkSessionEvent,
  ) => boolean;
  emitMappedSdkEvent: <T extends ProviderStreamEventType>(
    eventType: T,
    sessionId: string,
    data: ProviderStreamEventDataMap[T],
    nativeEvent: SdkSessionEvent,
    unifiedData?: Record<string, unknown>,
  ) => void;
}): void {
  if (args.state && args.isDuplicateEvent(args.state, args.event)) {
    return;
  }

  updateUsageState(args.state, args.event);

  const { sessionId, event } = args;

  switch (event.type) {
    case "session.start":
      args.emitMappedSdkEvent("session.start", sessionId, { config: args.state?.config }, event);
      return;
    case "session.resume":
      args.emitMappedSdkEvent("session.start", sessionId, {
        config: args.state?.config,
        source: "resume",
        resumeTime: event.data.resumeTime,
        resumeEventCount: event.data.eventCount,
      }, event);
      return;
    case "session.idle":
      args.emitMappedSdkEvent("session.idle", sessionId, { reason: "idle" }, event);
      return;
    case "session.error": {
      const sessionErrorEvent = event as SdkSessionEventPayload<"session.error">;
      const eventDataRecord = asRecord(sessionErrorEvent.data);
      args.emitMappedSdkEvent("session.error", sessionId, {
        error: extractCopilotErrorMessage(sessionErrorEvent.data),
        code: asNonEmptyString(eventDataRecord?.code) ?? asNonEmptyString(eventDataRecord?.errorType),
        errorType: sessionErrorEvent.data.errorType,
        statusCode: sessionErrorEvent.data.statusCode,
        providerCallId: sessionErrorEvent.data.providerCallId,
        stack: sessionErrorEvent.data.stack,
      }, sessionErrorEvent);
      return;
    }
    case "assistant.message_delta":
      args.emitMappedSdkEvent("message.delta", sessionId, {
        delta: event.data.deltaContent,
        contentType: "text",
        messageId: event.data.messageId,
        nativeMessageId: event.data.messageId,
        parentToolCallId: event.data.parentToolCallId ?? undefined,
      }, event, {
        delta: event.data.deltaContent,
        contentType: "text",
        messageId: event.data.messageId,
        parentToolCallId: event.data.parentToolCallId ?? undefined,
      });
      return;
    case "assistant.message": {
      const assistantMessageEvent = event as SdkSessionEventPayload<"assistant.message">;
      const toolRequests = Array.isArray(assistantMessageEvent.data.toolRequests)
        ? assistantMessageEvent.data.toolRequests.map((toolRequest) => ({
            toolCallId: String(toolRequest.toolCallId ?? ""),
            name: String(toolRequest.name ?? ""),
            arguments: toolRequest.arguments,
            type: toolRequest.type,
          }))
        : undefined;
      args.emitMappedSdkEvent("message.complete", sessionId, {
        message: {
          type: "text",
          content: assistantMessageEvent.data.content,
          role: "assistant",
        },
        nativeMessageId: assistantMessageEvent.data.messageId,
        interactionId: assistantMessageEvent.data.interactionId,
        phase: assistantMessageEvent.data.phase,
        reasoningText: assistantMessageEvent.data.reasoningText,
        reasoningOpaque: assistantMessageEvent.data.reasoningOpaque,
        toolRequests,
        parentToolCallId: assistantMessageEvent.data.parentToolCallId ?? undefined,
      }, assistantMessageEvent);
      return;
    }
    case "assistant.reasoning_delta":
      args.emitMappedSdkEvent("reasoning.delta", sessionId, {
        delta: event.data.deltaContent,
        reasoningId: event.data.reasoningId,
        parentToolCallId: asNonEmptyString((event.data as Record<string, unknown>).parentToolCallId),
      }, event);
      return;
    case "assistant.reasoning":
      args.emitMappedSdkEvent("reasoning.complete", sessionId, {
        reasoningId: event.data.reasoningId,
        content: event.data.content,
        parentToolCallId: asNonEmptyString((event.data as Record<string, unknown>).parentToolCallId),
      }, event);
      return;
    case "assistant.turn_start":
      args.emitMappedSdkEvent("turn.start", sessionId, { turnId: event.data.turnId }, event);
      return;
    case "assistant.turn_end":
      args.emitMappedSdkEvent("turn.end", sessionId, { turnId: event.data.turnId }, event);
      return;
    case "assistant.usage":
      args.emitMappedSdkEvent("usage", sessionId, {
        inputTokens: event.data.inputTokens ?? 0,
        outputTokens: event.data.outputTokens ?? 0,
        model: event.data.model,
        cacheReadTokens: event.data.cacheReadTokens,
        cacheWriteTokens: event.data.cacheWriteTokens,
        costUsd: event.data.cost,
        parentToolCallId: event.data.parentToolCallId ?? undefined,
      }, event);
      return;
    case "tool.execution_start": {
      const toolExecutionStartEvent = event as SdkSessionEventPayload<"tool.execution_start">;
      const toolCallId = asNonEmptyString(toolExecutionStartEvent.data.toolCallId);
      const toolName = asNonEmptyString(toolExecutionStartEvent.data.toolName)
        ?? asNonEmptyString(toolExecutionStartEvent.data.mcpToolName)
        ?? "unknown";
      if (args.state && toolCallId) {
        args.state.toolCallIdToName.set(toolCallId, toolName);
      }
      args.emitMappedSdkEvent("tool.start", sessionId, {
        toolName,
        toolInput: toolExecutionStartEvent.data.arguments,
        toolCallId,
        parentToolCallId: asNonEmptyString(toolExecutionStartEvent.data.parentToolCallId),
        mcpServerName: toolExecutionStartEvent.data.mcpServerName,
        mcpToolName: toolExecutionStartEvent.data.mcpToolName,
      }, toolExecutionStartEvent, {
        toolName,
        toolInput: toolExecutionStartEvent.data.arguments,
        toolCallId,
        parentToolCallId: asNonEmptyString(toolExecutionStartEvent.data.parentToolCallId),
      });
      return;
    }
    case "tool.execution_complete": {
      const toolExecutionCompleteEvent = event as SdkSessionEventPayload<"tool.execution_complete">;
      const toolCallId = asNonEmptyString(toolExecutionCompleteEvent.data.toolCallId);
      const mappedToolName = toolCallId ? args.state?.toolCallIdToName.get(toolCallId) : undefined;
      const toolName = mappedToolName ?? "unknown";
      if (toolCallId) {
        args.state?.toolCallIdToName.delete(toolCallId);
      }
      const errorData = asRecord(toolExecutionCompleteEvent.data.error);
      const success = typeof toolExecutionCompleteEvent.data.success === "boolean"
        ? toolExecutionCompleteEvent.data.success
        : true;
      const toolResult = extractCopilotToolResult(toolExecutionCompleteEvent.data.result);
      const error = asNonEmptyString(errorData?.message);
      args.emitMappedSdkEvent("tool.complete", sessionId, {
        toolName,
        success,
        toolResult,
        error,
        toolCallId,
        parentToolCallId: asNonEmptyString(toolExecutionCompleteEvent.data.parentToolCallId),
        interactionId: toolExecutionCompleteEvent.data.interactionId,
        structuredToolResult: toolExecutionCompleteEvent.data.result,
        toolTelemetry: toolExecutionCompleteEvent.data.toolTelemetry,
      }, toolExecutionCompleteEvent, {
        toolName,
        success,
        toolResult,
        error,
        toolCallId,
        parentToolCallId: asNonEmptyString(toolExecutionCompleteEvent.data.parentToolCallId),
      });
      return;
    }
    case "tool.execution_partial_result":
      args.emitMappedSdkEvent("tool.partial_result", sessionId, {
        toolCallId: event.data.toolCallId,
        partialOutput: event.data.partialOutput ?? "",
      }, event);
      return;
    case "tool.execution_progress":
      args.emitMappedSdkEvent("tool.partial_result", sessionId, {
        toolCallId: event.data.toolCallId,
        partialOutput: event.data.progressMessage ?? "",
      }, event);
      return;
    case "subagent.started":
      args.emitMappedSdkEvent("subagent.start", sessionId, {
        subagentId: event.data.toolCallId,
        subagentType: event.data.agentName,
        toolCallId: event.data.toolCallId,
        task: event.data.agentDescription || "",
      }, event);
      return;
    case "subagent.completed":
      args.emitMappedSdkEvent("subagent.complete", sessionId, {
        subagentId: event.data.toolCallId,
        success: true,
      }, event);
      return;
    case "subagent.failed":
      args.emitMappedSdkEvent("subagent.complete", sessionId, {
        subagentId: event.data.toolCallId,
        success: false,
        error: typeof event.data.error === "string"
          ? event.data.error
          : extractCopilotErrorMessage(event.data.error),
      }, event);
      return;
    case "skill.invoked":
      args.emitMappedSdkEvent("skill.invoked", sessionId, {
        skillName: event.data.name,
        skillPath: event.data.path,
        parentToolCallId: asNonEmptyString((event.data as Record<string, unknown>).parentToolCallId),
      }, event);
      return;
    case "session.info":
      args.emitMappedSdkEvent("session.info", sessionId, {
        infoType: event.data.infoType,
        message: event.data.message,
      }, event);
      return;
    case "session.warning":
      args.emitMappedSdkEvent("session.warning", sessionId, {
        warningType: event.data.warningType,
        message: event.data.message,
      }, event);
      return;
    case "session.title_changed":
      args.emitMappedSdkEvent("session.title_changed", sessionId, { title: event.data.title }, event);
      return;
    case "session.truncation":
      args.emitMappedSdkEvent("session.truncation", sessionId, {
        tokenLimit: event.data.tokenLimit,
        tokensRemoved: event.data.tokensRemovedDuringTruncation,
        messagesRemoved: event.data.messagesRemovedDuringTruncation,
      }, event);
      return;
    case "session.compaction_start":
      args.emitMappedSdkEvent("session.compaction", sessionId, { phase: "start" }, event);
      return;
    case "session.compaction_complete":
      args.emitMappedSdkEvent("session.compaction", sessionId, {
        phase: "complete",
        success: typeof event.data.success === "boolean" ? event.data.success : true,
        error: asNonEmptyString(event.data.error),
      }, event);
      return;
    case "session.usage_info":
    case "session.shutdown":
    case "session.context_changed":
    case "session.model_change":
    case "session.mode_changed":
    case "session.plan_changed":
    case "session.workspace_file_changed":
    case "session.handoff":
    case "session.snapshot_rewind":
    case "session.task_complete":
    case "user.message":
    case "assistant.intent":
    case "assistant.streaming_delta":
    case "hook.start":
    case "hook.end":
    case "tool.user_requested":
    case "subagent.selected":
    case "subagent.deselected":
    case "pending_messages.modified":
    case "system.message":
    case "permission.requested":
    case "permission.completed":
    case "user_input.requested":
    case "user_input.completed":
    case "elicitation.requested":
    case "elicitation.completed":
    case "abort":
      return;
    default:
      return;
  }
}
