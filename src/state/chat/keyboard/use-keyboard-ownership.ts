/**
 * useKeyboardOwnership — Single Entry Point for Keyboard Handling
 *
 * Single entry point for keyboard handling using a strategy-pattern design.
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
 * The zero-delay post-key sync is handled by
 * {@link postDispatchReconciliation}, making the timing dependency
 * explicit rather than implicit.
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
import { isPipelineDebug } from "@/services/events/pipeline-logger.ts";
import { getActiveDiagnosticWriter } from "@/services/events/debug-subscriber/index.ts";

/**
 * Named keys that are safe to log for diagnostic purposes.
 * These represent navigation/control keys, not printable characters the user types.
 */
export const LOGGABLE_NAMED_KEYS = new Set([
  "escape",
  "return",
  "enter",
  "tab",
  "backspace",
  "delete",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "f1", "f2", "f3", "f4", "f5", "f6",
  "f7", "f8", "f9", "f10", "f11", "f12",
  "insert",
  "space",
]);

/**
 * Determines the privacy-safe key name to log for a key event.
 *
 * Privacy rules:
 * - Named navigation/control keys are always safe to log.
 * - Modifier combos (ctrl+key, meta+key) are logged as hotkeys, not text input.
 * - Single-char printable keys without ctrl/meta are redacted to avoid logging user input.
 * - The raw field is never used.
 *
 * @returns The safe key name string, or null if the event should not be logged.
 */
export function getPrivacySafeKeyName(event: KeyEvent): string | null {
  const nameLower = event.name.toLowerCase();

  // Modifier combos (ctrl or meta) are logged as hotkey identifiers.
  // Single-char key names in modifier combos are included (e.g. "ctrl+c").
  if (event.ctrl || event.meta) {
    const modPrefix = event.ctrl && event.meta
      ? "ctrl+meta+"
      : event.ctrl
        ? "ctrl+"
        : "meta+";
    return modPrefix + nameLower;
  }

  // Named navigation/control keys are always safe to log.
  if (LOGGABLE_NAMED_KEYS.has(nameLower)) {
    return nameLower;
  }

  // Single-char printable key names without modifiers represent text input — redact.
  // Multi-char names not in LOGGABLE_NAMED_KEYS are also suppressed to be safe.
  return null;
}

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
      // │ Phase 0 — Diagnostic logging (gated on DEBUG=1)            │
      // └─────────────────────────────────────────────────────────────┘
      if (isPipelineDebug()) {
        const writeDiagnostic = getActiveDiagnosticWriter();
        if (writeDiagnostic) {
          const keyName = getPrivacySafeKeyName(event);
          if (keyName !== null) {
            writeDiagnostic({
              category: "key_press",
              keyName,
              modifiers: {
                ctrl: event.ctrl,
                shift: event.shift,
                meta: event.meta,
              },
              eventType: event.eventType,
              owner: mode,
            });
          }
        }
      }

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
      // │ into the textarea.                                         │
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
