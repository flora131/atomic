import { useCallback } from "react";
import {
  finalizeStreamingReasoningInMessage,
} from "@/state/parts/index.ts";
import { createMessage } from "@/state/chat/shared/helpers/index.ts";
import type { UseChatStreamLifecycleArgs } from "@/state/chat/stream/lifecycle-types.ts";

type UseChatStreamStartupArgs = Pick<
  UseChatStreamLifecycleArgs,
  | "activeBackgroundAgentCountRef"
  | "activeStreamRunIdRef"
  | "bindTrackedRunToMessage"
  | "clearDeferredCompletion"
  | "hasRunningToolRef"
  | "isAgentOnlyStreamRef"
  | "isStreamingRef"
  | "lastStreamingContentRef"
  | "lastTurnFinishReasonRef"
  | "nextRunIdFloorRef"
  | "onStreamMessage"
  | "parallelAgentsRef"
  | "resetConsumers"
  | "resetThinkingSourceTracking"
  | "resetTodoItemsForNewStream"
  | "runningAskQuestionToolIdsRef"
  | "runningBlockingToolIdsRef"
  | "setActiveBackgroundAgentCount"
  | "setIsStreaming"
  | "setLastStreamedMessageId"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "setStreamingMessageId"
  | "startTrackedAssistantRun"
  | "streamingStartRef"
  | "toolMessageIdByIdRef"
  | "toolNameByIdRef"
> & {
  handleStreamStartupError: (error: unknown) => void;
};

function clearStreamBootstrapState({
  activeStreamRunIdRef,
  clearDeferredCompletion,
  hasRunningToolRef,
  isAgentOnlyStreamRef,
  isStreamingRef,
  lastStreamingContentRef,
  lastTurnFinishReasonRef,
  nextRunIdFloorRef,
  resetConsumers,
  resetThinkingSourceTracking,
  resetTodoItemsForNewStream,
  runningAskQuestionToolIdsRef,
  runningBlockingToolIdsRef,
  setIsStreaming,
  setLastStreamedMessageId,
  streamingStartRef,
  toolMessageIdByIdRef,
  toolNameByIdRef,
}: {
  activeStreamRunIdRef: UseChatStreamLifecycleArgs["activeStreamRunIdRef"];
  clearDeferredCompletion: UseChatStreamLifecycleArgs["clearDeferredCompletion"];
  hasRunningToolRef: UseChatStreamLifecycleArgs["hasRunningToolRef"];
  isAgentOnlyStreamRef: UseChatStreamLifecycleArgs["isAgentOnlyStreamRef"];
  isStreamingRef: UseChatStreamLifecycleArgs["isStreamingRef"];
  lastStreamingContentRef: UseChatStreamLifecycleArgs["lastStreamingContentRef"];
  lastTurnFinishReasonRef?: UseChatStreamLifecycleArgs["lastTurnFinishReasonRef"];
  nextRunIdFloorRef: UseChatStreamLifecycleArgs["nextRunIdFloorRef"];
  resetConsumers: UseChatStreamLifecycleArgs["resetConsumers"];
  resetThinkingSourceTracking: UseChatStreamLifecycleArgs["resetThinkingSourceTracking"];
  resetTodoItemsForNewStream: UseChatStreamLifecycleArgs["resetTodoItemsForNewStream"];
  runningAskQuestionToolIdsRef: UseChatStreamLifecycleArgs["runningAskQuestionToolIdsRef"];
  runningBlockingToolIdsRef: UseChatStreamLifecycleArgs["runningBlockingToolIdsRef"];
  setIsStreaming: UseChatStreamLifecycleArgs["setIsStreaming"];
  setLastStreamedMessageId: UseChatStreamLifecycleArgs["setLastStreamedMessageId"];
  streamingStartRef: UseChatStreamLifecycleArgs["streamingStartRef"];
  toolMessageIdByIdRef: UseChatStreamLifecycleArgs["toolMessageIdByIdRef"];
  toolNameByIdRef: UseChatStreamLifecycleArgs["toolNameByIdRef"];
}) {
  isStreamingRef.current = true;
  setIsStreaming(true);
  streamingStartRef.current = Date.now();
  const previousRunId = activeStreamRunIdRef.current;
  nextRunIdFloorRef.current = typeof previousRunId === "number"
    ? previousRunId + 1
    : null;
  activeStreamRunIdRef.current = null;
  if (lastTurnFinishReasonRef) {
    lastTurnFinishReasonRef.current = null;
  }
  setLastStreamedMessageId(null);
  resetThinkingSourceTracking();
  resetTodoItemsForNewStream();
  lastStreamingContentRef.current = "";
  hasRunningToolRef.current = false;
  runningBlockingToolIdsRef.current.clear();
  runningAskQuestionToolIdsRef.current.clear();
  toolNameByIdRef.current.clear();
  toolMessageIdByIdRef.current.clear();
  clearDeferredCompletion();
  resetConsumers();
  if (isAgentOnlyStreamRef) {
    isAgentOnlyStreamRef.current = false;
  }
}

