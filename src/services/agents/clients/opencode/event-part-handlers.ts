import type { Event as OpenCodeEvent } from "@opencode-ai/sdk/v2/client";
import type {
  OpenCodeEventMapperContext,
  OpenCodeToolPartContext,
} from "@/services/agents/clients/opencode/event-mapper-types.ts";

export function handleOpenCodeMessagePartUpdated(
  event: OpenCodeEvent,
  properties: Record<string, unknown> | undefined,
  context: OpenCodeEventMapperContext,
): void {
  const part = properties?.part as Record<string, unknown> | undefined;
  const partSessionId = (part?.sessionID as string) ?? (properties?.sessionID as string) ?? "";
  const partMessageId = (part?.messageID as string) ?? "";
  const partMessageRole = context.sessionStateSupport.getMessageRole(partSessionId, partMessageId);
  const parentSessionId = context.sessionStateSupport.findParentSessionForPart(properties, partSessionId);
  const sessionSubagentState = parentSessionId
    ? context.sessionStateSupport.getSubagentSessionState(parentSessionId)
    : context.sessionStateSupport.createSubagentSessionState();
  const normalizedPartType = typeof part?.type === "string"
    ? part.type.toLowerCase()
    : "";

  if (normalizedPartType === "text") {
    return;
  }

  if (normalizedPartType === "reasoning" || normalizedPartType === "thinking") {
    const partId = (part?.id as string) ?? undefined;
    if (partId) {
      context.reasoningPartIds.add(partId);
    }
    return;
  }

  if (part?.type === "tool") {
    handleOpenCodeToolPart({
      part,
      partSessionId,
      partMessageId,
      parentSessionId,
      sessionSubagentState,
      properties,
      context,
    });
    return;
  }

  if (part?.type === "agent") {
    if (partMessageRole === "user") {
      return;
    }

    const agentPartId = (part?.id as string) ?? "";
    const agentName = (part?.name as string) ?? "";
    const taskToolPartId = context.sessionStateSupport.dequeuePendingTaskToolPartId(sessionSubagentState);
    const correlationId = taskToolPartId ?? (part?.callID as string) ?? agentPartId;
    context.debugLog("subagent.start", {
      partType: "agent",
      subagentId: agentPartId,
      subagentType: agentName,
      toolCallId: correlationId,
      taskToolPartId: taskToolPartId ?? "none",
    });
    sessionSubagentState.pendingAgentParts.push({ partId: agentPartId, agentName });
    context.emitEvent("subagent.start", parentSessionId || partSessionId, {
      subagentId: agentPartId,
      subagentType: agentName,
      toolCallId: correlationId,
    });
    context.emitProviderEvent("subagent.start", parentSessionId || partSessionId, {
      subagentId: agentPartId,
      subagentType: agentName,
      toolCallId: correlationId,
    }, {
      nativeSessionId: parentSessionId || partSessionId,
    });
    if (agentPartId) {
      sessionSubagentState.startedSubagentIds.add(agentPartId);
    }
    return;
  }

  if (part?.type === "subtask") {
    if (partMessageRole === "user") {
      return;
    }

    const subtaskPartId = (part?.id as string) ?? "";
    const subtaskPrompt = (part?.prompt as string) ?? "";
    const subtaskDescription = (part?.description as string) ?? "";
    const subtaskAgent = (part?.agent as string) ?? "";
    const taskToolPartId = context.sessionStateSupport.dequeuePendingTaskToolPartId(sessionSubagentState);
    const correlationId = taskToolPartId ?? subtaskPartId;
    context.debugLog("subagent.start", {
      partType: "subtask",
      subagentId: subtaskPartId,
      subagentType: subtaskAgent,
      toolCallId: correlationId,
      taskToolPartId: taskToolPartId ?? "none",
    });
    sessionSubagentState.pendingAgentParts.push({ partId: subtaskPartId, agentName: subtaskAgent });
    context.emitEvent("subagent.start", parentSessionId || partSessionId, {
      subagentId: subtaskPartId,
      subagentType: subtaskAgent,
      task: subtaskDescription || subtaskPrompt,
      toolCallId: correlationId,
      toolInput: {
        prompt: subtaskPrompt,
        description: subtaskDescription,
        agent: subtaskAgent,
      },
    });
    context.emitProviderEvent("subagent.start", parentSessionId || partSessionId, {
      subagentId: subtaskPartId,
      subagentType: subtaskAgent,
      task: subtaskDescription || subtaskPrompt,
      toolCallId: correlationId,
      toolInput: {
        prompt: subtaskPrompt,
        description: subtaskDescription,
        agent: subtaskAgent,
      },
    }, {
      nativeSessionId: parentSessionId || partSessionId,
    });
    if (subtaskPartId) {
      sessionSubagentState.startedSubagentIds.add(subtaskPartId);
    }
    return;
  }

  if (part?.type !== "step-finish") {
    return;
  }

  const reason = (part?.reason as string) ?? "";
  const finishedPartId = (part?.id as string) ?? "";
  const hasStartedSubagent =
    finishedPartId.length > 0 && sessionSubagentState.startedSubagentIds.has(finishedPartId);

  if (!hasStartedSubagent) {
    context.debugLog("step-finish-ignored", {
      finishedPartId,
      reason,
      info: "step-finish part does not match any known sub-agent; likely a main-turn completion",
    });
    return;
  }

  context.emitEvent("subagent.complete", parentSessionId || partSessionId, {
    subagentId: finishedPartId,
    success: reason !== "error",
    result: reason,
  });
  context.emitProviderEvent("subagent.complete", parentSessionId || partSessionId, {
    subagentId: finishedPartId,
    success: reason !== "error",
    result: reason,
  }, {
    nativeSessionId: parentSessionId || partSessionId,
  });

  sessionSubagentState.startedSubagentIds.delete(finishedPartId);
  sessionSubagentState.subagentToolCounts.delete(finishedPartId);
  for (const [childSid, agentPartId] of sessionSubagentState.childSessionToAgentPart) {
    if (agentPartId === finishedPartId) {
      sessionSubagentState.childSessionToAgentPart.delete(childSid);
      context.childSessionToParentSession.delete(childSid);
      break;
    }
  }
  const pendingIdx = sessionSubagentState.pendingAgentParts.findIndex(
    (pendingPart) => pendingPart.partId === finishedPartId,
  );
  if (pendingIdx !== -1) {
    sessionSubagentState.pendingAgentParts.splice(pendingIdx, 1);
  }
}

