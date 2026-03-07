import { useCallback } from "react";
import type { UseChatStreamCompletionArgs } from "@/state/chat/stream/completion-types.ts";
import { useChatStreamDeferredCompletion } from "@/state/chat/stream/use-deferred-completion.ts";
import { useChatStreamFinalizedCompletion } from "@/state/chat/stream/use-finalized-completion.ts";
import { useChatStreamInterruptedCompletion } from "@/state/chat/stream/use-interrupted-completion.ts";

export function useChatStreamCompletion({
  activeStreamRunIdRef,
  agentType,
  awaitedStreamRunIdsRef,
  continueAssistantStreamInPlaceRef,
  continueQueuedConversationRef,
  currentModelRef,
  deferredCompleteTimeoutRef,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  hasRunningToolRef,
  isAgentOnlyStreamRef,
  lastStreamingContentRef,
  parallelAgentsRef,
  pendingCompleteRef,
  resolveTrackedRun,
  runningAskQuestionToolIdsRef,
  runningBlockingToolIdsRef,
  sendBackgroundMessageToAgent,
  setBackgroundAgentMessageId,
  setLastStreamedMessageId,
  setMessagesWindowed,
  setParallelAgents,
  setToolCompletionVersion,
  shouldHideActiveStreamContent,
  startAssistantStreamRef,
  stopSharedStreamState,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  todoItemsRef,
  toolMessageIdByIdRef,
  toolNameByIdRef,
  wasInterruptedRef,
}: UseChatStreamCompletionArgs) {
  const { finishInterruptedStreamIfNeeded } = useChatStreamInterruptedCompletion({
    continueQueuedConversationRef,
    currentModelRef,
    finalizeThinkingSourceTracking,
    lastStreamingContentRef,
    resolveTrackedRun,
    setMessagesWindowed,
    setParallelAgents,
    stopSharedStreamState,
    wasInterruptedRef,
  });

  const { deferStreamCompletionIfNeeded } = useChatStreamDeferredCompletion({
    deferredCompleteTimeoutRef,
    hasRunningToolRef,
    parallelAgentsRef,
    pendingCompleteRef,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    setMessagesWindowed,
    setToolCompletionVersion,
    streamingMessageIdRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
  });

  const { finalizeCompletedStream } = useChatStreamFinalizedCompletion({
    activeStreamRunIdRef,
    agentType,
    continueAssistantStreamInPlaceRef,
    continueQueuedConversationRef,
    currentModelRef,
    finalizeThinkingSourceTracking,
    isAgentOnlyStreamRef,
    lastStreamingContentRef,
    resolveTrackedRun,
    sendBackgroundMessageToAgent,
    setBackgroundAgentMessageId,
    setMessagesWindowed,
    setParallelAgents,
    startAssistantStreamRef,
    stopSharedStreamState,
    todoItemsRef,
  });

  const handleStreamComplete = useCallback(function handleStreamCompleteImpl() {
    const messageId = streamingMessageIdRef.current;
    if (!messageId) {
      return;
    }

    const streamRunId = getActiveStreamRunId();
    const hideCompletedMessage = shouldHideActiveStreamContent();
    const suppressQueueContinuation = streamRunId !== null && awaitedStreamRunIdsRef.current.has(streamRunId);

    setLastStreamedMessageId(messageId);

    const context = {
      durationMs: streamingStartRef.current
        ? Date.now() - streamingStartRef.current
        : undefined,
      finalMeta: streamingMetaRef.current,
      hideCompletedMessage,
      messageId,
      streamRunId,
      suppressQueueContinuation,
    };

    if (finishInterruptedStreamIfNeeded(context)) {
      return;
    }

    if (deferStreamCompletionIfNeeded({
      ...context,
      handleStreamCompleteImpl,
    })) {
      return;
    }

    finalizeCompletedStream({
      ...context,
      currentAgents: parallelAgentsRef.current,
    });
  }, [
    awaitedStreamRunIdsRef,
    deferStreamCompletionIfNeeded,
    finalizeCompletedStream,
    finishInterruptedStreamIfNeeded,
    getActiveStreamRunId,
    parallelAgentsRef,
    setLastStreamedMessageId,
    shouldHideActiveStreamContent,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
  ]);

  return { handleStreamComplete };
}
