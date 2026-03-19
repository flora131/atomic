import { useCallback } from "react";
import type { UseChatStreamCompletionArgs } from "@/state/chat/stream/completion-types.ts";
import { useChatStreamDeferredCompletion } from "@/state/chat/stream/use-deferred-completion.ts";
import { useChatStreamFinalizedCompletion } from "@/state/chat/stream/use-finalized-completion.ts";
import { useChatStreamInterruptedCompletion } from "@/state/chat/stream/use-interrupted-completion.ts";

export function useChatStreamCompletion({
  activeBackgroundAgentCountRef,
  awaitedStreamRunIdsRef,
  continueQueuedConversationRef,
  currentModelRef,
  deferredCompleteTimeoutRef,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  hasRunningToolRef,
  lastStreamingContentRef,
  parallelAgentsRef,
  pendingCompleteRef,
  resolveTrackedRun,
  runningAskQuestionToolIdsRef,
  runningBlockingToolIdsRef,
  setBackgroundAgentMessageId,
  setActiveBackgroundAgentCount,
  setLastStreamedMessageId,
  setMessagesWindowed,
  setParallelAgents,
  setToolCompletionVersion,
  shouldHideActiveStreamContent,
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
    activeBackgroundAgentCountRef,
    continueQueuedConversationRef,
    currentModelRef,
    finalizeThinkingSourceTracking,
    lastStreamingContentRef,
    resolveTrackedRun,
    setActiveBackgroundAgentCount,
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
    activeBackgroundAgentCountRef,
    continueQueuedConversationRef,
    currentModelRef,
    finalizeThinkingSourceTracking,
    lastStreamingContentRef,
    parallelAgentsRef,
    resolveTrackedRun,
    setActiveBackgroundAgentCount,
    setBackgroundAgentMessageId,
    setMessagesWindowed,
    setParallelAgents,
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
