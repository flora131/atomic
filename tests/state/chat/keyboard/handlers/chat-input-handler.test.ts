/**
 * Unit tests for the chat-input-handler pure functions.
 *
 * These functions are extracted from the keyboard dispatch loop and are
 * fully testable in isolation. Tests cover:
 * - handleClipboardKey: copy & paste keyboard shortcuts
 * - handleShortcutKey: mode-toggle shortcuts (Ctrl+O, Ctrl+E, Ctrl+T)
 * - postDispatchReconciliation: zero-delay textarea reconciliation
 */

import { describe, test, expect, mock } from "bun:test";
import {
  handleClipboardKey,
  handleShortcutKey,
  postDispatchReconciliation,
  type ClipboardHandlerArgs,
  type ShortcutHandlerArgs,
} from "@/state/chat/keyboard/handlers/chat-input-handler.ts";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import type { ClipboardAdapter } from "@/lib/ui/clipboard.ts";
import type { RefObject } from "react";

// ============================================================================
// Helpers
// ============================================================================

function createKeyEvent(
  overrides: Partial<KeyEvent> = {},
): KeyEvent {
  return {
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
    sequence: "",
    preventDefault: mock(() => {}),
    ...overrides,
  } as unknown as KeyEvent;
}

function createClipboardArgs(
  overrides: Partial<ClipboardHandlerArgs> = {},
): ClipboardHandlerArgs {
  return {
    clipboard: {
      readText: mock(() => ""),
      writeText: mock(() => {}),
    } as unknown as ClipboardAdapter,
    handleCopy: mock(() => {}),
    handleTextareaContentChange: mock(() => {}),
    normalizePastedText: mock((text: string) => text),
    textareaRef: { current: null },
    ...overrides,
  };
}

function createShortcutArgs(
  overrides: Partial<ShortcutHandlerArgs> = {},
): ShortcutHandlerArgs {
  return {
    setTranscriptMode: mock(() => {}),
    toggleVerbose: mock(() => {}),
    setShowTodoPanel: mock(() => {}),
    ...overrides,
  };
}

function createMockTextarea(
  overrides: Partial<TextareaRenderable> = {},
): TextareaRenderable {
  return {
    plainText: "existing text",
    cursorOffset: 5,
    insertText: mock(() => {}),
    ...overrides,
  } as unknown as TextareaRenderable;
}

// ============================================================================
// handleClipboardKey
// ============================================================================

