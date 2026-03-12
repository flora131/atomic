import { useBusSubscription } from "@/services/events/hooks.ts";
import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";
import type { ChatMessage, MessageSkillLoad, StreamingMeta } from "@/state/chat/types.ts";
import { STATUS, MISC } from "@/theme/icons.ts";
import {
  createMessage,
  formatSessionTruncationMessage,
  getAutoCompactionIndicatorState,
  shouldBindStreamSessionRun,
  shouldProcessStreamLifecycleEvent,
} from "@/state/chat/helpers.ts";
import {
  normalizeSessionTrackingKey,
  shouldDisplaySkillLoadIndicator,
  shouldResetLoadedSkillsForSessionChange,
  tryTrackLoadedSkill,
} from "@/lib/ui/skill-load-tracking.ts";
import { isLikelyFilePath } from "@/lib/ui/session-info-filters.ts";
import {
  interruptRunningToolCalls,
  interruptRunningToolParts,
  shouldContinueParentSessionLoop,
} from "@/lib/ui/stream-continuation.ts";
import { hasActiveForegroundAgents } from "@/state/parts/index.ts";
import type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";

export function useStreamSessionSubscriptions({
  activeSkillSessionIdRef,
  activeStreamRunIdRef,
  appendSkillLoadIndicator,
  applyAutoCompactionIndicator,
  asSessionLoopFinishReason,
  batchDispatcher,
  handleAskUserQuestion,
  handlePermissionRequest,
  handleStreamComplete,
  handleStreamStartupError,
  hasPendingTaskResultContract,
  hasRunningToolRef,
  isStreamingRef,
  lastStreamedMessageIdRef,
  lastTurnFinishReasonRef,
  loadedSkillsRef,
  nextRunIdFloorRef,
  parallelAgentsRef,
  resetLoadedSkillTracking,
  resolveAgentScopedMessageId,
  runningAskQuestionToolIdsRef,
  runningBlockingToolIdsRef,
  setIsStreaming,
  setMessagesWindowed,
  setParallelAgents,
  setStreamingMeta,
  setToolCompletionVersion,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  toolMessageIdByIdRef,
  toolNameByIdRef,
}: Pick<
  UseStreamSubscriptionsArgs,
  | "activeSkillSessionIdRef"
  | "activeStreamRunIdRef"
  | "appendSkillLoadIndicator"
  | "applyAutoCompactionIndicator"
  | "asSessionLoopFinishReason"
  | "batchDispatcher"
  | "handleAskUserQuestion"
  | "handlePermissionRequest"
  | "handleStreamComplete"
  | "handleStreamStartupError"
  | "hasPendingTaskResultContract"
  | "hasRunningToolRef"
  | "isStreamingRef"
  | "lastStreamedMessageIdRef"
  | "lastTurnFinishReasonRef"
  | "loadedSkillsRef"
  | "nextRunIdFloorRef"
  | "parallelAgentsRef"
  | "resetLoadedSkillTracking"
  | "resolveAgentScopedMessageId"
  | "runningAskQuestionToolIdsRef"
  | "runningBlockingToolIdsRef"
  | "setIsStreaming"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "setStreamingMeta"
  | "setToolCompletionVersion"
  | "streamingMessageIdRef"
  | "streamingMetaRef"
  | "streamingStartRef"
  | "toolMessageIdByIdRef"
  | "toolNameByIdRef"
>): void {
  useBusSubscription("stream.session.start", (event) => {
    const nextSessionId = normalizeSessionTrackingKey(event.sessionId);
    if (shouldResetLoadedSkillsForSessionChange(activeSkillSessionIdRef.current, nextSessionId)) {
      resetLoadedSkillTracking();
    }
    if (nextSessionId) {
      activeSkillSessionIdRef.current = nextSessionId;
    }

    if (!shouldBindStreamSessionRun({
      activeRunId: activeStreamRunIdRef.current,
      eventRunId: event.runId,
      isStreaming: isStreamingRef.current,
      nextRunIdFloor: nextRunIdFloorRef.current,
    })) {
      return;
    }

    activeStreamRunIdRef.current = event.runId;
    nextRunIdFloorRef.current = null;
    lastTurnFinishReasonRef.current = null;
  });

  useBusSubscription("stream.turn.start", (event) => {
    const activeRunId = activeStreamRunIdRef.current;
    if (activeRunId !== null && !shouldProcessStreamLifecycleEvent(activeRunId, event.runId)) {
      return;
    }

    if (activeRunId === null) {
      if (!isStreamingRef.current) {
        return;
      }
      const runFloor = nextRunIdFloorRef.current;
      if (typeof runFloor === "number" && event.runId < runFloor) {
        return;
      }
      activeStreamRunIdRef.current = event.runId;
      nextRunIdFloorRef.current = null;
    }

    if (!isStreamingRef.current) {
      isStreamingRef.current = true;
      setIsStreaming(true);
      if (!streamingStartRef.current) {
        streamingStartRef.current = Date.now();
      }
    }

    lastTurnFinishReasonRef.current = null;
  });

  useBusSubscription("stream.turn.end", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    if (isStreamingRef.current) {
      batchDispatcher.flush();
    }

    lastTurnFinishReasonRef.current = asSessionLoopFinishReason(
      (event.data as Record<string, unknown>).finishReason,
    );
  });

  useBusSubscription("stream.session.idle", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    if (!isStreamingRef.current) {
      return;
    }

    batchDispatcher.flush();

    const idleReason = typeof event.data.reason === "string"
      ? event.data.reason.trim().toLowerCase()
      : "";
    if (idleReason === "aborted") {
      const interruptedToolIds = [...runningBlockingToolIdsRef.current];
      if (interruptedToolIds.length > 0 || hasRunningToolRef.current) {
        hasRunningToolRef.current = false;
        runningBlockingToolIdsRef.current.clear();
        runningAskQuestionToolIdsRef.current.clear();
        for (const toolId of interruptedToolIds) {
          toolNameByIdRef.current.delete(toolId);
          toolMessageIdByIdRef.current.delete(toolId);
        }

        const interruptedMessageId =
          streamingMessageIdRef.current
          ?? lastStreamedMessageIdRef.current;
        if (interruptedMessageId) {
          setMessagesWindowed((prev: ChatMessage[]) =>
            prev.map((msg: ChatMessage) =>
              msg.id === interruptedMessageId
                ? {
                  ...msg,
                  toolCalls: interruptRunningToolCalls(msg.toolCalls),
                  parts: interruptRunningToolParts(msg.parts),
                }
                : msg,
            ),
          );
        }
        setToolCompletionVersion((version) => version + 1);
      }

      const currentAgents = parallelAgentsRef.current;
      const hasActiveAgents = currentAgents.some(
        (agent) =>
          agent.status === "running"
          || agent.status === "pending"
          || agent.status === "background",
      );
      if (hasActiveAgents) {
        const now = Date.now();
        const interruptedAgents = currentAgents.map((agent) => {
          if (
            agent.status !== "running"
            && agent.status !== "pending"
            && agent.status !== "background"
          ) {
            return agent;
          }
          const startedAtMs = new Date(agent.startedAt).getTime();
          return {
            ...agent,
            status: "interrupted" as const,
            currentTool: undefined,
            durationMs: Number.isFinite(startedAtMs)
              ? Math.max(0, now - startedAtMs)
              : agent.durationMs,
          };
        });
        parallelAgentsRef.current = interruptedAgents;
        setParallelAgents(interruptedAgents);
      }

      handleStreamComplete();
      return;
    }

    const continuationSignal = shouldContinueParentSessionLoop({
      finishReason: lastTurnFinishReasonRef.current ?? undefined,
      hasActiveForegroundAgents: hasActiveForegroundAgents(parallelAgentsRef.current),
      hasRunningBlockingTool: hasRunningToolRef.current,
      hasPendingTaskContract: hasPendingTaskResultContract(),
    });

    if (!continuationSignal.shouldContinue) {
      handleStreamComplete();
    }
  });

  useBusSubscription("stream.session.error", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    handleStreamStartupError(new Error(event.data.error));
  });

  useBusSubscription("stream.session.info", (event) => {
    // Lifecycle guard — only process during active stream (defense-in-depth)
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) return;

    const { message, infoType } = event.data;
    if (infoType === "cancellation") return;
    if (infoType === "snapshot") return;
    if (!message) return;
    if (isLikelyFilePath(message.trim())) return;
    setMessagesWindowed((prev) => [
      ...prev,
      createMessage("system", `${STATUS.active} ${message}`),
    ]);
  });

  useBusSubscription("stream.session.warning", (event) => {
    // Lifecycle guard — only process during active stream (defense-in-depth)
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) return;

    const { message } = event.data;
    if (message) {
      setMessagesWindowed((prev) => [
        ...prev,
        createMessage("system", `${MISC.warning} ${message}`),
      ]);
    }
  });

  useBusSubscription("stream.session.title_changed", (event) => {
    const { title } = event.data;
    if (title) {
      process.stdout.write(`\x1b]2;${title}\x07`);
    }
  });

  useBusSubscription("stream.session.truncation", (event) => {
    const { tokensRemoved, messagesRemoved } = event.data;
    setMessagesWindowed((prev) => [
      ...prev,
      createMessage(
        "system",
        formatSessionTruncationMessage(tokensRemoved, messagesRemoved),
      ),
    ]);
  });

  useBusSubscription("stream.session.compaction", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    const { phase, success, error } = event.data;
    applyAutoCompactionIndicator(
      getAutoCompactionIndicatorState(phase, success, error),
    );
  });

  useBusSubscription("stream.usage", (event) => {
    const usageAgentId = event.data.agentId;
    const incoming = event.data.outputTokens ?? 0;

    if (usageAgentId) {
      const scopedMessageId = resolveAgentScopedMessageId(usageAgentId);
      setParallelAgents((current) =>
        current.map((agent) =>
          agent.id === usageAgentId
            ? {
              ...agent,
              tokens: incoming > 0
                ? Math.max(agent.tokens ?? 0, incoming)
                : agent.tokens,
            }
            : agent,
        ),
      );

      if (scopedMessageId && incoming > 0) {
        setMessagesWindowed((prev: ChatMessage[]) =>
          prev.map((msg: ChatMessage) =>
            msg.id === scopedMessageId
              ? { ...msg, outputTokens: Math.max(msg.outputTokens ?? 0, incoming) }
              : msg,
          ),
        );
      }
      return;
    }

    const prevMeta = streamingMetaRef.current ?? {
      outputTokens: 0,
      thinkingMs: 0,
      thinkingText: "",
    };
    const nextMeta: StreamingMeta = {
      ...prevMeta,
      outputTokens: Math.max(prevMeta.outputTokens, incoming > 0 ? incoming : 0),
    };
    streamingMetaRef.current = nextMeta;
    setStreamingMeta(nextMeta);

    const messageId = resolveAgentScopedMessageId();
    if (messageId && nextMeta.outputTokens > 0) {
      setMessagesWindowed((prev: ChatMessage[]) =>
        prev.map((msg: ChatMessage) =>
          msg.id === messageId ? { ...msg, outputTokens: nextMeta.outputTokens } : msg,
        ),
      );
    }
  });

  useBusSubscription("stream.thinking.complete", (event) => {
    const thinkingAgentId = event.data.agentId;

    if (thinkingAgentId) {
      const scopedMessageId = resolveAgentScopedMessageId(thinkingAgentId);
      setParallelAgents((current) =>
        current.map((agent) =>
          agent.id === thinkingAgentId
            ? {
              ...agent,
              thinkingMs: Math.max(agent.thinkingMs ?? 0, event.data.durationMs),
            }
            : agent,
        ),
      );

      if (scopedMessageId && event.data.durationMs > 0) {
        setMessagesWindowed((prev: ChatMessage[]) =>
          prev.map((msg: ChatMessage) =>
            msg.id === scopedMessageId
              ? { ...msg, thinkingMs: Math.max(msg.thinkingMs ?? 0, event.data.durationMs) }
              : msg,
          ),
        );
      }
      return;
    }

    const prevMeta = streamingMetaRef.current ?? {
      outputTokens: 0,
      thinkingMs: 0,
      thinkingText: "",
    };
    const nextMeta: StreamingMeta = {
      ...prevMeta,
      thinkingMs: Math.max(prevMeta.thinkingMs, event.data.durationMs),
    };
    streamingMetaRef.current = nextMeta;
    setStreamingMeta(nextMeta);

    const messageId = resolveAgentScopedMessageId();
    if (messageId && nextMeta.thinkingMs > 0) {
      setMessagesWindowed((prev: ChatMessage[]) =>
        prev.map((msg: ChatMessage) =>
          msg.id === messageId ? { ...msg, thinkingMs: nextMeta.thinkingMs } : msg,
        ),
      );
    }
  });

  useBusSubscription("stream.permission.requested", (event) => {
    const data = event.data;
    handlePermissionRequest(
      data.requestId,
      data.toolName,
      data.question,
      data.options,
      data.respond ?? (() => {}),
      data.header,
      data.toolCallId,
    );
  });

  useBusSubscription("stream.human_input_required", (event) => {
    const data = event.data;
    const askEvent: AskUserQuestionEventData = {
      requestId: data.requestId,
      question: data.question,
      header: data.header,
      options: data.options,
      nodeId: data.nodeId,
      respond: data.respond as ((answer: string | string[]) => void) | undefined,
      toolCallId: data.toolCallId,
    };
    handleAskUserQuestion(askEvent);
  });

  useBusSubscription("stream.skill.invoked", (event) => {
    const { skillName, agentId } = event.data;
    if (!shouldDisplaySkillLoadIndicator(agentId)) {
      return;
    }
    if (!tryTrackLoadedSkill(loadedSkillsRef.current, skillName)) {
      return;
    }

    const skillLoad: MessageSkillLoad = {
      skillName,
      status: "loaded",
    };
    appendSkillLoadIndicator(skillLoad);
  });
}
