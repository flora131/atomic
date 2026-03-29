import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";
import { getNextKittyKeyboardDetectionState } from "@/state/chat/keyboard/kitty-keyboard-detection.ts";
import {
  handleAutocompleteSelectionKey,
  handleComposeShortcutKey,
  handleNavigationKey,
} from "@/state/chat/keyboard/navigation.ts";
import type { UseChatKeyboardArgs } from "@/state/chat/keyboard/types.ts";
import { useChatInterruptControls } from "@/state/chat/keyboard/use-interrupt-controls.ts";

/**
 * @deprecated Use {@link useKeyboardOwnership} from `use-keyboard-ownership.ts` instead.
 * This hook is retained for backward compatibility but is no longer wired into the controller.
 */
export function useChatKeyboard({
  activeBackgroundAgentCountRef,
  activeQuestion,
  addMessage,
  activeHitlToolCallIdRef,
  autocompleteSuggestions,
  awaitedStreamRunIdsRef,
  clipboard,
  clearDeferredCompletion,
  conductorInterruptRef,
  continueQueuedConversation,
  emitMessageSubmitTelemetry,
  executeCommand,
  finalizeTaskItemsOnInterrupt,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  handleCopy,
  handleInputChange,
  handleTextareaContentChange,
  historyIndexRef,
  historyNavigatingRef,
  isEditingQueue,
  isStreaming,
  isStreamingRef,
  kittyKeyboardDetectedRef,
  lastStreamingContentRef,
  messageQueue,
  normalizePastedText,
  onExit,
  onInterrupt,
  onTerminateBackgroundAgents,
  parallelAgentsRef,
  parallelInterruptHandlerRef,
  promptHistoryRef,
  resetHitlState,
  resolveTrackedRun,
  savedInputRef,
  scrollboxRef,
  separateAndInterruptAgents,
  setActiveBackgroundAgentCount,
  setIsEditingQueue,
  setMessagesWindowed,
  setParallelAgents,
  setShowTodoPanel,
  setTranscriptMode,
  shouldHideActiveStreamContent,
  showModelSelector,
  stopSharedStreamState,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  syncInputScrollbar,
  textareaRef,
  toggleVerbose,
  updateWorkflowState,
  wasInterruptedRef,
  waitForUserInputResolverRef,
  workflowState,
}: UseChatKeyboardArgs) {
  const {
    ctrlCPressed,
    handleCtrlCKey,
    handleEscapeKey,
  } = useChatInterruptControls({
    activeBackgroundAgentCountRef,
    activeHitlToolCallIdRef,
    awaitedStreamRunIdsRef,
    clearDeferredCompletion,
    conductorInterruptRef,
    continueQueuedConversation,
    finalizeTaskItemsOnInterrupt,
    finalizeThinkingSourceTracking,
    getActiveStreamRunId,
    isStreamingRef,
    lastStreamingContentRef,
    onExit,
    onInterrupt,
    onTerminateBackgroundAgents,
    parallelAgentsRef,
    parallelInterruptHandlerRef,
    resetHitlState,
    resolveTrackedRun,
    separateAndInterruptAgents,
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
  });

  useKeyboard(
    useCallback((event: KeyEvent) => {
      kittyKeyboardDetectedRef.current = getNextKittyKeyboardDetectionState(
        kittyKeyboardDetectedRef.current,
        event.raw,
      );

      if ((event.ctrl || event.meta) && event.shift && event.name.toLowerCase() === "c") {
        void handleCopy();
        return;
      }

      if (event.meta && !event.ctrl && event.name.toLowerCase() === "c") {
        void handleCopy();
        return;
      }

      if (event.ctrl && !event.shift && event.name.toLowerCase() === "c") {
        if (handleCtrlCKey(event)) {
          return;
        }
      }

      if ((event.ctrl || event.meta) && event.name === "v") {
        const textarea = textareaRef.current;
        if (textarea) {
          const clipboardText = clipboard.readText();
          if (clipboardText) {
            event.preventDefault();
            textarea.insertText(normalizePastedText(clipboardText));
            handleTextareaContentChange();
            return;
          }
        }
      }

      if (activeQuestion || showModelSelector) {
        return;
      }

      if (event.ctrl && event.name === "o") {
        setTranscriptMode((previous) => !previous);
        return;
      }

      if (event.ctrl && event.name === "e") {
        toggleVerbose();
        return;
      }

      if (event.ctrl && !event.shift && event.name === "t") {
        setShowTodoPanel((previous) => !previous);
        return;
      }

      if (event.name === "escape") {
        if (handleEscapeKey()) {
          return;
        }

        if (isEditingQueue) {
          setIsEditingQueue(false);
          messageQueue.setEditIndex(-1);
          return;
        }
      }

      if (handleNavigationKey({
        autocompleteSuggestions,
        event,
        historyIndexRef,
        historyNavigatingRef,
        isEditingQueue,
        isStreaming,
        messageQueue,
        promptHistoryRef,
        savedInputRef,
        scrollboxRef,
        setIsEditingQueue: (value) => setIsEditingQueue(value),
        textareaRef,
        updateWorkflowState,
        workflowState,
      })) {
        return;
      }

      if (handleComposeShortcutKey({
        event,
        textareaRef,
      })) {
        return;
      }

      if (handleAutocompleteSelectionKey({
        addMessage,
        autocompleteSuggestions,
        event,
        executeCommand,
        kittyKeyboardDetected: kittyKeyboardDetectedRef.current,
        textareaRef,
        updateWorkflowState,
        workflowState,
      })) {
        return;
      }

      if (event.name === "return" && !event.shift && !event.meta && isEditingQueue) {
        setIsEditingQueue(false);
      }

      setTimeout(() => {
        const textarea = textareaRef.current;
        const value = textarea?.plainText ?? "";
        handleInputChange(value, textarea?.cursorOffset ?? value.length);
        syncInputScrollbar();
      }, 0);
    }, [
      activeQuestion,
      autocompleteSuggestions,
      clipboard,
      continueQueuedConversation,
      emitMessageSubmitTelemetry,
      executeCommand,
      handleCtrlCKey,
      handleEscapeKey,
      handleInputChange,
      handleTextareaContentChange,
      handleCopy,
      historyIndexRef,
      historyNavigatingRef,
      isEditingQueue,
      isStreaming,
      kittyKeyboardDetectedRef,
      messageQueue,
      normalizePastedText,
      promptHistoryRef,
      savedInputRef,
      scrollboxRef,
      setIsEditingQueue,
      setShowTodoPanel,
      setTranscriptMode,
      showModelSelector,
      syncInputScrollbar,
      textareaRef,
      toggleVerbose,
      updateWorkflowState,
      workflowState,
    ]),
  );

  return {
    ctrlCPressed,
  };
}