describe("handleClipboardKey", () => {
  // ── Copy shortcuts ──────────────────────────────────────────────────

  describe("copy shortcuts", () => {
    test("Ctrl+Shift+C triggers handleCopy and returns true", () => {
      const event = createKeyEvent({ ctrl: true, shift: true, name: "c" });
      const args = createClipboardArgs();

      const result = handleClipboardKey(event, args);

      expect(result).toBe(true);
      expect(args.handleCopy).toHaveBeenCalledTimes(1);
    });

    test("Meta+Shift+C triggers handleCopy and returns true", () => {
      const event = createKeyEvent({ meta: true, shift: true, name: "c" });
      const args = createClipboardArgs();

      const result = handleClipboardKey(event, args);

      expect(result).toBe(true);
      expect(args.handleCopy).toHaveBeenCalledTimes(1);
    });

    test("Meta+C (without ctrl) triggers handleCopy and returns true", () => {
      const event = createKeyEvent({ meta: true, ctrl: false, name: "c" });
      const args = createClipboardArgs();

      const result = handleClipboardKey(event, args);

      expect(result).toBe(true);
      expect(args.handleCopy).toHaveBeenCalledTimes(1);
    });

    test("Ctrl+C without shift does NOT trigger copy (not matched by first branch, and not meta-only)", () => {
      const event = createKeyEvent({ ctrl: true, shift: false, name: "c" });
      const args = createClipboardArgs();

      const result = handleClipboardKey(event, args);

      // Ctrl+C without shift doesn't match (ctrl||meta)&&shift&&c,
      // and doesn't match meta&&!ctrl&&c (it has ctrl, no meta)
      expect(result).toBe(false);
      expect(args.handleCopy).not.toHaveBeenCalled();
    });
  });

  // ── Paste shortcuts ─────────────────────────────────────────────────

  describe("paste shortcuts", () => {
    test("Ctrl+V with clipboard text triggers paste and returns true", () => {
      const textarea = createMockTextarea();
      const event = createKeyEvent({ ctrl: true, name: "v" });
      const args = createClipboardArgs({
        clipboard: {
          readText: mock(() => "pasted content"),
          writeText: mock(() => {}),
        } as unknown as ClipboardAdapter,
        textareaRef: { current: textarea },
      });

      const result = handleClipboardKey(event, args);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(textarea.insertText).toHaveBeenCalledTimes(1);
      expect(textarea.insertText).toHaveBeenCalledWith("pasted content");
      expect(args.handleTextareaContentChange).toHaveBeenCalledTimes(1);
    });

    test("Meta+V with clipboard text triggers paste and returns true", () => {
      const textarea = createMockTextarea();
      const event = createKeyEvent({ meta: true, name: "v" });
      const args = createClipboardArgs({
        clipboard: {
          readText: mock(() => "meta paste"),
          writeText: mock(() => {}),
        } as unknown as ClipboardAdapter,
        textareaRef: { current: textarea },
      });

      const result = handleClipboardKey(event, args);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(textarea.insertText).toHaveBeenCalledWith("meta paste");
      expect(args.handleTextareaContentChange).toHaveBeenCalledTimes(1);
    });

    test("paste calls normalizePastedText before inserting", () => {
      const textarea = createMockTextarea();
      const event = createKeyEvent({ ctrl: true, name: "v" });
      const normalizePastedText = mock((text: string) => text.toUpperCase());
      const args = createClipboardArgs({
        clipboard: {
          readText: mock(() => "hello"),
          writeText: mock(() => {}),
        } as unknown as ClipboardAdapter,
        textareaRef: { current: textarea },
        normalizePastedText,
      });

      handleClipboardKey(event, args);

      expect(normalizePastedText).toHaveBeenCalledWith("hello");
      expect(textarea.insertText).toHaveBeenCalledWith("HELLO");
    });

    test("Ctrl+V with empty clipboard text returns false", () => {
      const textarea = createMockTextarea();
      const event = createKeyEvent({ ctrl: true, name: "v" });
      const args = createClipboardArgs({
        clipboard: {
          readText: mock(() => ""),
          writeText: mock(() => {}),
        } as unknown as ClipboardAdapter,
        textareaRef: { current: textarea },
      });

      const result = handleClipboardKey(event, args);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(textarea.insertText).not.toHaveBeenCalled();
    });

    test("Ctrl+V with null textareaRef.current returns false", () => {
      const event = createKeyEvent({ ctrl: true, name: "v" });
      const args = createClipboardArgs({
        clipboard: {
          readText: mock(() => "some text"),
          writeText: mock(() => {}),
        } as unknown as ClipboardAdapter,
        textareaRef: { current: null },
      });

      const result = handleClipboardKey(event, args);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  // ── Unmatched keys ──────────────────────────────────────────────────

  describe("unmatched keys", () => {
    test("regular key 'a' returns false", () => {
      const event = createKeyEvent({ name: "a" });
      const args = createClipboardArgs();

      expect(handleClipboardKey(event, args)).toBe(false);
    });

    test("Ctrl+X returns false (not handled)", () => {
      const event = createKeyEvent({ ctrl: true, name: "x" });
      const args = createClipboardArgs();

      expect(handleClipboardKey(event, args)).toBe(false);
    });

    test("Shift+C without ctrl/meta returns false", () => {
      const event = createKeyEvent({ shift: true, name: "c" });
      const args = createClipboardArgs();

      expect(handleClipboardKey(event, args)).toBe(false);
    });

    test("plain 'v' without modifiers returns false", () => {
      const event = createKeyEvent({ name: "v" });
      const args = createClipboardArgs();

      expect(handleClipboardKey(event, args)).toBe(false);
    });
  });
});

// ============================================================================
// handleShortcutKey
// ============================================================================

describe("handleShortcutKey", () => {
  test("Ctrl+O calls setTranscriptMode and returns true", () => {
    const event = createKeyEvent({ ctrl: true, name: "o" });
    const args = createShortcutArgs();

    const result = handleShortcutKey(event, args);

    expect(result).toBe(true);
    expect(args.setTranscriptMode).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+O passes a toggling function to setTranscriptMode", () => {
    const event = createKeyEvent({ ctrl: true, name: "o" });
    let capturedUpdater: ((prev: boolean) => boolean) | undefined;
    const setTranscriptMode = mock((fn: boolean | ((prev: boolean) => boolean)) => {
      if (typeof fn === "function") capturedUpdater = fn;
    });
    const args = createShortcutArgs({ setTranscriptMode: setTranscriptMode as any });

    handleShortcutKey(event, args);

    expect(capturedUpdater).toBeDefined();
    expect(capturedUpdater!(true)).toBe(false);
    expect(capturedUpdater!(false)).toBe(true);
  });

  test("Ctrl+E calls toggleVerbose and returns true", () => {
    const event = createKeyEvent({ ctrl: true, name: "e" });
    const args = createShortcutArgs();

    const result = handleShortcutKey(event, args);

    expect(result).toBe(true);
    expect(args.toggleVerbose).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+T (without shift) calls setShowTodoPanel and returns true", () => {
    const event = createKeyEvent({ ctrl: true, shift: false, name: "t" });
    const args = createShortcutArgs();

    const result = handleShortcutKey(event, args);

    expect(result).toBe(true);
    expect(args.setShowTodoPanel).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+T passes a toggling function to setShowTodoPanel", () => {
    const event = createKeyEvent({ ctrl: true, shift: false, name: "t" });
    let capturedUpdater: ((prev: boolean) => boolean) | undefined;
    const setShowTodoPanel = mock((fn: boolean | ((prev: boolean) => boolean)) => {
      if (typeof fn === "function") capturedUpdater = fn;
    });
    const args = createShortcutArgs({ setShowTodoPanel: setShowTodoPanel as any });

    handleShortcutKey(event, args);

    expect(capturedUpdater).toBeDefined();
    expect(capturedUpdater!(true)).toBe(false);
    expect(capturedUpdater!(false)).toBe(true);
  });

  test("Ctrl+Shift+T does NOT match (shift guard) and returns false", () => {
    const event = createKeyEvent({ ctrl: true, shift: true, name: "t" });
    const args = createShortcutArgs();

    const result = handleShortcutKey(event, args);

    expect(result).toBe(false);
    expect(args.setShowTodoPanel).not.toHaveBeenCalled();
  });

  describe("unmatched keys", () => {
    test("plain 'o' without ctrl returns false", () => {
      const event = createKeyEvent({ name: "o" });
      const args = createShortcutArgs();

      expect(handleShortcutKey(event, args)).toBe(false);
    });

    test("Meta+O returns false (requires ctrl)", () => {
      const event = createKeyEvent({ meta: true, name: "o" });
      const args = createShortcutArgs();

      expect(handleShortcutKey(event, args)).toBe(false);
    });

    test("Ctrl+Z returns false (unrecognized shortcut)", () => {
      const event = createKeyEvent({ ctrl: true, name: "z" });
      const args = createShortcutArgs();

      expect(handleShortcutKey(event, args)).toBe(false);
    });

    test("no handler callbacks are invoked for unmatched key", () => {
      const event = createKeyEvent({ name: "x" });
      const args = createShortcutArgs();

      handleShortcutKey(event, args);

      expect(args.setTranscriptMode).not.toHaveBeenCalled();
      expect(args.toggleVerbose).not.toHaveBeenCalled();
      expect(args.setShowTodoPanel).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// postDispatchReconciliation
// ============================================================================

describe("postDispatchReconciliation", () => {
  test("calls handleInputChange with textarea value and cursor offset after setTimeout(0)", async () => {
    const textarea = createMockTextarea({
      plainText: "hello world",
      cursorOffset: 7,
    });
    const textareaRef: RefObject<TextareaRenderable | null> = { current: textarea };
    const handleInputChange = mock((_rawValue: string, _cursorOffset: number) => {});
    const syncInputScrollbar = mock(() => {});

    postDispatchReconciliation(textareaRef, handleInputChange, syncInputScrollbar);

    // The callback is deferred via setTimeout(0), so it hasn't fired yet
    expect(handleInputChange).not.toHaveBeenCalled();

    // Wait for the macrotask to fire
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handleInputChange).toHaveBeenCalledTimes(1);
    expect(handleInputChange).toHaveBeenCalledWith("hello world", 7);
  });

  test("calls syncInputScrollbar after setTimeout(0)", async () => {
    const textarea = createMockTextarea();
    const textareaRef: RefObject<TextareaRenderable | null> = { current: textarea };
    const handleInputChange = mock((_rawValue: string, _cursorOffset: number) => {});
    const syncInputScrollbar = mock(() => {});

    postDispatchReconciliation(textareaRef, handleInputChange, syncInputScrollbar);

    expect(syncInputScrollbar).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(syncInputScrollbar).toHaveBeenCalledTimes(1);
  });

  test("handles null textareaRef.current gracefully (uses empty string and value.length)", async () => {
    const textareaRef: RefObject<TextareaRenderable | null> = { current: null };
    const handleInputChange = mock((_rawValue: string, _cursorOffset: number) => {});
    const syncInputScrollbar = mock(() => {});

    postDispatchReconciliation(textareaRef, handleInputChange, syncInputScrollbar);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handleInputChange).toHaveBeenCalledTimes(1);
    expect(handleInputChange).toHaveBeenCalledWith("", 0);
    expect(syncInputScrollbar).toHaveBeenCalledTimes(1);
  });

  test("reads textarea state at execution time, not at scheduling time", async () => {
    const textarea = createMockTextarea({
      plainText: "initial",
      cursorOffset: 3,
    });
    const textareaRef: RefObject<TextareaRenderable | null> = { current: textarea };
    const handleInputChange = mock((_rawValue: string, _cursorOffset: number) => {});
    const syncInputScrollbar = mock(() => {});

    postDispatchReconciliation(textareaRef, handleInputChange, syncInputScrollbar);

    // Change the textarea ref before the timeout fires
    const updatedTextarea = createMockTextarea({
      plainText: "updated",
      cursorOffset: 4,
    });
    textareaRef.current = updatedTextarea;

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should read the updated values, since it reads at execution time
    expect(handleInputChange).toHaveBeenCalledWith("updated", 4);
  });

  test("uses value.length as cursor fallback when cursorOffset is undefined", async () => {
    const textarea = {
      plainText: "hello",
      cursorOffset: undefined,
      insertText: mock(() => {}),
    } as unknown as TextareaRenderable;
    const textareaRef: RefObject<TextareaRenderable | null> = { current: textarea };
    const handleInputChange = mock((_rawValue: string, _cursorOffset: number) => {});
    const syncInputScrollbar = mock(() => {});

    postDispatchReconciliation(textareaRef, handleInputChange, syncInputScrollbar);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // textarea?.cursorOffset is undefined, so fallback is value.length = 5
    expect(handleInputChange).toHaveBeenCalledWith("hello", 5);
  });
});
