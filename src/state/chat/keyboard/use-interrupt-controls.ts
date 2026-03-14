import { useCallback } from "react";
import type { KeyEvent } from "@opentui/core";
import { getActiveBackgroundAgents, isBackgroundAgent } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import {
  executeBackgroundTermination,
} from "@/state/chat/shared/helpers/background-agent-termination.ts";
import {
  interruptRunningToolCalls,
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
import { useBackgroundTerminationControls } from "@/state/chat/keyboard/use-background-termination-controls.ts";
import { useInterruptConfirmation } from "@/state/chat/keyboard/use-interrupt-confirmation.ts";

export function useChatInterruptControls({
  activeBackgroundAgentCountRef,
  activeQuestion,
  activeHitlToolCallIdRef,
  addMessage,
  awaitedStreamRunIdsRef,
  backgroundAgentMessageIdRef,
  clearDeferredCompletion,
  continueQueuedConversation,
  finalizeTaskItemsOnInterrupt,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  handleCopy,
  hasRendererSelection,
  onExit,
  onInterrupt,
  onTerminateBackgroundAgents,
  parallelAgents,
  parallelAgentsRef,
  parallelInterruptHandlerRef,
  resetHitlState,
  resolveTrackedRun,
  setActiveBackgroundAgentCount,
  setBackgroundAgentMessageId,
  setMessagesWindowed,
  setParallelAgents,
  shouldHideActiveStreamContent,
  showModelSelector,
  stopSharedStreamState,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  textareaRef,
  updateWorkflowState,
  wasInterruptedRef,
  waitForUserInputResolverRef,
  workflowActiveRef,
  workflowState,
  lastStreamingContentRef,
  lastStreamedMessageIdRef,
  separateAndInterruptAgents,
  isStreamingRef,
}: Pick<
  UseChatKeyboardArgs,
  | "activeBackgroundAgentCountRef"
  | "activeQuestion"
  | "activeHitlToolCallIdRef"
  | "addMessage"
  | "awaitedStreamRunIdsRef"
  | "backgroundAgentMessageIdRef"
  | "clearDeferredCompletion"
  | "continueQueuedConversation"
  | "finalizeTaskItemsOnInterrupt"
  | "finalizeThinkingSourceTracking"
  | "getActiveStreamRunId"
  | "handleCopy"
  | "hasRendererSelection"
  | "isStreamingRef"
  | "lastStreamedMessageIdRef"
  | "lastStreamingContentRef"
  | "onExit"
  | "onInterrupt"
  | "onTerminateBackgroundAgents"
  | "parallelAgents"
  | "parallelAgentsRef"
  | "parallelInterruptHandlerRef"
  | "resetHitlState"
  | "resolveTrackedRun"
  | "separateAndInterruptAgents"
  | "setActiveBackgroundAgentCount"
  | "setBackgroundAgentMessageId"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "shouldHideActiveStreamContent"
  | "showModelSelector"
  | "stopSharedStreamState"
  | "streamingMessageIdRef"
  | "streamingMetaRef"
  | "streamingStartRef"
  | "textareaRef"
  | "updateWorkflowState"
  | "wasInterruptedRef"
  | "waitForUserInputResolverRef"
  | "workflowActiveRef"
  | "workflowState"
>) {
  const {
    clearInterruptConfirmation,
    ctrlCPressed,
    interruptCount,
    scheduleInterruptConfirmation,
  } = useInterruptConfirmation();
  const {
    ctrlFPressed,
    handleBackgroundTerminationKey,
    isBackgroundTerminationKey,
  } = useBackgroundTerminationControls({
    activeBackgroundAgentCountRef,
    addMessage,
    backgroundAgentMessageIdRef,
    clearDeferredCompletion,
    lastStreamedMessageIdRef,
    onTerminateBackgroundAgents,
    parallelAgents,
    parallelAgentsRef,
    setActiveBackgroundAgentCount,
    setBackgroundAgentMessageId,
    setMessagesWindowed,
    setParallelAgents,
    streamingMessageIdRef,
    streamingStartRef,
    workflowActiveRef,
  });

  const cancelWorkflow = useCallback(() => {
    updateWorkflowState({ workflowActive: false, workflowType: null, initialPrompt: null });
    if (waitForUserInputResolverRef.current) {
      waitForUserInputResolverRef.current.reject(new Error("Workflow cancelled"));
      waitForUserInputResolverRef.current = null;
    }
  }, [updateWorkflowState, waitForUserInputResolverRef]);

  const handleCtrlCKey = useCallback((event: KeyEvent): boolean => {
    const textarea = textareaRef.current;
    if (!activeQuestion && !showModelSelector && (textarea?.hasSelection() || hasRendererSelection())) {
      void handleCopy();
      return true;
    }

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
          toolCalls: interruptRunningToolCalls(message.toolCalls),
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

      // Also terminate any active background agents on Ctrl+C
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
          // Reset the background agent counter so the spinner stops
          activeBackgroundAgentCountRef.current = 0;
          setActiveBackgroundAgentCount(0);
        });
      }

      if (workflowState.workflowActive) {
        const nextCount = interruptCount + 1;
        if (nextCount >= 2) {
          cancelWorkflow();
          clearInterruptConfirmation();
        } else {
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
            toolCalls: interruptRunningToolCalls(message.toolCalls),
            parts: finalizeStreamingTextParts(
              interruptRunningToolParts(message.parts) ?? [],
            ),
          }),
          wasInterruptedRef,
        });
        return true;
      }
    }

    if (textarea?.plainText) {
      textarea.gotoBufferHome();
      textarea.gotoBufferEnd({ select: true });
      textarea.deleteChar();
      return true;
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
    activeBackgroundAgentCountRef,
    activeHitlToolCallIdRef,
    activeQuestion,
    awaitedStreamRunIdsRef,
    cancelWorkflow,
    clearDeferredCompletion,
    clearInterruptConfirmation,
    continueQueuedConversation,
    finalizeTaskItemsOnInterrupt,
    finalizeThinkingSourceTracking,
    getActiveStreamRunId,
    handleCopy,
    hasRendererSelection,
    interruptCount,
    isStreamingRef,
    lastStreamingContentRef,
    onExit,
    onInterrupt,
    onTerminateBackgroundAgents,
    parallelAgentsRef,
    parallelInterruptHandlerRef,
    scheduleInterruptConfirmation,
    separateAndInterruptAgents,
    setActiveBackgroundAgentCount,
    setMessagesWindowed,
    setParallelAgents,
    shouldHideActiveStreamContent,
    showModelSelector,
    stopSharedStreamState,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
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
          toolCalls: interruptRunningToolCalls(message.toolCalls),
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
            toolCalls: interruptRunningToolCalls(message.toolCalls),
            parts: finalizeStreamingTextParts(
              interruptRunningToolParts(message.parts) ?? [],
            ),
          }),
          wasInterruptedRef,
        });
        return true;
      }
    }

    return false;
  }, [
    awaitedStreamRunIdsRef,
    clearDeferredCompletion,
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
    updateWorkflowState,
    wasInterruptedRef,
    workflowState.showAutocomplete,
    workflowState.workflowActive,
  ]);

  return {
    ctrlCPressed,
    ctrlFPressed,
    handleBackgroundTerminationKey,
    handleCtrlCKey,
    handleEscapeKey,
    isBackgroundTerminationKey,
  };
}
