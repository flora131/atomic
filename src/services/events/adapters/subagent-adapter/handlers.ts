import type { AgentMessage } from "@/services/agents/types.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import type { SubagentStreamResult } from "@/services/workflows/graph/types.ts";
import {
  asRecord,
  asString,
  createSyntheticToolId,
  normalizeToolName,
  resolveToolCompleteId,
} from "./helpers.ts";
import type {
  SubagentConsumeResultOptions,
  SubagentStreamAdapterState,
} from "./types.ts";

export function processSubagentChunk(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  switch (chunk.type) {
    case "text":
      handleSubagentText(state, chunk);
      break;
    case "thinking":
      handleSubagentThinking(state, chunk);
      break;
    case "tool_use":
      handleSubagentToolUse(state, chunk);
      break;
    case "tool_result":
      handleSubagentToolResult(state, chunk);
      break;
  }

  handleSubagentUsage(state, chunk);
}

export function handleSubagentText(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  if (typeof chunk.content !== "string") return;

  const delta = chunk.content;
  state.textAccumulator += delta;

  const event: BusEvent<"stream.text.delta"> = {
    type: "stream.text.delta",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      delta,
      messageId: state.messageId,
      agentId: state.agentId,
    },
  };

  state.bus.publish(event);
}

export function handleSubagentThinking(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  const metadata = chunk.metadata;
  const thinkingSourceKey =
    (metadata?.thinkingSourceKey as string | undefined) ?? "default";

  if (typeof chunk.content === "string" && chunk.content.length > 0) {
    if (!state.thinkingStartTimes.has(thinkingSourceKey)) {
      state.thinkingStartTimes.set(thinkingSourceKey, Date.now());
    }

    state.bus.publish({
      type: "stream.thinking.delta",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        delta: chunk.content,
        sourceKey: thinkingSourceKey,
        messageId: state.messageId,
        agentId: state.agentId,
      },
    });
  }

  const streamingStats = metadata?.streamingStats as
    | { thinkingMs?: number; outputTokens?: number }
    | undefined;
  if (streamingStats?.thinkingMs !== undefined && chunk.content === "") {
    const startTime = state.thinkingStartTimes.get(thinkingSourceKey);
    const durationMs =
      streamingStats.thinkingMs ?? (startTime ? Date.now() - startTime : 0);
    state.thinkingStartTimes.delete(thinkingSourceKey);
    state.thinkingDurationMs += durationMs;

    state.bus.publish({
      type: "stream.thinking.complete",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        sourceKey: thinkingSourceKey,
        durationMs,
        agentId: state.agentId,
      },
    });
  }
}

export function handleSubagentToolUse(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  state.toolUseCount++;

  const chunkRecord = chunk as unknown as Record<string, unknown>;
  const contentRecord = asRecord(chunkRecord.content) ?? {};
  const metadataRecord = asRecord(chunk.metadata) ?? {};

  const toolName = normalizeToolName(
    contentRecord.name ?? chunkRecord.name ?? metadataRecord.toolName,
  );
  const explicitToolId = asString(
    contentRecord.toolUseId ??
      contentRecord.toolUseID ??
      contentRecord.id ??
      chunkRecord.toolUseId ??
      chunkRecord.toolUseID ??
      chunkRecord.id ??
      metadataRecord.toolId ??
      metadataRecord.toolUseId ??
      metadataRecord.toolUseID ??
      metadataRecord.toolCallId,
  );
  const toolInput = asRecord(contentRecord.input ?? chunkRecord.input) ?? {};
  const toolId = explicitToolId ?? createSyntheticToolId(
    state.agentId,
    toolName,
    ++state.syntheticToolCounter,
  );

  state.toolStartTimes.set(toolId, Date.now());
  state.toolNames.set(toolId, toolName);
  state.toolTracker.onToolStart(state.agentId, toolName);

  state.bus.publish({
    type: "stream.tool.start",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      toolId,
      toolName,
      toolInput,
      sdkCorrelationId: explicitToolId ?? toolId,
      parentAgentId: state.agentId,
    },
  });
}