export function useChatStreamStartup({
  activeBackgroundAgentCountRef,
  activeStreamRunIdRef,
  bindTrackedRunToMessage,
  clearDeferredCompletion,
  handleStreamStartupError,
  hasRunningToolRef,
  isAgentOnlyStreamRef,
  isStreamingRef,
  lastStreamingContentRef,
  lastTurnFinishReasonRef,
  nextRunIdFloorRef,
  onStreamMessage,
  parallelAgentsRef,
  resetConsumers,
  resetThinkingSourceTracking,
  resetTodoItemsForNewStream,
  runningAskQuestionToolIdsRef,
  runningBlockingToolIdsRef,
  setActiveBackgroundAgentCount,
  setIsStreaming,
  setLastStreamedMessageId,
  setMessagesWindowed,
  setParallelAgents,
  setStreamingMessageId,
  startTrackedAssistantRun,
  streamingStartRef,
  toolMessageIdByIdRef,
  toolNameByIdRef,
}: UseChatStreamStartupArgs) {
  const startAssistantStream = useCallback((
    content: string,
    options?: import("@/commands/tui/registry.ts").StreamMessageOptions,
  ) => {
    if (!onStreamMessage) return null;

    clearStreamBootstrapState({
      activeStreamRunIdRef,
      clearDeferredCompletion,
      hasRunningToolRef,
      isAgentOnlyStreamRef,
      isStreamingRef,
      lastStreamingContentRef,
      nextRunIdFloorRef,
      resetConsumers,
      resetThinkingSourceTracking,
      resetTodoItemsForNewStream,
      runningAskQuestionToolIdsRef,
      runningBlockingToolIdsRef,
      setIsStreaming,
      setLastStreamedMessageId,
      streamingStartRef,
      toolMessageIdByIdRef,
      toolNameByIdRef,
    });

    // Clear stale parallel agents from the previous stream so they don't
    // bleed into the new message's rendering (e.g. an interrupted background
    // agent from a prior turn showing in the current turn's agent tree).
    parallelAgentsRef.current = [];
    setParallelAgents([]);
    activeBackgroundAgentCountRef.current = 0;
    setActiveBackgroundAgentCount(0);

    const runHandle = startTrackedAssistantRun(options);
    const assistantMessage = createMessage("assistant", "", true);
    setStreamingMessageId(assistantMessage.id);
    bindTrackedRunToMessage(runHandle.runId, assistantMessage.id);
    isAgentOnlyStreamRef.current = options?.isAgentOnlyStream ?? false;
    setMessagesWindowed((prev) => [...prev, assistantMessage]);

    void Promise.resolve(onStreamMessage(content, options)).catch((error) => {
      handleStreamStartupError(error);
    });
    return runHandle;
  }, [
    activeBackgroundAgentCountRef,
    activeStreamRunIdRef,
    bindTrackedRunToMessage,
    clearDeferredCompletion,
    handleStreamStartupError,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreamingRef,
    lastStreamingContentRef,
    nextRunIdFloorRef,
    onStreamMessage,
    parallelAgentsRef,
    resetConsumers,
    resetThinkingSourceTracking,
    resetTodoItemsForNewStream,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    setActiveBackgroundAgentCount,
    setIsStreaming,
    setLastStreamedMessageId,
    setMessagesWindowed,
    setParallelAgents,
    setStreamingMessageId,
    startTrackedAssistantRun,
    streamingStartRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
  ]);

  const continueAssistantStreamInPlace = useCallback((
    messageId: string,
    content: string,
  ) => {
    if (!onStreamMessage) return null;

    clearStreamBootstrapState({
      activeStreamRunIdRef,
      clearDeferredCompletion,
      hasRunningToolRef,
      isAgentOnlyStreamRef,
      isStreamingRef,
      lastStreamingContentRef,
      lastTurnFinishReasonRef,
      nextRunIdFloorRef,
      resetConsumers,
      resetThinkingSourceTracking,
      resetTodoItemsForNewStream,
      runningAskQuestionToolIdsRef,
      runningBlockingToolIdsRef,
      setIsStreaming,
      setLastStreamedMessageId,
      streamingStartRef,
      toolMessageIdByIdRef,
      toolNameByIdRef,
    });

    const runHandle = startTrackedAssistantRun({ visibility: "visible", runKind: "foreground" });
    bindTrackedRunToMessage(runHandle.runId, messageId);

    setMessagesWindowed((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
            ...finalizeStreamingReasoningInMessage(msg),
            streaming: true,
            completedAt: undefined,
            durationMs: undefined,
          }
          : msg,
      ),
    );

    void Promise.resolve(onStreamMessage(content)).catch((error) => {
      handleStreamStartupError(error);
    });
    return runHandle;
  }, [
    activeStreamRunIdRef,
    bindTrackedRunToMessage,
    clearDeferredCompletion,
    handleStreamStartupError,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreamingRef,
    lastStreamingContentRef,
    lastTurnFinishReasonRef,
    nextRunIdFloorRef,
    onStreamMessage,
    resetConsumers,
    resetThinkingSourceTracking,
    resetTodoItemsForNewStream,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    setIsStreaming,
    setLastStreamedMessageId,
    setMessagesWindowed,
    startTrackedAssistantRun,
    streamingStartRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
  ]);

  return {
    continueAssistantStreamInPlace,
    startAssistantStream,
  };
}
