import type { AgentMessage } from "@/services/agents/types.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
import {
  readSubagentLifecycleMetadata,
  readSubagentRoutingMetadata,
  type SubagentLifecycleMetadata,
} from "@/services/agents/contracts/subagent-stream.ts";
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
  const lifecycle = readSubagentLifecycleMetadata(chunk.metadata);
  if (lifecycle) {
    handleNestedSubagentLifecycle(state, lifecycle);
    return;
  }

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

  const agentId = resolveChunkAgentId(state, chunk);
  const delta = chunk.content;
  if (agentId === state.agentId) {
    state.textAccumulator += delta;
  }

  const event: BusEvent<"stream.text.delta"> = {
    type: "stream.text.delta",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      delta,
      messageId: buildMessageId(agentId),
      agentId,
    },
  };

  state.bus.publish(event);
}

export function handleSubagentThinking(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  const agentId = resolveChunkAgentId(state, chunk);
  const metadata = chunk.metadata;
  const thinkingSourceKey =
    (metadata?.thinkingSourceKey as string | undefined) ?? "default";
  const thinkingStateKey = `${agentId}:${thinkingSourceKey}`;

  if (typeof chunk.content === "string" && chunk.content.length > 0) {
    if (!state.thinkingStartTimes.has(thinkingStateKey)) {
      state.thinkingStartTimes.set(thinkingStateKey, Date.now());
    }

    state.bus.publish({
      type: "stream.thinking.delta",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        delta: chunk.content,
        sourceKey: thinkingSourceKey,
        messageId: buildMessageId(agentId),
        agentId,
      },
    });
  }

  const streamingStats = metadata?.streamingStats as
    | { thinkingMs?: number; outputTokens?: number }
    | undefined;
  if (streamingStats?.thinkingMs !== undefined && chunk.content === "") {
    const startTime = state.thinkingStartTimes.get(thinkingStateKey);
    const durationMs =
      streamingStats.thinkingMs ?? (startTime ? Date.now() - startTime : 0);
    state.thinkingStartTimes.delete(thinkingStateKey);
    if (agentId === state.agentId) {
      state.thinkingDurationMs += durationMs;
    }

    state.bus.publish({
      type: "stream.thinking.complete",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        sourceKey: thinkingSourceKey,
        durationMs,
        agentId,
      },
    });
  }
}

export function handleSubagentToolUse(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  const agentId = resolveChunkAgentId(state, chunk);
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
    agentId,
    toolName,
    ++state.syntheticToolCounter,
  );

  state.toolStartTimes.set(toolId, Date.now());
  state.toolNames.set(toolId, toolName);
  if (!state.toolTracker.hasAgent(agentId)) {
    state.toolTracker.registerAgent(agentId);
  }
  state.toolTracker.onToolStart(agentId, toolName);

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
      parentAgentId: agentId,
    },
  });
}

export function handleSubagentToolResult(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  const agentId = resolveChunkAgentId(state, chunk);
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
        createSyntheticToolId(agentId, name, ++state.syntheticToolCounter),
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

  state.toolTracker.onToolComplete(agentId);

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
      parentAgentId: agentId,
    },
  });
}

export function handleSubagentUsage(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): void {
  const agentId = resolveChunkAgentId(state, chunk);
  const tokenUsage = chunk.metadata?.tokenUsage as
    | { inputTokens?: number; outputTokens?: number }
    | undefined;
  if (!tokenUsage) return;

  const inputTokens = tokenUsage.inputTokens ?? 0;
  const outputTokens = tokenUsage.outputTokens ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0) return;

  const agentUsage = state.tokenUsageByAgent.get(agentId) ?? {
    inputTokens: 0,
    outputTokens: 0,
  };
  agentUsage.inputTokens += inputTokens;
  agentUsage.outputTokens += outputTokens;
  state.tokenUsageByAgent.set(agentId, agentUsage);

  if (agentId === state.agentId) {
    state.tokenUsage = { ...agentUsage };
  }

  state.bus.publish({
    type: "stream.usage",
    sessionId: state.sessionId,
    runId: state.runId,
    timestamp: Date.now(),
    data: {
      inputTokens: agentUsage.inputTokens,
      outputTokens: agentUsage.outputTokens,
      model: chunk.metadata?.model as string | undefined,
      agentId,
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
  for (const [key, startTime] of state.thinkingStartTimes) {
    if (key.startsWith(`${state.agentId}:`)) {
      state.thinkingDurationMs += now - startTime;
    }
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
  state.tokenUsageByAgent.clear();
  state.thinkingDurationMs = 0;
  state.thinkingStartTimes.clear();
  state.toolDetails = [];
  state.toolStartTimes.clear();
  state.toolNames.clear();
  state.syntheticToolCounter = 0;
  state.toolTracker.removeAgent(state.agentId);
  state.toolTracker.registerAgent(state.agentId, {
    isBackground: state.isBackground,
  });
}

function resolveChunkAgentId(
  state: SubagentStreamAdapterState,
  chunk: AgentMessage,
): string {
  return readSubagentRoutingMetadata(chunk.metadata)?.agentId ?? state.agentId;
}

function buildMessageId(agentId: string): string {
  return `subagent-${agentId}`;
}

function handleNestedSubagentLifecycle(
  state: SubagentStreamAdapterState,
  lifecycle: SubagentLifecycleMetadata,
): void {
  switch (lifecycle.eventType) {
    case "start":
      state.toolTracker.registerAgent(lifecycle.subagentId, {
        isBackground: lifecycle.isBackground,
      });
      state.bus.publish({
        type: "stream.agent.start",
        sessionId: state.sessionId,
        runId: state.runId,
        timestamp: Date.now(),
        data: {
          agentId: lifecycle.subagentId,
          toolCallId:
            lifecycle.toolCallId
            ?? lifecycle.sdkCorrelationId
            ?? lifecycle.subagentId,
          agentType: lifecycle.subagentType ?? "unknown",
          task: lifecycle.task ?? lifecycle.subagentType ?? "sub-agent task",
          isBackground: lifecycle.isBackground ?? false,
          ...(lifecycle.sdkCorrelationId
            ? { sdkCorrelationId: lifecycle.sdkCorrelationId }
            : {}),
        },
      });
      return;
    case "update":
      state.bus.publish({
        type: "stream.agent.update",
        sessionId: state.sessionId,
        runId: state.runId,
        timestamp: Date.now(),
        data: {
          agentId: lifecycle.subagentId,
          ...(lifecycle.currentTool ? { currentTool: lifecycle.currentTool } : {}),
          ...(lifecycle.toolUses !== undefined ? { toolUses: lifecycle.toolUses } : {}),
        },
      });
      return;
    case "complete":
      state.toolTracker.removeAgent(lifecycle.subagentId);
      state.bus.publish({
        type: "stream.agent.complete",
        sessionId: state.sessionId,
        runId: state.runId,
        timestamp: Date.now(),
        data: {
          agentId: lifecycle.subagentId,
          success: lifecycle.success !== false,
          ...(typeof lifecycle.result === "string" ? { result: lifecycle.result } : {}),
          ...(
            lifecycle.success === false
              ? {
                error:
                  lifecycle.error
                  ?? (lifecycle.result !== undefined ? String(lifecycle.result) : undefined),
              }
              : {}
          ),
        },
      });
      return;
  }
}
