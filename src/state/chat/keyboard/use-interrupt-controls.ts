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
      // Reset count synchronously so the spinner hides on the very next
      // render (Ctrl+C / ESC). The async `.then()` below confirms the
      // same value once the actual termination completes.
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
    // Always reset the count synchronously so the spinner hides on the
    // very next render — even when no background agents are found (stale
    // count) or when the async termination hasn't resolved yet.
    activeBackgroundAgentCountRef.current = 0;
    setActiveBackgroundAgentCount(0);
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
          resetHitlState();
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
            wasInterrupted: true,
            streaming: false,
            parallelAgents: context.interruptedAgents,
            taskItems: context.interruptedTaskItems,
            parts: finalizeStreamingTextParts(
              interruptRunningToolParts(message.parts) ?? [],
            ),
          }),
          wasInterruptedRef,
        });
        terminateActiveBackgroundAgents();
        resetHitlState();
        return true;
      }
    }

    // Handle the case where the main stream has completed (partial-idle)
    // but background agents (e.g. workflow sub-agents) are still running.
    // Without this, Ctrl+C falls through to the text-clear / exit logic
    // and the sub-agents keep running with the spinner stuck.
    {
      const activeBackgroundAgents = getActiveBackgroundAgents(parallelAgentsRef.current);
      if (activeBackgroundAgents.length > 0) {
        onInterrupt?.();
        parallelInterruptHandlerRef.current?.();

        // Temporarily keep original status so terminateActiveBackgroundAgents
        // can still find the agents via getActiveBackgroundAgents().
        const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(parallelAgentsRef.current);
        parallelAgentsRef.current = remainingLiveAgents;

        // terminateActiveBackgroundAgents captures the agent snapshot
        // synchronously, so it sees the original-status agents above.
        terminateActiveBackgroundAgents();

        // Now that termination captured its snapshot, mark all agents as
        // interrupted in the live state.  This prevents late-arriving
        // stream.agent.complete events (from the adapter's force-flush)
        // from reverting the status to "completed" (green).
        parallelAgentsRef.current = interruptedAgents;
        setParallelAgents(interruptedAgents);

        // Mark the last message as interrupted so the UI shows
        // "Operation cancelled by user" instead of a stale spinner.
        const interruptedTaskItems = finalizeTaskItemsOnInterrupt();
        setMessagesWindowed((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const msg = prev[i];
            if (msg?.role === "assistant") {
              return [
                ...prev.slice(0, i),
                {
                  ...msg,
                  wasInterrupted: true,
                  streaming: false,
                  parallelAgents: interruptedAgents,
                  taskItems: interruptedTaskItems,
                  parts: finalizeStreamingTextParts(
                    interruptRunningToolParts(msg.parts) ?? [],
                  ),
                },
                ...prev.slice(i + 1),
              ];
            }
          }
          return prev;
        });

        resetHitlState();

        if (workflowState.workflowActive) {
          const nextCount = interruptCount + 1;
          if (nextCount >= 2) {
            // Double Ctrl+C: fully exit the workflow
            cancelWorkflow();
            clearInterruptConfirmation();
          } else {
            conductorInterruptRef.current?.();
            scheduleInterruptConfirmation(nextCount);
          }
        } else {
          clearInterruptConfirmation();
        }
        return true;
      }
    }

    // Handle the case where the workflow is active but the stream has
    // already completed (between-stage gap or race condition where
    // stream.session.idle fired before the keyboard event).  Without
    // this, the interrupt falls through to text-clear / exit and the
    // spinner stays visible because wasInterrupted is never set on the
    // last message while keepAliveForWorkflow remains true.
    if (workflowState.workflowActive) {
      onInterrupt?.();
      const interruptedTaskItems = finalizeTaskItemsOnInterrupt();
      setMessagesWindowed((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const msg = prev[i];
          if (msg?.role === "assistant") {
            return [
              ...prev.slice(0, i),
              {
                ...msg,
                wasInterrupted: true,
                streaming: false,
                taskItems: interruptedTaskItems,
                parts: finalizeStreamingTextParts(
                  interruptRunningToolParts(msg.parts) ?? [],
                ),
              },
              ...prev.slice(i + 1),
            ];
          }
        }
        return prev;
      });

      const nextCount = interruptCount + 1;
      if (nextCount >= 2) {
        cancelWorkflow();
        clearInterruptConfirmation();
      } else {
        conductorInterruptRef.current?.();
        scheduleInterruptConfirmation(nextCount);
      }
      return true;
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
    resetHitlState,
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
            wasInterrupted: true,
            streaming: false,
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

    // Handle the case where the main stream has completed (partial-idle)
    // but background agents (e.g. workflow sub-agents) are still running.
    // Without this, ESC falls through and the sub-agents keep running
    // with the spinner stuck.
    {
      const activeBackgroundAgents = getActiveBackgroundAgents(parallelAgentsRef.current);
      if (activeBackgroundAgents.length > 0) {
        onInterrupt?.();
        parallelInterruptHandlerRef.current?.();

        // Temporarily keep original status so terminateActiveBackgroundAgents
        // can still find the agents via getActiveBackgroundAgents().
        const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(parallelAgentsRef.current);
        parallelAgentsRef.current = remainingLiveAgents;

        // terminateActiveBackgroundAgents captures the agent snapshot
        // synchronously, so it sees the original-status agents above.
        terminateActiveBackgroundAgents();

        // Now that termination captured its snapshot, mark all agents as
        // interrupted in the live state.  This prevents late-arriving
        // stream.agent.complete events (from the adapter's force-flush)
        // from reverting the status to "completed" (green).
        parallelAgentsRef.current = interruptedAgents;
        setParallelAgents(interruptedAgents);

        // Mark the last message as interrupted so the UI shows
        // "Operation cancelled by user" instead of a stale spinner.
        const interruptedTaskItems = finalizeTaskItemsOnInterrupt();
        setMessagesWindowed((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const msg = prev[i];
            if (msg?.role === "assistant") {
              return [
                ...prev.slice(0, i),
                {
                  ...msg,
                  wasInterrupted: true,
                  streaming: false,
                  parallelAgents: interruptedAgents,
                  taskItems: interruptedTaskItems,
                  parts: finalizeStreamingTextParts(
                    interruptRunningToolParts(msg.parts) ?? [],
                  ),
                },
                ...prev.slice(i + 1),
              ];
            }
          }
          return prev;
        });

        if (workflowState.workflowActive) {
          conductorInterruptRef.current?.();
        }
        return true;
      }
    }

    // Handle the case where the workflow is active but the stream has
    // already completed (between-stage gap or race condition where
    // stream.session.idle fired before the keyboard event).  Without
    // this, ESC falls through and the spinner stays visible because
    // wasInterrupted is never set on the last message while
    // keepAliveForWorkflow remains true.
    if (workflowState.workflowActive) {
      onInterrupt?.();
      const interruptedTaskItems = finalizeTaskItemsOnInterrupt();
      setMessagesWindowed((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const msg = prev[i];
          if (msg?.role === "assistant") {
            return [
              ...prev.slice(0, i),
              {
                ...msg,
                wasInterrupted: true,
                streaming: false,
                taskItems: interruptedTaskItems,
                parts: finalizeStreamingTextParts(
                  interruptRunningToolParts(msg.parts) ?? [],
                ),
              },
              ...prev.slice(i + 1),
            ];
          }
        }
        return prev;
      });

      conductorInterruptRef.current?.();
      return true;
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