function handleOpenCodeToolPart({
  part,
  partSessionId,
  partMessageId,
  parentSessionId,
  sessionSubagentState,
  properties,
  context,
}: OpenCodeToolPartContext): void {
  const toolState = part?.state as Record<string, unknown> | undefined;
  const toolName = (part?.tool as string) ?? "";
  const toolInput = (toolState?.input as Record<string, unknown>) ?? {};
  const toolMetadata = (
    typeof toolState?.metadata === "object"
    && toolState?.metadata !== null
    && !Array.isArray(toolState.metadata)
  )
    ? toolState.metadata as Record<string, unknown>
    : undefined;
  let agentPartId = sessionSubagentState.childSessionToAgentPart.get(partSessionId);

  context.debugLog("tool-part-session-check", {
    toolName,
    partSessionId,
    parentSessionId: parentSessionId || "null",
    propertiesSessionID: (properties?.sessionID as string) ?? "undefined",
    partSessionID: (part?.sessionID as string) ?? "undefined",
    pendingAgentParts: sessionSubagentState.pendingAgentParts.length,
    childSessionAlreadyKnown: sessionSubagentState.childSessionToAgentPart.has(partSessionId),
    toolStatus: (toolState?.status as string) ?? "unknown",
  });

  if (
    partSessionId
    && parentSessionId
    && partSessionId !== parentSessionId
    && !sessionSubagentState.childSessionToAgentPart.has(partSessionId)
  ) {
    const pending = sessionSubagentState.pendingAgentParts.shift();
    if (pending) {
      sessionSubagentState.childSessionToAgentPart.set(partSessionId, pending.partId);
      sessionSubagentState.childSessionToAgentName.set(partSessionId, pending.agentName);
      agentPartId = pending.partId;
      context.childSessionToParentSession.set(partSessionId, parentSessionId);
      context.debugLog("child-session-discovered", {
        childSessionId: partSessionId,
        agentPartId: pending.partId,
        agentName: pending.agentName,
      });
      context.emitEvent("subagent.start", parentSessionId, {
        subagentId: pending.partId,
        subagentType: pending.agentName,
        subagentSessionId: partSessionId,
      });
      context.emitProviderEvent("subagent.start", parentSessionId, {
        subagentId: pending.partId,
        subagentType: pending.agentName,
        subagentSessionId: partSessionId,
      }, {
        nativeSessionId: parentSessionId,
      });
      if (pending.partId) {
        sessionSubagentState.startedSubagentIds.add(pending.partId);
      }
    }
  }

  context.maybeEmitSkillInvokedEvent({
    sessionId: partSessionId,
    toolName,
    toolInput,
    toolUseId: part?.id as string | undefined,
    toolCallId: part?.callID as string | undefined,
  });

  if (toolState?.status === "pending" || toolState?.status === "running") {
    const isTaskTool = toolName === "task" || toolName === "Task";
    const isParentSessionTaskTool = !parentSessionId || partSessionId === parentSessionId;

    if (isTaskTool) {
      const taskPartId = part?.id as string;
      if (taskPartId && isParentSessionTaskTool) {
        context.sessionStateSupport.enqueuePendingTaskToolPartId(sessionSubagentState, taskPartId);
      }
    }

    if (!isTaskTool || isParentSessionTaskTool) {
      context.debugLog("tool.start", {
        toolName,
        toolId: part?.id as string,
        hasToolInput: !!toolInput && Object.keys(toolInput).length > 0,
      });
      context.emitEvent("tool.start", partSessionId, {
        toolName,
        toolInput,
        ...(toolMetadata ? { toolMetadata } : {}),
        toolUseId: part?.id as string,
        toolCallId: part?.callID as string,
        ...(agentPartId ? { parentAgentId: agentPartId } : {}),
      });
      context.emitProviderEvent("tool.start", partSessionId, {
        toolName,
        toolInput,
        ...(toolMetadata ? { toolMetadata } : {}),
        toolUseId: part?.id as string | undefined,
        toolCallId: part?.callID as string | undefined,
        ...(agentPartId ? { parentAgentId: agentPartId } : {}),
        nativeMessageId: partMessageId || undefined,
      }, {
        nativeSessionId: partSessionId,
      });
    }

    if (agentPartId && toolState?.status === "running") {
      const count = (sessionSubagentState.subagentToolCounts.get(agentPartId) ?? 0) + 1;
      sessionSubagentState.subagentToolCounts.set(agentPartId, count);
      context.emitEvent("subagent.update", parentSessionId || partSessionId, {
        subagentId: agentPartId,
        currentTool: toolName,
        toolUses: count,
      });
      context.emitProviderEvent("subagent.update", parentSessionId || partSessionId, {
        subagentId: agentPartId,
        currentTool: toolName,
        toolUses: count,
      }, {
        nativeSessionId: parentSessionId || partSessionId,
      });
    }
    return;
  }

  if (toolState?.status !== "completed" && toolState?.status !== "error") {
    return;
  }

  const isTaskTool = toolName === "task" || toolName === "Task";
  const isParentSessionTaskTool = !parentSessionId || partSessionId === parentSessionId;
  const success = toolState.status === "completed";

  if (!isTaskTool || isParentSessionTaskTool) {
    const toolResult = success
      ? toolState.output
      : toolState.error ?? "Tool execution failed";
    context.emitEvent("tool.complete", partSessionId, {
      toolName,
      toolResult,
      toolInput,
      ...(toolMetadata ? { toolMetadata } : {}),
      success,
      toolUseId: part?.id as string,
      toolCallId: part?.callID as string,
      ...(agentPartId ? { parentAgentId: agentPartId } : {}),
    });
    context.emitProviderEvent("tool.complete", partSessionId, {
      toolName,
      toolResult,
      toolInput,
      ...(toolMetadata ? { toolMetadata } : {}),
      success,
      ...(success
        ? {}
        : {
          error: typeof toolState.error === "string"
            ? toolState.error
            : "Tool execution failed",
        }),
      toolUseId: part?.id as string | undefined,
      toolCallId: part?.callID as string | undefined,
      ...(agentPartId ? { parentAgentId: agentPartId } : {}),
      nativeMessageId: partMessageId || undefined,
    }, {
      nativeSessionId: partSessionId,
    });
  }

  if (!isTaskTool) {
    return;
  }

  const taskPartId = part?.id as string;
  if (taskPartId) {
    context.sessionStateSupport.removePendingTaskToolPartId(sessionSubagentState, taskPartId);
  }
}
