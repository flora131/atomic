import { useCallback } from "react";
import { snapshotTaskItems } from "@/lib/ui/workflow-task-state.ts";
import { getActiveBackgroundAgents } from "@/lib/ui/background-agent-footer.ts";
import {
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
} from "@/state/parts/index.ts";
import {
  buildAgentContinuationPayload,
  emitAgentMainContinuationObservability,
} from "@/state/chat/helpers.ts";
import type { TaskItem } from "@/state/chat/types.ts";
import type {
  FinalizedStreamCompletionContext,
  UseChatStreamCompletionArgs,
} from "@/state/chat/stream/completion-types.ts";
import { interruptRunningToolCalls, interruptRunningToolParts } from "@/lib/ui/stream-continuation.ts";

type UseChatStreamFinalizedCompletionArgs = Pick<
  UseChatStreamCompletionArgs,
  | "activeStreamRunIdRef"
  | "agentType"
  | "continueAssistantStreamInPlaceRef"
  | "continueQueuedConversationRef"
  | "currentModelRef"
  | "finalizeThinkingSourceTracking"
  | "isAgentOnlyStreamRef"
  | "lastStreamingContentRef"
  | "resolveTrackedRun"
  | "sendBackgroundMessageToAgent"
  | "setBackgroundAgentMessageId"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "startAssistantStreamRef"
  | "stopSharedStreamState"
  | "todoItemsRef"
>;

export function useChatStreamFinalizedCompletion({
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
}: UseChatStreamFinalizedCompletionArgs) {
  const finalizeCompletedStream = useCallback((context: FinalizedStreamCompletionContext) => {
    const agentContinuationPayload = isAgentOnlyStreamRef.current
      ? buildAgentContinuationPayload({
        agents: context.currentAgents,
        fallbackText: lastStreamingContentRef.current,
      })
      : null;
    const remaining = getActiveBackgroundAgents(context.currentAgents);
    if (remaining.length > 0) {
      setBackgroundAgentMessageId(context.messageId);
    }

    setMessagesWindowed((prev) => {
      const existingAgentIds = new Set<string>();
      const targetMessage = prev.find((message) => message.id === context.messageId);
      if (targetMessage?.parallelAgents) {
        for (const agent of targetMessage.parallelAgents) {
          existingAgentIds.add(agent.id);
        }
      }

      const finalizedAgents = context.currentAgents.length > 0
        ? context.currentAgents
          .filter((agent) => existingAgentIds.has(agent.id))
          .map((agent) => {
            if (agent.background) return agent;
            return agent.status === "running" || agent.status === "pending"
              ? {
                ...agent,
                status: "completed" as const,
                currentTool: undefined,
                durationMs: Date.now() - new Date(agent.startedAt).getTime(),
              }
              : agent;
          })
        : undefined;

      return prev.map((msg) =>
        msg.id === context.messageId
          ? {
            ...finalizeStreamingReasoningInMessage(msg),
            streaming: false,
            durationMs: context.durationMs,
            modelId: currentModelRef.current,
            outputTokens: context.finalMeta?.outputTokens || msg.outputTokens,
            thinkingMs: context.finalMeta?.thinkingMs || msg.thinkingMs,
            thinkingText: context.finalMeta?.thinkingText || msg.thinkingText || undefined,
            toolCalls: interruptRunningToolCalls(msg.toolCalls),
            parts: interruptRunningToolParts(
              finalizeStreamingReasoningParts(msg.parts ?? [], context.finalMeta?.thinkingMs || msg.thinkingMs),
            ),
            parallelAgents: finalizedAgents,
            taskItems: snapshotTaskItems(todoItemsRef.current) as TaskItem[] | undefined,
          }
          : msg,
      );
    });

    setParallelAgents(remaining);

    const hasRemainingBackgroundAgents = remaining.length > 0;
    resolveTrackedRun("complete", {
      content: lastStreamingContentRef.current,
      wasInterrupted: false,
    }, { runId: context.streamRunId });
    if (context.hideCompletedMessage) {
      setMessagesWindowed((prev) => prev.filter((msg) => msg.id !== context.messageId));
    }

    if (agentContinuationPayload) {
      emitAgentMainContinuationObservability({
        provider: agentType,
        runId: activeStreamRunIdRef.current ?? undefined,
        result: "forwarded",
      });

      const dispatchAgentContinuationInPlace = continueAssistantStreamInPlaceRef.current;
      if (dispatchAgentContinuationInPlace) {
        dispatchAgentContinuationInPlace(context.messageId, agentContinuationPayload);
        return;
      }

      const dispatchAgentContinuation = startAssistantStreamRef.current;
      if (dispatchAgentContinuation) {
        dispatchAgentContinuation(agentContinuationPayload);
        return;
      }

      stopSharedStreamState();
      finalizeThinkingSourceTracking();
      sendBackgroundMessageToAgent(agentContinuationPayload);
      continueQueuedConversationRef.current();
      return;
    }

    stopSharedStreamState({
      preserveStreamingStart: hasRemainingBackgroundAgents,
      preserveStreamingMeta: hasRemainingBackgroundAgents,
    });
    finalizeThinkingSourceTracking({ preserveStreamingMeta: hasRemainingBackgroundAgents });

    if (!context.suppressQueueContinuation) {
      continueQueuedConversationRef.current();
    }
  }, [
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
  ]);

  return { finalizeCompletedStream };
}