export function handleSubagentToolResult(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  const chunkRecord = chunk as unknown as Record<string, unknown>;
  const content = chunkRecord.content;
  const metadataRecord = asRecord(chunk.metadata) ?? {};

  const toolName = normalizeToolName(
    chunkRecord.toolName ?? metadataRecord.toolName,
  );
  const explicitToolId = asString(
    chunkRecord.tool_use_id ??
      chunkRecord.toolUseId ??
      chunkRecord.toolUseID ??
      metadataRecord.toolId ??
      metadataRecord.toolUseId ??
      metadataRecord.toolUseID ??
      metadataRecord.toolCallId,
  );
  const toolId = explicitToolId ??
    resolveToolCompleteId(
      state.toolNames,
      (name) =>
        createSyntheticToolId(state.agentId, name, ++state.syntheticToolCounter),
      toolName,
    );

  const contentRecord = asRecord(content);
  const isError =
    chunkRecord.is_error === true ||
    (typeof content === "object" && content !== null && "error" in content);
  const errorValue = contentRecord?.error;

  const startTime = state.toolStartTimes.get(toolId);
  const durationMs = startTime ? Date.now() - startTime : 0;
  state.toolStartTimes.delete(toolId);

  const resolvedToolName = state.toolNames.get(toolId) ?? toolName;
  state.toolNames.delete(toolId);

  state.toolDetails.push({
    toolId,
    toolName: resolvedToolName,
    durationMs,
    success: !isError,
  });

  state.toolTracker.onToolComplete(state.agentId);

  state.bus.publish({
    type: "stream.tool.complete",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      toolId,
      toolName: resolvedToolName,
      toolResult: content,
      success: !isError,
      error: isError
        ? typeof errorValue === "string"
          ? errorValue
          : String(content)
        : undefined,
      sdkCorrelationId: explicitToolId ?? toolId,
      parentAgentId: state.agentId,
    },
  });
}

export function handleSubagentUsage(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  const tokenUsage = chunk.metadata?.tokenUsage as
    | { inputTokens?: number; outputTokens?: number }
    | undefined;
  if (!tokenUsage) return;

  const inputTokens = tokenUsage.inputTokens ?? 0;
  const outputTokens = tokenUsage.outputTokens ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0) return;

  state.tokenUsage.inputTokens += inputTokens;
  state.tokenUsage.outputTokens += outputTokens;

  state.bus.publish({
    type: "stream.usage",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      inputTokens: state.tokenUsage.inputTokens,
      outputTokens: state.tokenUsage.outputTokens,
      model: chunk.metadata?.model as string | undefined,
      agentId: state.agentId,
    },
  });
}

export function publishSubagentTextComplete(
  state: SubagentStreamAdapterState,
): void {
  state.bus.publish({
    type: "stream.text.complete",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      messageId: state.messageId,
      fullText: state.textAccumulator,
    },
  });
}

export function publishSubagentSessionError(
  state: SubagentStreamAdapterState,
  errorMessage: string,
): void {
  state.bus.publish({
    type: "stream.session.error",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      error: errorMessage,
    },
  });
}

export function publishSubagentAgentStart(
  state: SubagentStreamAdapterState,
): void {
  if (!state.agentType || state.agentStartPublished) return;
  state.agentStartPublished = true;

  state.bus.publish({
    type: "stream.agent.start",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      agentId: state.agentId,
      toolCallId: state.agentId,
      agentType: state.agentType,
      task: state.task ?? state.agentType,
      isBackground: state.isBackground,
    },
  });
}

export function finalizeSubagentThinking(
  state: SubagentStreamAdapterState,
): void {
  const now = Date.now();
  for (const [, startTime] of state.thinkingStartTimes) {
    state.thinkingDurationMs += now - startTime;
  }
  state.thinkingStartTimes.clear();
}

export function buildSubagentStreamResult(
  state: SubagentStreamAdapterState,
  options: SubagentConsumeResultOptions,
): SubagentStreamResult {
  const result: SubagentStreamResult = {
    agentId: state.agentId,
    success: options.success,
    output: state.textAccumulator,
    toolUses: state.toolUseCount,
    durationMs: Date.now() - options.startTime,
  };

  if (options.error) {
    result.error = options.error;
  }

  if (state.tokenUsage.inputTokens > 0 || state.tokenUsage.outputTokens > 0) {
    result.tokenUsage = { ...state.tokenUsage };
  }

  if (state.thinkingDurationMs > 0) {
    result.thinkingDurationMs = state.thinkingDurationMs;
  }

  if (state.toolDetails.length > 0) {
    result.toolDetails = [...state.toolDetails];
  }

  state.agentStartPublished = false;
  return result;
}

export function resetSubagentStreamState(
  state: SubagentStreamAdapterState,
): void {
  state.textAccumulator = "";
  state.toolUseCount = 0;
  state.tokenUsage = { inputTokens: 0, outputTokens: 0 };
  state.thinkingDurationMs = 0;
  state.thinkingStartTimes.clear();
  state.toolDetails = [];
  state.toolStartTimes.clear();
  state.toolNames.clear();
  state.syntheticToolCounter = 0;
  state.toolTracker.removeAgent(state.agentId);
  state.toolTracker.registerAgent(state.agentId);
}
