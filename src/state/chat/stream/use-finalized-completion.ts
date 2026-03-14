import { useCallback } from "react";
import { snapshotTaskItems } from "@/state/chat/shared/helpers/workflow-task-state.ts";
import { getActiveBackgroundAgents } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import {
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
} from "@/state/parts/index.ts";
import type { TaskItem } from "@/state/chat/shared/types/index.ts";
import type {
  FinalizedStreamCompletionContext,
  UseChatStreamCompletionArgs,
} from "@/state/chat/stream/completion-types.ts";
import { interruptRunningToolCalls, interruptRunningToolParts } from "@/state/chat/shared/helpers/stream-continuation.ts";

type UseChatStreamFinalizedCompletionArgs = Pick<
  UseChatStreamCompletionArgs,
  | "activeBackgroundAgentCountRef"
  | "continueQueuedConversationRef"
  | "currentModelRef"
  | "finalizeThinkingSourceTracking"
  | "lastStreamingContentRef"
  | "parallelAgentsRef"
  | "resolveTrackedRun"
  | "setActiveBackgroundAgentCount"
  | "setBackgroundAgentMessageId"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "stopSharedStreamState"
  | "todoItemsRef"
>;

export function useChatStreamFinalizedCompletion({
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
}: UseChatStreamFinalizedCompletionArgs) {
  const finalizeCompletedStream = useCallback((context: FinalizedStreamCompletionContext) => {
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
    parallelAgentsRef.current = remaining;

    const newActiveCount = remaining.length;
    if (activeBackgroundAgentCountRef.current !== newActiveCount) {
      activeBackgroundAgentCountRef.current = newActiveCount;
      setActiveBackgroundAgentCount(newActiveCount);
    }

    const hasRemainingBackgroundAgents = remaining.length > 0;
    resolveTrackedRun("complete", {
      content: lastStreamingContentRef.current,
      wasInterrupted: false,
    }, { runId: context.streamRunId });
    if (context.hideCompletedMessage) {
      setMessagesWindowed((prev) => prev.filter((msg) => msg.id !== context.messageId));
    }

    stopSharedStreamState({
      preserveStreamingStart: hasRemainingBackgroundAgents,
      preserveStreamingMeta: hasRemainingBackgroundAgents,
      hasActiveBackgroundAgents: hasRemainingBackgroundAgents,
    });
    finalizeThinkingSourceTracking({ preserveStreamingMeta: hasRemainingBackgroundAgents });

    if (!context.suppressQueueContinuation) {
      continueQueuedConversationRef.current();
    }
  }, [
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
  ]);

  return { finalizeCompletedStream };
}
