import { useCallback } from "react";
import { formatAgentLifecycleViolation } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import { finalizeStreamingReasoningInMessage } from "@/state/parts/index.ts";
import { createMessage } from "@/state/chat/helpers.ts";
import type { UseChatStreamLifecycleArgs } from "@/state/chat/stream/lifecycle-types.ts";

type UseChatStreamErrorsArgs = Pick<
  UseChatStreamLifecycleArgs,
  | "continueQueuedConversationRef"
  | "currentModelRef"
  | "finalizeThinkingSourceTracking"
  | "lastStreamingContentRef"
  | "resolveTrackedRun"
  | "setMessagesWindowed"
  | "stopSharedStreamState"
  | "streamingMessageIdRef"
>;

export function useChatStreamErrors({
  continueQueuedConversationRef,
  currentModelRef,
  finalizeThinkingSourceTracking,
  lastStreamingContentRef,
  resolveTrackedRun,
  setMessagesWindowed,
  stopSharedStreamState,
  streamingMessageIdRef,
}: UseChatStreamErrorsArgs) {
  const handleStreamStartupError = useCallback((error: unknown) => {
    console.error("[stream] Failed to start stream:", error);
    const errorMessage = error instanceof Error ? error.message : String(error ?? "Unknown error");

    const failedMessageId = streamingMessageIdRef.current;
    if (failedMessageId) {
      setMessagesWindowed((prev) => {
        const failedMessage = prev.find((msg) => msg.id === failedMessageId);
        if (!failedMessage) {
          return prev;
        }

        if (failedMessage.content.trim().length === 0) {
          return prev.filter((msg) => msg.id !== failedMessageId);
        }

        return prev.map((msg) =>
          msg.id === failedMessageId
            ? { ...finalizeStreamingReasoningInMessage(msg), streaming: false, modelId: currentModelRef.current }
            : msg,
        );
      });
    }

    stopSharedStreamState();
    finalizeThinkingSourceTracking();

    setMessagesWindowed((prev) => [
      ...prev,
      createMessage("system", `[error] ${errorMessage}`),
    ]);

    const result = resolveTrackedRun("fail", {
      content: lastStreamingContentRef.current,
      wasInterrupted: true,
    });
    if (!result) {
      continueQueuedConversationRef.current();
    }
  }, [
    continueQueuedConversationRef,
    currentModelRef,
    finalizeThinkingSourceTracking,
    lastStreamingContentRef,
    resolveTrackedRun,
    setMessagesWindowed,
    stopSharedStreamState,
    streamingMessageIdRef,
  ]);

  const terminateStreamWithError = useCallback((errorMessage: string) => {
    stopSharedStreamState();
    finalizeThinkingSourceTracking();
    setMessagesWindowed((prev) => [
      ...prev,
      createMessage("system", `[error] ${errorMessage}`),
    ]);

    const result = resolveTrackedRun("fail", {
      content: lastStreamingContentRef.current,
      wasInterrupted: true,
    });
    if (!result) {
      continueQueuedConversationRef.current();
    }
  }, [
    continueQueuedConversationRef,
    finalizeThinkingSourceTracking,
    lastStreamingContentRef,
    resolveTrackedRun,
    setMessagesWindowed,
    stopSharedStreamState,
  ]);

  const terminateAgentLifecycleContractViolation = useCallback((args: {
    code: import("@/state/chat/shared/helpers/agent-lifecycle-ledger.ts").AgentLifecycleViolationCode;
    eventType: "stream.agent.start" | "stream.agent.update" | "stream.agent.complete";
    agentId: string;
  }) => {
    terminateStreamWithError(formatAgentLifecycleViolation(args));
  }, [terminateStreamWithError]);

  return {
    handleStreamStartupError,
    terminateAgentLifecycleContractViolation,
  };
}
