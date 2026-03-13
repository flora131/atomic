import { useCallback } from "react";
import { finalizeStreamingReasoningInMessage } from "@/state/parts/index.ts";
import type {
  StreamCompletionContext,
  UseChatStreamCompletionArgs,
} from "@/state/chat/stream/completion-types.ts";

type UseChatStreamInterruptedCompletionArgs = Pick<
  UseChatStreamCompletionArgs,
  | "activeBackgroundAgentCountRef"
  | "continueQueuedConversationRef"
  | "currentModelRef"
  | "finalizeThinkingSourceTracking"
  | "lastStreamingContentRef"
  | "resolveTrackedRun"
  | "setActiveBackgroundAgentCount"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "stopSharedStreamState"
  | "wasInterruptedRef"
>;

export function useChatStreamInterruptedCompletion({
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
}: UseChatStreamInterruptedCompletionArgs) {
  const finishInterruptedStreamIfNeeded = useCallback((context: StreamCompletionContext): boolean => {
    if (!wasInterruptedRef.current) {
      return false;
    }

    wasInterruptedRef.current = false;
    setMessagesWindowed((prev) =>
      prev.map((msg) =>
        msg.id === context.messageId
          ? {
            ...finalizeStreamingReasoningInMessage(msg),
            streaming: false,
            durationMs: context.durationMs,
            modelId: currentModelRef.current,
            outputTokens: context.finalMeta?.outputTokens || msg.outputTokens,
            thinkingMs: context.finalMeta?.thinkingMs || msg.thinkingMs,
            thinkingText: context.finalMeta?.thinkingText || msg.thinkingText || undefined,
          }
          : msg,
      ),
    );
    setParallelAgents([]);

    if (activeBackgroundAgentCountRef.current !== 0) {
      activeBackgroundAgentCountRef.current = 0;
      setActiveBackgroundAgentCount(0);
    }

    stopSharedStreamState();
    finalizeThinkingSourceTracking();

    resolveTrackedRun("interrupt", {
      content: lastStreamingContentRef.current,
      wasInterrupted: true,
    }, { runId: context.streamRunId });
    if (context.hideCompletedMessage) {
      setMessagesWindowed((prev) => prev.filter((msg) => msg.id !== context.messageId));
    }
    if (!context.suppressQueueContinuation) {
      continueQueuedConversationRef.current();
    }
    return true;
  }, [
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
  ]);

  return { finishInterruptedStreamIfNeeded };
}
