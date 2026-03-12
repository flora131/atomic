import { useCallback } from "react";
import { interruptRunningToolCalls, interruptRunningToolParts } from "@/lib/ui/stream-continuation.ts";
import { hasActiveForegroundAgents } from "@/state/parts/index.ts";
import type {
  DeferredStreamCompletionContext,
  UseChatStreamCompletionArgs,
} from "@/state/chat/stream/completion-types.ts";

type UseChatStreamDeferredCompletionArgs = Pick<
  UseChatStreamCompletionArgs,
  | "deferredCompleteTimeoutRef"
  | "hasRunningToolRef"
  | "parallelAgentsRef"
  | "pendingCompleteRef"
  | "runningAskQuestionToolIdsRef"
  | "runningBlockingToolIdsRef"
  | "setMessagesWindowed"
  | "setToolCompletionVersion"
  | "streamingMessageIdRef"
  | "toolMessageIdByIdRef"
  | "toolNameByIdRef"
>;

export function useChatStreamDeferredCompletion({
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
}: UseChatStreamDeferredCompletionArgs) {
  const deferStreamCompletionIfNeeded = useCallback((context: DeferredStreamCompletionContext): boolean => {
    const hasActiveAgents = hasActiveForegroundAgents(parallelAgentsRef.current);
    if (!hasActiveAgents && !hasRunningToolRef.current) {
      return false;
    }

    const deferredMessageId = context.messageId;
    let spawnTimeout: ReturnType<typeof setTimeout> | null = null;
    const deferredComplete = () => {
      if (spawnTimeout) {
        clearTimeout(spawnTimeout);
        spawnTimeout = null;
      }
      if (streamingMessageIdRef.current !== deferredMessageId) {
        pendingCompleteRef.current = null;
        return;
      }
      context.handleStreamCompleteImpl();
    };
    pendingCompleteRef.current = deferredComplete;
    spawnTimeout = setTimeout(() => {
      if (pendingCompleteRef.current === deferredComplete
          && parallelAgentsRef.current.length === 0) {
        pendingCompleteRef.current = null;
        if (hasRunningToolRef.current) {
          const stalledToolIds = [...runningBlockingToolIdsRef.current];
          hasRunningToolRef.current = false;
          runningBlockingToolIdsRef.current.clear();
          runningAskQuestionToolIdsRef.current.clear();
          for (const stalledToolId of stalledToolIds) {
            toolNameByIdRef.current.delete(stalledToolId);
            toolMessageIdByIdRef.current.delete(stalledToolId);
          }
          setMessagesWindowed((prev) =>
            prev.map((msg) =>
              msg.id === context.messageId
                ? {
                  ...msg,
                  toolCalls: interruptRunningToolCalls(msg.toolCalls),
                  parts: interruptRunningToolParts(msg.parts),
                }
                : msg,
            ),
          );
          setToolCompletionVersion((version) => version + 1);
        }
        deferredComplete();
      }
    }, 30_000);
    deferredCompleteTimeoutRef.current = spawnTimeout;
    return true;
  }, [
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
  ]);

  return { deferStreamCompletionIfNeeded };
}
