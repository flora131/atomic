import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";
import { getNextKittyKeyboardDetectionState } from "@/lib/ui/kitty-keyboard-detection.ts";
import {
  handleAutocompleteSelectionKey,
  handleComposeShortcutKey,
  handleNavigationKey,
} from "@/state/chat/keyboard/navigation.ts";
import type { UseChatKeyboardArgs } from "@/state/chat/keyboard/types.ts";
import { useChatInterruptControls } from "@/state/chat/keyboard/use-interrupt-controls.ts";

export function useChatKeyboard({
  activeBackgroundAgentCountRef,
  activeQuestion,
  addMessage,
  activeHitlToolCallIdRef,
  autocompleteSuggestions,
  awaitedStreamRunIdsRef,
  backgroundAgentMessageIdRef,
  clipboard,
  clearDeferredCompletion,
  continueQueuedConversation,
  emitMessageSubmitTelemetry,
  executeCommand,
  finalizeTaskItemsOnInterrupt,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  handleCopy,
  handleInputChange,
  handleTextareaContentChange,
  hasRendererSelection,
  historyIndexRef,
  historyNavigatingRef,
  isEditingQueue,
  isStreaming,
  isStreamingRef,
  kittyKeyboardDetectedRef,
  lastStreamedMessageIdRef,
  lastStreamingContentRef,
  messageQueue,
  normalizePastedText,
  onExit,
  onInterrupt,
  onTerminateBackgroundAgents,
  parallelAgents,
  parallelAgentsRef,
  parallelInterruptHandlerRef,
  promptHistoryRef,
  resetHitlState,
  resolveTrackedRun,
  savedInputRef,
  scrollboxRef,
  separateAndInterruptAgents,
  setActiveBackgroundAgentCount,
  setBackgroundAgentMessageId,
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
  workflowActiveRef,
  workflowState,
}: UseChatKeyboardArgs) {
  const {
    ctrlCPressed,
    ctrlFPressed,
    handleBackgroundTerminationKey,
    handleCtrlCKey,
    handleEscapeKey,
    isBackgroundTerminationKey,
  } = useChatInterruptControls({
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
    isStreamingRef,
    lastStreamedMessageIdRef,
    lastStreamingContentRef,
    onExit,
    onInterrupt,
    onTerminateBackgroundAgents,
    parallelAgents,
    parallelAgentsRef,
    parallelInterruptHandlerRef,
    resetHitlState,
    resolveTrackedRun,
    separateAndInterruptAgents,
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
  });

  useKeyboard(
    useCallback((event: KeyEvent) => {
      kittyKeyboardDetectedRef.current = getNextKittyKeyboardDetectionState(
        kittyKeyboardDetectedRef.current,
        event.raw,
      );

      if ((event.ctrl || event.meta) && event.name === "c") {
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

      if (isBackgroundTerminationKey(event)) {
        if (handleBackgroundTerminationKey()) {
          return;
        }
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

      if (event.ctrl && event.shift && event.name === "c") {
        void handleCopy();
        return;
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
      handleBackgroundTerminationKey,
      handleCtrlCKey,
      handleEscapeKey,
      handleInputChange,
      handleTextareaContentChange,
      handleCopy,
      historyIndexRef,
      historyNavigatingRef,
      isEditingQueue,
      isStreaming,
      isBackgroundTerminationKey,
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
    ctrlFPressed,
  };
}
