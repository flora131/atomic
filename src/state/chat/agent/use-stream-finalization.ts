import { useEffect } from "react";
import {
  finalizeStreamingReasoningInMessage,
  shouldFinalizeDeferredStream,
} from "@/state/parts/index.ts";
import {
  getActiveBackgroundAgents,
} from "@/lib/ui/background-agent-footer.ts";
import {
  buildAgentContinuationPayload,
  emitAgentMainContinuationObservability,
  shouldFinalizeAgentOnlyStream,
} from "@/state/chat/helpers.ts";
import { snapshotTaskItems } from "@/lib/ui/workflow-task-state.ts";
import type { TaskItem } from "@/state/chat/types.ts";
import type { UseChatAgentProjectionArgs } from "@/state/chat/agent/projection-types.ts";

type UseChatAgentStreamFinalizationArgs = Pick<
  UseChatAgentProjectionArgs,
  | "activeStreamRunIdRef"
  | "agentType"
  | "awaitedStreamRunIdsRef"
  | "continueAssistantStreamInPlaceRef"
  | "continueQueuedConversation"
  | "deferredCompleteTimeoutRef"
  | "finalizeThinkingSourceTracking"
  | "getActiveStreamRunId"
  | "hasRunningToolRef"
  | "isAgentOnlyStreamRef"
  | "isStreamingRef"
  | "lastStreamingContentRef"
  | "messages"
  | "parallelAgents"
  | "parallelAgentsRef"
  | "pendingCompleteRef"
  | "resolveTrackedRun"
  | "sendBackgroundMessageToAgent"
  | "setBackgroundAgentMessageId"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "startAssistantStreamRef"
  | "stopSharedStreamState"
  | "streamingMessageIdRef"
  | "streamingStartRef"
  | "todoItemsRef"
  | "toolCompletionVersion"
>;

