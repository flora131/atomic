import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS } from "@/theme/icons.ts";
import { getActiveBackgroundAgents } from "@/lib/ui/background-agent-footer.ts";
import {
  evaluateBackgroundTerminationPress,
  executeBackgroundTermination,
  isBackgroundTerminationKey,
} from "@/lib/ui/background-agent-termination.ts";
import type { ChatMessage } from "@/state/chat/types.ts";
import type { UseChatKeyboardArgs } from "@/state/chat/keyboard/types.ts";

export interface UseBackgroundTerminationControlsResult {
  ctrlFPressed: boolean;
  handleBackgroundTerminationKey: () => boolean;
  isBackgroundTerminationKey: typeof isBackgroundTerminationKey;
}

export function useBackgroundTerminationControls({
  addMessage,
  backgroundAgentMessageIdRef,
  clearDeferredCompletion,
  isStreamingRef,
  lastStreamedMessageIdRef,
  onTerminateBackgroundAgents,
  parallelAgents,
  parallelAgentsRef,
  setBackgroundAgentMessageId,
  setMessagesWindowed,
  setParallelAgents,
  streamingMessageIdRef,
  streamingStartRef,
  workflowActiveRef,
}: Pick<
  UseChatKeyboardArgs,
  | "addMessage"
  | "backgroundAgentMessageIdRef"
  | "clearDeferredCompletion"
  | "isStreamingRef"
  | "lastStreamedMessageIdRef"
  | "onTerminateBackgroundAgents"
  | "parallelAgents"
  | "parallelAgentsRef"
  | "setBackgroundAgentMessageId"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "streamingMessageIdRef"
  | "streamingStartRef"
  | "workflowActiveRef"
>): UseBackgroundTerminationControlsResult {
  const [backgroundTerminationCount, setBackgroundTerminationCount] = useState(0);
  const [ctrlFPressed, setCtrlFPressed] = useState(false);
  const backgroundTerminationCountRef = useRef(0);
  const backgroundTerminationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundTerminationInFlightRef = useRef(false);

  const clearBackgroundTerminationConfirmation = useCallback(() => {
    backgroundTerminationCountRef.current = 0;
    setBackgroundTerminationCount(0);
    setCtrlFPressed(false);
    if (backgroundTerminationTimeoutRef.current) {
      clearTimeout(backgroundTerminationTimeoutRef.current);
      backgroundTerminationTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (
      getActiveBackgroundAgents(parallelAgents).length === 0
      && (backgroundTerminationCount > 0 || ctrlFPressed)
    ) {
      clearBackgroundTerminationConfirmation();
    }
  }, [
    backgroundTerminationCount,
    clearBackgroundTerminationConfirmation,
    ctrlFPressed,
    parallelAgents,
  ]);

  useEffect(() => {
    return () => {
      if (backgroundTerminationTimeoutRef.current) {
        clearTimeout(backgroundTerminationTimeoutRef.current);
      }
    };
  }, []);

  const handleBackgroundTerminationKey = useCallback((): boolean => {
    if (isStreamingRef.current || backgroundTerminationInFlightRef.current) {
      return true;
    }

    const currentAgents = parallelAgentsRef.current;
    const activeBackgroundAgents = getActiveBackgroundAgents(currentAgents);
    const pressEvaluation = evaluateBackgroundTerminationPress(
      backgroundTerminationCountRef,
      activeBackgroundAgents.length,
    );
    const decision = pressEvaluation.decision;

    console.debug("[background-termination] decision:", decision.action, {
      pressCount: pressEvaluation.pressCount,
      activeAgents: activeBackgroundAgents.length,
    });

    if (decision.action === "none") {
      console.debug("[background-termination] noop: no active background agents");
      clearBackgroundTerminationConfirmation();
      return true;
    }

    if (decision.action === "terminate") {
      backgroundTerminationInFlightRef.current = true;
      clearBackgroundTerminationConfirmation();

      void executeBackgroundTermination({
        getAgents: () => parallelAgentsRef.current,
        onTerminateBackgroundAgents,
      }).then((result) => {
        if (result.status === "failed") {
          console.error("[background-termination] parent callback failed:", result.error);
          const errorMessage = result.error instanceof Error
            ? result.error.message
            : String(result.error ?? "Unknown error");
          addMessage("system", `${STATUS.error} Failed to terminate background agents: ${errorMessage}`);
          return;
        }

        if (result.status === "noop") {
          return;
        }

        const interruptedIds = result.interruptedIds;
        if (interruptedIds.length > 0) {
          const interruptedIdSet = new Set(interruptedIds);
          console.debug("[background-termination] executing termination", {
            interruptedIds,
            remainingCount: result.agents.filter((agent) => !interruptedIdSet.has(agent.id)).length,
          });

          const remainingLiveAgents = result.agents.filter((agent) => !interruptedIdSet.has(agent.id));
          const interruptedMessageId = backgroundAgentMessageIdRef.current
            ?? streamingMessageIdRef.current
            ?? lastStreamedMessageIdRef.current;
          if (interruptedMessageId) {
            setMessagesWindowed((previousMessages: ChatMessage[]) =>
              previousMessages.map((message) =>
                message.id === interruptedMessageId
                  ? { ...message, parallelAgents: result.agents }
                  : message,
              ),
            );
          }

          parallelAgentsRef.current = remainingLiveAgents;
          setParallelAgents(remainingLiveAgents);
          setBackgroundAgentMessageId(null);
          if (!workflowActiveRef.current) {
            streamingStartRef.current = null;
          }
          clearDeferredCompletion();
        }

        addMessage("system", `${STATUS.active} ${decision.message}`);
      }).finally(() => {
        backgroundTerminationInFlightRef.current = false;
      });
      return true;
    }

    console.debug("[background-termination] armed: awaiting confirmation");
    setBackgroundTerminationCount(pressEvaluation.nextPressCount);
    setCtrlFPressed(true);
    if (backgroundTerminationTimeoutRef.current) {
      clearTimeout(backgroundTerminationTimeoutRef.current);
    }
    backgroundTerminationTimeoutRef.current = setTimeout(() => {
      clearBackgroundTerminationConfirmation();
    }, 1000);
    return true;
  }, [
    addMessage,
    backgroundAgentMessageIdRef,
    clearBackgroundTerminationConfirmation,
    clearDeferredCompletion,
    isStreamingRef,
    lastStreamedMessageIdRef,
    onTerminateBackgroundAgents,
    parallelAgentsRef,
    setBackgroundAgentMessageId,
    setMessagesWindowed,
    setParallelAgents,
    streamingMessageIdRef,
    streamingStartRef,
    workflowActiveRef,
  ]);

  return {
    ctrlFPressed,
    handleBackgroundTerminationKey,
    isBackgroundTerminationKey,
  };
}
