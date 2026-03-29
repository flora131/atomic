/**
 * useKeyboardOwnership — Single Entry Point for Keyboard Handling
 *
 * Replaces the former `useChatKeyboard` with a strategy-pattern design.
 * It determines the current {@link UIMode} via {@link determineUIMode}
 * and delegates `KeyEvent` handling to the appropriate focused handler:
 *
 * | Mode              | Behaviour                                         |
 * | ----------------- | ------------------------------------------------- |
 * | `chat`            | Full keyboard handling (navigation, shortcuts, …) |
 * | `dialog`          | Only global keys (copy/paste/Ctrl+C); dialog      |
 * |                   | component owns remaining keys via its handler      |
 * | `model-selector`  | Same as dialog                                    |
 *
 * The zero-delay post-key sync formerly at `use-keyboard.ts:221-226`
 * is absorbed into {@link postDispatchReconciliation}, making the
 * timing dependency explicit rather than implicit.
 *
 * @module
 */

import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";
import { getNextKittyKeyboardDetectionState } from "@/state/chat/keyboard/kitty-keyboard-detection.ts";
import { determineUIMode } from "@/state/chat/keyboard/focus-manager.ts";
import {
  handleClipboardKey,
  handleShortcutKey,
  isCtrlCInterrupt,
  postDispatchReconciliation,
} from "@/state/chat/keyboard/handlers/chat-input-handler.ts";
import {
  handleNavigationKey,
  handleComposeShortcutKey,
  handleAutocompleteSelectionKey,
} from "@/state/chat/keyboard/handlers/navigation-handler.ts";
import { useChatInterruptControls } from "@/state/chat/keyboard/handlers/interrupt-handler.ts";
import type { UseChatKeyboardArgs, KeyboardOwnershipResult } from "@/state/chat/keyboard/types.ts";

/**
 * Unified keyboard ownership hook.
 *
 * Registers a **single** `useKeyboard` listener at the controller
 * level that delegates key events through a strategy chain:
 *
 * 1. Kitty keyboard protocol detection (always)
 * 2. Global clipboard & Ctrl+C interrupt handling (always)
 * 3. Mode guard — if a dialog or model-selector is active, return early
 *    and let the dialog component's own handler process remaining keys.
 * 4. Chat-mode shortcuts (Ctrl+O, Ctrl+E, Ctrl+T)
 * 5. Escape handling (autocomplete dismiss, interrupt, queue exit)
 * 6. Navigation keys (page up/down, history, autocomplete nav)
 * 7. Compose shortcut keys (newline fallback)
 * 8. Autocomplete selection keys (tab, return)
 * 9. Queue editing return
 * 10. Post-dispatch reconciliation (explicit zero-delay input sync)
 */
export function useKeyboardOwnership({
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
}: UseChatKeyboardArgs): KeyboardOwnershipResult {
  // ── Interrupt controls ────────────────────────────────────────────
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

  // ── Strategy: determine active UI mode ────────────────────────────
  const mode = determineUIMode(activeQuestion, showModelSelector);

  // ── Single keyboard listener with strategy delegation ─────────────
  useKeyboard(
    useCallback((event: KeyEvent) => {
      // ┌─────────────────────────────────────────────────────────────┐
      // │ Phase 1 — Always (all modes)                               │
      // └─────────────────────────────────────────────────────────────┘

      // Kitty keyboard protocol detection
      kittyKeyboardDetectedRef.current = getNextKittyKeyboardDetectionState(
        kittyKeyboardDetectedRef.current,
        event.raw,
      );

      // Global clipboard operations (copy / paste)
      if (handleClipboardKey(event, {
        clipboard,
        handleCopy,
        handleTextareaContentChange,
        normalizePastedText,
        textareaRef,
      })) {
        return;
      }

      // Ctrl+C interrupt (runs in all modes)
      if (isCtrlCInterrupt(event)) {
        if (handleCtrlCKey(event)) {
          return;
        }
      }

      // ┌─────────────────────────────────────────────────────────────┐
      // │ Phase 2 — Mode guard                                       │
      // │ Dialog / model-selector modes: defer remaining keys to the  │
      // │ component-level handler that owns the dialog's local state. │
      // └─────────────────────────────────────────────────────────────┘
      if (mode === "dialog" || mode === "model-selector") {
        return;
      }

      // ┌─────────────────────────────────────────────────────────────┐
      // │ Phase 3 — Chat mode                                        │
      // └─────────────────────────────────────────────────────────────┘

      // Shortcut keys (Ctrl+O, Ctrl+E, Ctrl+T)
      if (handleShortcutKey(event, {
        setTranscriptMode,
        toggleVerbose,
        setShowTodoPanel,
      })) {
        return;
      }

      // Escape handling
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

      // Navigation keys (page up/down, arrow keys, history)
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

      // Compose shortcut keys (newline fallback)
      if (handleComposeShortcutKey({
        event,
        textareaRef,
      })) {
        return;
      }

      // Autocomplete selection keys (tab, return)
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

      // Queue editing return key
      if (event.name === "return" && !event.shift && !event.meta && isEditingQueue) {
        setIsEditingQueue(false);
      }

      // ┌─────────────────────────────────────────────────────────────┐
      // │ Phase 4 — Post-dispatch reconciliation                     │
      // │ Explicitly schedules a zero-delay sync to read the         │
      // │ textarea value after the framework processes the key event │
      // │ into the textarea. Previously implicit at                  │
      // │ use-keyboard.ts:221-226.                                   │
      // └─────────────────────────────────────────────────────────────┘
      postDispatchReconciliation(textareaRef, handleInputChange, syncInputScrollbar);
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
      mode,
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