export function useChatAgentStreamFinalization({
  activeStreamRunIdRef,
  agentType,
  awaitedStreamRunIdsRef,
  continueAssistantStreamInPlaceRef,
  continueQueuedConversation,
  deferredCompleteTimeoutRef,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  hasRunningToolRef,
  isAgentOnlyStreamRef,
  isStreamingRef,
  lastStreamingContentRef,
  messages,
  parallelAgents,
  parallelAgentsRef,
  pendingCompleteRef,
  resolveTrackedRun,
  sendBackgroundMessageToAgent,
  setBackgroundAgentMessageId,
  setMessagesWindowed,
  setParallelAgents,
  startAssistantStreamRef,
  stopSharedStreamState,
  streamingMessageIdRef,
  streamingStartRef,
  todoItemsRef,
  toolCompletionVersion,
}: UseChatAgentStreamFinalizationArgs) {
  useEffect(() => {
    const canFinalizeDeferred = shouldFinalizeDeferredStream(parallelAgents, hasRunningToolRef.current);
    if (!canFinalizeDeferred) {
      if (deferredCompleteTimeoutRef.current) {
        clearTimeout(deferredCompleteTimeoutRef.current);
        deferredCompleteTimeoutRef.current = null;
      }
      return;
    }

    if (pendingCompleteRef.current) {
      if (deferredCompleteTimeoutRef.current) return;
      const pendingComplete = pendingCompleteRef.current;
      deferredCompleteTimeoutRef.current = setTimeout(() => {
        deferredCompleteTimeoutRef.current = null;
        if (pendingCompleteRef.current !== pendingComplete) return;
        if (!shouldFinalizeDeferredStream(parallelAgentsRef.current, hasRunningToolRef.current)) return;
        pendingCompleteRef.current = null;
        pendingComplete();
      }, 0);
      return;
    }

    const messageId = streamingMessageIdRef.current;
    const messageAgents = messageId ? (messages.find((m) => m.id === messageId)?.parallelAgents ?? []) : [];
    if (!shouldFinalizeAgentOnlyStream({
      hasStreamingMessage: Boolean(messageId),
      isStreaming: isStreamingRef.current,
      isAgentOnlyStream: isAgentOnlyStreamRef.current,
      liveAgentCount: parallelAgents.length,
      messageAgentCount: messageAgents.length,
    })) {
      return;
    }

    const streamRunId = getActiveStreamRunId();
    const suppressQueueContinuation =
      streamRunId !== null && awaitedStreamRunIdsRef.current.has(streamRunId);
    const durationMs = streamingStartRef.current
      ? Date.now() - streamingStartRef.current
      : undefined;
    const sourceAgents = parallelAgents.length > 0 ? parallelAgents : messageAgents;
    const finalizedAgents = sourceAgents.map((agent) =>
      agent.background
        ? agent
        : agent.status === "running" || agent.status === "pending"
          ? {
            ...agent,
            status: "completed" as const,
            currentTool: undefined,
            durationMs: Date.now() - new Date(agent.startedAt).getTime(),
          }
          : agent,
    );

    const agentContinuationPayload = buildAgentContinuationPayload({
      agents: finalizedAgents,
      fallbackText: lastStreamingContentRef.current,
    });

    setMessagesWindowed((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
            ...finalizeStreamingReasoningInMessage(msg),
            content: msg.content,
            streaming: false,
            completedAt: new Date(),
            durationMs,
            parallelAgents: finalizedAgents,
            taskItems: snapshotTaskItems(todoItemsRef.current) as TaskItem[] | undefined,
          }
          : msg,
      ),
    );

    const remainingBg = getActiveBackgroundAgents(parallelAgents);
    resolveTrackedRun("complete", {
      content: lastStreamingContentRef.current,
      wasInterrupted: false,
    }, { runId: streamRunId });

    if (agentContinuationPayload) {
      emitAgentMainContinuationObservability({
        provider: agentType,
        runId: activeStreamRunIdRef.current ?? undefined,
        result: "forwarded",
      });

      if (remainingBg.length > 0 && messageId) {
        setBackgroundAgentMessageId(messageId);
        setParallelAgents(remainingBg);
        parallelAgentsRef.current = remainingBg;
      } else {
        setParallelAgents([]);
        parallelAgentsRef.current = [];
      }

      if (messageId) {
        const dispatchAgentContinuationInPlace = continueAssistantStreamInPlaceRef.current;
        if (dispatchAgentContinuationInPlace) {
          dispatchAgentContinuationInPlace(messageId, agentContinuationPayload);
          return;
        }
      }

      const dispatchAgentContinuation = startAssistantStreamRef.current;
      if (dispatchAgentContinuation) {
        dispatchAgentContinuation(agentContinuationPayload);
        return;
      }

      stopSharedStreamState();
      finalizeThinkingSourceTracking();
      sendBackgroundMessageToAgent(agentContinuationPayload);
      if (!suppressQueueContinuation) {
        continueQueuedConversation();
      }
      return;
    }

    if (remainingBg.length > 0 && messageId) {
      stopSharedStreamState({
        preserveStreamingStart: true,
        preserveStreamingMeta: true,
      });
      finalizeThinkingSourceTracking({ preserveStreamingMeta: true });
      setBackgroundAgentMessageId(messageId);
      setParallelAgents(remainingBg);
      parallelAgentsRef.current = remainingBg;
    } else {
      stopSharedStreamState();
      finalizeThinkingSourceTracking();
      setParallelAgents([]);
      parallelAgentsRef.current = [];
    }

    if (!suppressQueueContinuation) {
      continueQueuedConversation();
    }
  }, [
    activeStreamRunIdRef,
    agentType,
    awaitedStreamRunIdsRef,
    continueAssistantStreamInPlaceRef,
    continueQueuedConversation,
    deferredCompleteTimeoutRef,
    finalizeThinkingSourceTracking,
    getActiveStreamRunId,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreamingRef,
    lastStreamingContentRef,
    messages,
    parallelAgents,
    parallelAgentsRef,
    pendingCompleteRef,
    resolveTrackedRun,
    sendBackgroundMessageToAgent,
    setBackgroundAgentMessageId,
    setMessagesWindowed,
    setParallelAgents,
    startAssistantStreamRef,
    stopSharedStreamState,
    streamingMessageIdRef,
    streamingStartRef,
    todoItemsRef,
    toolCompletionVersion,
  ]);
}
