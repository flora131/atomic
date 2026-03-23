import { useCallback } from "react";
import type { KeyEvent } from "@opentui/core";
import { getActiveBackgroundAgents, isBackgroundAgent } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import {
  executeBackgroundTermination,
} from "@/state/chat/shared/helpers/background-agent-termination.ts";
import {
  interruptRunningToolParts,
} from "@/state/chat/shared/helpers/stream-continuation.ts";
import {
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
  finalizeStreamingTextParts,
} from "@/state/parts/index.ts";
import {
  interruptForegroundAgents,
  interruptStreaming,
} from "@/state/chat/keyboard/interrupt-execution.ts";
import type { UseChatKeyboardArgs } from "@/state/chat/keyboard/types.ts";
import { useInterruptConfirmation } from "@/state/chat/keyboard/use-interrupt-confirmation.ts";

export function useChatInterruptControls({
  activeBackgroundAgentCountRef,
  activeHitlToolCallIdRef,
  awaitedStreamRunIdsRef,
  clearDeferredCompletion,
  conductorInterruptRef,
  continueQueuedConversation,
  finalizeTaskItemsOnInterrupt,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  onExit,
  onInterrupt,
  onTerminateBackgroundAgents,
  parallelAgentsRef,
  parallelInterruptHandlerRef,
  resetHitlState,
  resolveTrackedRun,
  setActiveBackgroundAgentCount,
  setMessagesWindowed,
  setParallelAgents,
  shouldHideActiveStreamContent,
  stopSharedStreamState,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  textareaRef,
  updateWorkflowState,
  wasInterruptedRef,
  waitForUserInputResolverRef,
  workflowState,
  lastStreamingContentRef,
  separateAndInterruptAgents,
  isStreamingRef,
}: Pick<
  UseChatKeyboardArgs,
  | "activeBackgroundAgentCountRef"
  | "activeHitlToolCallIdRef"
  | "awaitedStreamRunIdsRef"
  | "clearDeferredCompletion"
  | "conductorInterruptRef"
  | "continueQueuedConversation"
  | "finalizeTaskItemsOnInterrupt"
  | "finalizeThinkingSourceTracking"
  | "getActiveStreamRunId"
  | "isStreamingRef"
  | "lastStreamingContentRef"
  | "onExit"
  | "onInterrupt"
  | "onTerminateBackgroundAgents"
  | "parallelAgentsRef"
  | "parallelInterruptHandlerRef"
  | "resetHitlState"
  | "resolveTrackedRun"
  | "separateAndInterruptAgents"
  | "setActiveBackgroundAgentCount"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "shouldHideActiveStreamContent"
  | "stopSharedStreamState"
  | "streamingMessageIdRef"
  | "streamingMetaRef"
  | "streamingStartRef"
  | "textareaRef"
  | "updateWorkflowState"
  | "wasInterruptedRef"
  | "waitForUserInputResolverRef"
  | "workflowState"
>) {
  const {
    clearInterruptConfirmation,
    ctrlCPressed,
    interruptCount,
    scheduleInterruptConfirmation,
  } = useInterruptConfirmation();

  const terminateActiveBackgroundAgents = useCallback(() => {
    const activeBackgroundAgents = getActiveBackgroundAgents(parallelAgentsRef.current);
    if (activeBackgroundAgents.length > 0) {
      void executeBackgroundTermination({
        getAgents: () => parallelAgentsRef.current,
        onTerminateBackgroundAgents,
      }).then((result) => {
        if (result.status === "terminated" && result.interruptedIds.length > 0) {
          const interruptedIdSet = new Set(result.interruptedIds);
          const remainingLiveAgents = result.agents.filter(
            (agent) => !interruptedIdSet.has(agent.id),
          );
          parallelAgentsRef.current = remainingLiveAgents;
          setParallelAgents(remainingLiveAgents);
        }
        activeBackgroundAgentCountRef.current = 0;
        setActiveBackgroundAgentCount(0);
      });
    }
  }, [activeBackgroundAgentCountRef, onTerminateBackgroundAgents, parallelAgentsRef, setActiveBackgroundAgentCount, setParallelAgents]);

  const cancelWorkflow = useCallback(() => {
    updateWorkflowState({ workflowActive: false, workflowType: null, initialPrompt: null });
    if (waitForUserInputResolverRef.current) {
      waitForUserInputResolverRef.current.reject(new Error("Workflow cancelled"));
      waitForUserInputResolverRef.current = null;
    }
  }, [updateWorkflowState, waitForUserInputResolverRef]);

  const handleCtrlCKey = useCallback((_event: KeyEvent): boolean => {
    if (isStreamingRef.current) {
      onInterrupt?.();
      parallelInterruptHandlerRef.current?.();
      const { suppressQueueContinuation } = interruptStreaming({
        afterStateReset: () => {
          activeHitlToolCallIdRef.current = null;
        },
        awaitedStreamRunIdsRef,
        clearDeferredCompletion,
        continueQueuedConversation,
        finalizeTaskItemsOnInterrupt,
        finalizeThinkingSourceTracking,
        getActiveStreamRunId,
        lastStreamingContentRef,
        onResolveOverrides: () => (
          workflowState.workflowActive && interruptCount >= 1
            ? { wasCancelled: true }
            : {}
        ),
        parallelAgentsRef,
        resolveTrackedRun,
        separateAndInterruptAgents,
        setMessagesWindowed,
        setParallelAgents,
        shouldContinueAfterInterrupt: false,
        shouldHideActiveStreamContent,
        stopSharedStreamState,
        streamingMessageIdRef,
        streamingMetaRef,
        streamingStartRef,
        updateInterruptedMessage: (message, context) => ({
          ...finalizeStreamingReasoningInMessage(message),
          wasInterrupted: true,
          streaming: false,
          durationMs: context.durationMs,
          outputTokens: context.finalMeta?.outputTokens,
          thinkingMs: context.finalMeta?.thinkingMs,
          thinkingText: context.finalMeta?.thinkingText || undefined,
          parallelAgents: context.interruptedAgents,
          taskItems: context.interruptedTaskItems,
          parts: finalizeStreamingTextParts(
            interruptRunningToolParts(
              finalizeStreamingReasoningParts(
                message.parts ?? [],
                context.finalMeta?.thinkingMs || message.thinkingMs,
              ),
            ) ?? [],
          ),
        }),
        wasInterruptedRef,
      });

      terminateActiveBackgroundAgents();

      if (workflowState.workflowActive) {
        const nextCount = interruptCount + 1;
        if (nextCount >= 2) {
          cancelWorkflow();
          clearInterruptConfirmation();
        } else {
          // Stage-aware interrupt: abort current conductor stage session (§5.5)
          conductorInterruptRef.current?.();
          scheduleInterruptConfirmation(nextCount);
        }
      } else {
        clearInterruptConfirmation();
        if (!suppressQueueContinuation) {
          continueQueuedConversation();
        }
      }
      return true;
    }

    {
      const currentAgents = parallelAgentsRef.current;
      const foregroundAgents = currentAgents.filter((agent) => !isBackgroundAgent(agent));
      const hasRunningForegroundAgents = foregroundAgents.some(
        (agent) => agent.status === "running" || agent.status === "pending",
      );
      if (hasRunningForegroundAgents) {
        onInterrupt?.();
        parallelInterruptHandlerRef.current?.();
        interruptForegroundAgents({
          clearDeferredCompletion,
          continueQueuedConversation,
          finalizeTaskItemsOnInterrupt,
          finalizeThinkingSourceTracking,
          parallelAgentsRef,
          separateAndInterruptAgents,
          setMessagesWindowed,
          setParallelAgents,
          stopSharedStreamState,
          streamingMessageIdRef,
          updateInterruptedMessage: (message, context) => ({
            ...message,
            parallelAgents: context.interruptedAgents,
            taskItems: context.interruptedTaskItems,
            parts: finalizeStreamingTextParts(
              interruptRunningToolParts(message.parts) ?? [],
            ),
          }),
          wasInterruptedRef,
        });
        terminateActiveBackgroundAgents();
        return true;
      }
    }

    {
      const textarea = textareaRef.current;
      if (textarea?.plainText) {
        textarea.gotoBufferHome();
        textarea.gotoBufferEnd({ select: true });
        textarea.deleteChar();
        return true;
      }
    }

    const nextCount = interruptCount + 1;
    if (nextCount >= 2) {
      clearInterruptConfirmation();
      if (workflowState.workflowActive) {
        cancelWorkflow();
      } else {
        onExit?.();
      }
      return true;
    }

    scheduleInterruptConfirmation(nextCount);
    return true;
  }, [
    activeHitlToolCallIdRef,
    awaitedStreamRunIdsRef,
    cancelWorkflow,
    clearDeferredCompletion,
    clearInterruptConfirmation,
    conductorInterruptRef,
    continueQueuedConversation,
    finalizeTaskItemsOnInterrupt,
    finalizeThinkingSourceTracking,
    getActiveStreamRunId,
    interruptCount,
    isStreamingRef,
    lastStreamingContentRef,
    onExit,
    onInterrupt,
    parallelAgentsRef,
    parallelInterruptHandlerRef,
    scheduleInterruptConfirmation,
    separateAndInterruptAgents,
    setMessagesWindowed,
    setParallelAgents,
    shouldHideActiveStreamContent,
    stopSharedStreamState,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
    terminateActiveBackgroundAgents,
    textareaRef,
    resolveTrackedRun,
    wasInterruptedRef,
    workflowState.workflowActive,
  ]);

  const handleEscapeKey = useCallback((): boolean => {
    if (workflowState.showAutocomplete) {
      updateWorkflowState({
        showAutocomplete: false,
        autocompleteInput: "",
        selectedSuggestionIndex: 0,
      });
      return true;
    }

    if (isStreamingRef.current) {
      onInterrupt?.();
      parallelInterruptHandlerRef.current?.();
      interruptStreaming({
        afterStateReset: resetHitlState,
        awaitedStreamRunIdsRef,
        clearDeferredCompletion,
        continueQueuedConversation,
        finalizeTaskItemsOnInterrupt,
        finalizeThinkingSourceTracking,
        getActiveStreamRunId,
        lastStreamingContentRef,
        parallelAgentsRef,
        resolveTrackedRun,
        separateAndInterruptAgents,
        setMessagesWindowed,
        setParallelAgents,
        shouldContinueAfterInterrupt: !workflowState.workflowActive,
        shouldHideActiveStreamContent,
        stopSharedStreamState,
        streamingMessageIdRef,
        streamingMetaRef,
        streamingStartRef,
        updateInterruptedMessage: (message, context) => ({
          ...finalizeStreamingReasoningInMessage(message),
          wasInterrupted: true,
          streaming: false,
          ...(context.durationMs != null && { durationMs: context.durationMs }),
          ...(context.finalMeta && { streamingMeta: { ...context.finalMeta } }),
          parallelAgents: context.interruptedAgents,
          taskItems: context.interruptedTaskItems,
          parts: finalizeStreamingTextParts(
            interruptRunningToolParts(
              finalizeStreamingReasoningParts(
                message.parts ?? [],
                context.finalMeta?.thinkingMs || message.thinkingMs,
              ),
            ) ?? [],
          ),
        }),
        wasInterruptedRef,
      });
      terminateActiveBackgroundAgents();
      // Stage-aware interrupt: abort current conductor stage session on ESC (§5.5)
      if (workflowState.workflowActive) {
        conductorInterruptRef.current?.();
      }
      return true;
    }

    {
      const currentAgents = parallelAgentsRef.current;
      const foregroundAgents = currentAgents.filter((agent) => !isBackgroundAgent(agent));
      const hasRunningForegroundAgents = foregroundAgents.some(
        (agent) => agent.status === "running" || agent.status === "pending",
      );
      if (hasRunningForegroundAgents) {
        onInterrupt?.();
        parallelInterruptHandlerRef.current?.();
        interruptForegroundAgents({
          clearDeferredCompletion,
          continueQueuedConversation,
          finalizeTaskItemsOnInterrupt,
          parallelAgentsRef,
          separateAndInterruptAgents,
          setMessagesWindowed,
          setParallelAgents,
          stopSharedStreamState,
          streamingMessageIdRef,
          updateInterruptedMessage: (message, context) => ({
            ...message,
            parallelAgents: context.interruptedAgents,
            taskItems: context.interruptedTaskItems,
            parts: finalizeStreamingTextParts(
              interruptRunningToolParts(message.parts) ?? [],
            ),
          }),
          wasInterruptedRef,
        });
        terminateActiveBackgroundAgents();
        return true;
      }
    }

    return false;
  }, [
    awaitedStreamRunIdsRef,
    clearDeferredCompletion,
    conductorInterruptRef,
    continueQueuedConversation,
    finalizeTaskItemsOnInterrupt,
    finalizeThinkingSourceTracking,
    getActiveStreamRunId,
    isStreamingRef,
    lastStreamingContentRef,
    onInterrupt,
    parallelAgentsRef,
    parallelInterruptHandlerRef,
    resetHitlState,
    resolveTrackedRun,
    separateAndInterruptAgents,
    setMessagesWindowed,
    setParallelAgents,
    shouldHideActiveStreamContent,
    stopSharedStreamState,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
    terminateActiveBackgroundAgents,
    updateWorkflowState,
    wasInterruptedRef,
    workflowState.showAutocomplete,
    workflowState.workflowActive,
  ]);

  return {
    ctrlCPressed,
    handleCtrlCKey,
    handleEscapeKey,
  };
}
