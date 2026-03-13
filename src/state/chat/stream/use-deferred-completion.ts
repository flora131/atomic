import { useCallback } from "react";
import { interruptRunningToolCalls, interruptRunningToolParts } from "@/lib/ui/stream-continuation.ts";
import { hasActiveForegroundAgents, hasActiveBackgroundAgentsForSpinner } from "@/state/parts/index.ts";
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
    const hasForeground = hasActiveForegroundAgents(parallelAgentsRef.current);
    const hasBackground = hasActiveBackgroundAgentsForSpinner(parallelAgentsRef.current);
    const hasRunningTool = hasRunningToolRef.current;

    if (!hasForeground && !hasBackground && !hasRunningTool) {
      return false;
    }

    // Foreground deferral: active foreground agents or running tools.
    // Uses 30-second safety timeout to force-interrupt stalled tools.
    if (hasForeground || hasRunningTool) {
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
    }

    // Background-only deferral: no foreground agents or tools remain,
    // but background agents are still active. Store a deferred completion
    // that will be invoked when the last background agent completes.
    // No safety timeout — background agents have their own lifecycle
    // managed by Ctrl+F termination.
    if (hasBackground) {
      const deferredMessageId = context.messageId;
      pendingCompleteRef.current = () => {
        if (streamingMessageIdRef.current !== deferredMessageId) {
          pendingCompleteRef.current = null;
          return;
        }
        context.handleStreamCompleteImpl();
      };
      return true;
    }

    return false;
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
