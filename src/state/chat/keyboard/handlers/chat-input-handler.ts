/**
 * Chat Input Handler — Clipboard Operations & Shortcut Keys
 *
 * Clipboard and global shortcut handling, isolated from the main
 * keyboard dispatch loop (`use-keyboard-ownership.ts`). These
 * handlers run in **all UI modes** (chat, dialog, model-selector).
 *
 * @module
 */

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import type { ClipboardAdapter } from "@/lib/ui/clipboard.ts";

// ── Clipboard handling ────────────────────────────────────────────────

export interface ClipboardHandlerArgs {
  clipboard: ClipboardAdapter;
  handleCopy: () => void | Promise<void>;
  handleTextareaContentChange: () => void;
  normalizePastedText: (text: string) => string;
  textareaRef: RefObject<TextareaRenderable | null>;
}

/**
 * Handle copy & paste keyboard shortcuts.
 *
 * Matches:
 * - **Copy:** Ctrl+Shift+C, Meta+Shift+C, Meta+C
 * - **Paste:** Ctrl+V, Meta+V
 *
 * @returns `true` if the event was consumed, `false` otherwise.
 */
export function handleClipboardKey(
  event: KeyEvent,
  {
    clipboard,
    handleCopy,
    handleTextareaContentChange,
    normalizePastedText,
    textareaRef,
  }: ClipboardHandlerArgs,
): boolean {
  // Copy: Ctrl+Shift+C / Meta+Shift+C
  // Case-insensitive: modifyOtherKeys encodes Ctrl+Shift+C with charCode 67 ('C')
  if ((event.ctrl || event.meta) && event.shift && event.name.toLowerCase() === "c") {
    void handleCopy();
    return true;
  }

  // Copy: Meta+C (macOS)
  if (event.meta && !event.ctrl && event.name.toLowerCase() === "c") {
    void handleCopy();
    return true;
  }

  // Paste: Ctrl+V / Meta+V
  // Case-insensitive: modifyOtherKeys may encode uppercase key names
  if ((event.ctrl || event.meta) && event.name.toLowerCase() === "v") {
    const textarea = textareaRef.current;
    if (textarea) {
      const clipboardText = clipboard.readText();
      if (clipboardText) {
        event.preventDefault();
        textarea.insertText(normalizePastedText(clipboardText));
        handleTextareaContentChange();
        return true;
      }
    }
  }

  return false;
}

// ── Ctrl+C interrupt detection ───────────────────────────────────────

/**
 * Detect a Ctrl+C interrupt key event (Ctrl+C without Shift).
 *
 * Case-insensitive: `modifyOtherKeys` may encode the key name as
 * uppercase `"C"`.
 */
export function isCtrlCInterrupt(event: KeyEvent): boolean {
  return event.ctrl && !event.shift && event.name.toLowerCase() === "c";
}

// ── Shortcut keys (chat mode only) ───────────────────────────────────

export interface ShortcutHandlerArgs {
  setTranscriptMode: Dispatch<SetStateAction<boolean>>;
  toggleVerbose: () => void;
  setShowTodoPanel: Dispatch<SetStateAction<boolean>>;
}

/**
 * Handle mode-toggle shortcut keys.
 *
 * Matches:
 * - **Ctrl+O:** Toggle transcript mode
 * - **Ctrl+E:** Toggle verbose output
 * - **Ctrl+T:** Toggle todo panel
 *
 * These shortcuts only apply in chat mode (not during dialogs).
 *
 * @returns `true` if the event was consumed, `false` otherwise.
 */
export function handleShortcutKey(
  event: KeyEvent,
  {
    setTranscriptMode,
    toggleVerbose,
    setShowTodoPanel,
  }: ShortcutHandlerArgs,
): boolean {
  if (event.ctrl && event.name.toLowerCase() === "o") {
    setTranscriptMode((previous) => !previous);
    return true;
  }

  if (event.ctrl && event.name.toLowerCase() === "e") {
    toggleVerbose();
    return true;
  }

  if (event.ctrl && !event.shift && event.name.toLowerCase() === "t") {
    setShowTodoPanel((previous) => !previous);
    return true;
  }

  return false;
}

// ── Post-dispatch reconciliation ─────────────────────────────────────

/**
 * Schedule a zero-delay reconciliation of the input state after the
 * framework has processed the key event into the textarea.
 *
 * By naming this explicitly, the timing dependency is documented and
 * reviewable.
 *
 * The reconciliation reads the current textarea value and cursor
 * position, then drives autocomplete derivation and scrollbar sync.
 */
export function postDispatchReconciliation(
  textareaRef: RefObject<TextareaRenderable | null>,
  handleInputChange: (rawValue: string, cursorOffset: number) => void,
  syncInputScrollbar: () => void,
): void {
  setTimeout(() => {
    const textarea = textareaRef.current;
    const value = textarea?.plainText ?? "";
    handleInputChange(value, textarea?.cursorOffset ?? value.length);
    syncInputScrollbar();
  }, 0);
}
