/**
 * Unit tests for privacy-safe key press diagnostic logging.
 *
 * Covers:
 * 1. getPrivacySafeKeyName: privacy rules (redaction, named keys, modifier combos)
 * 2. Diagnostic writer registry: set/get/clear lifecycle
 * 3. Schema validation: key press entries follow the correct JSONL structure
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import {
  getPrivacySafeKeyName,
  LOGGABLE_NAMED_KEYS,
} from "@/state/chat/keyboard/use-keyboard-ownership.ts";
import {
  setActiveDiagnosticWriter,
  clearActiveDiagnosticWriter,
  getActiveDiagnosticWriter,
} from "@/services/events/debug-subscriber/config.ts";
import type { DiagnosticLogEntry } from "@/services/events/debug-subscriber/config.ts";

// ─── Helper: build a minimal KeyEvent-shaped object for testing ───────────────

function makeKeyEvent(
  name: string,
  modifiers: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {},
): KeyEvent {
  return {
    name,
    ctrl: modifiers.ctrl ?? false,
    shift: modifiers.shift ?? false,
    meta: modifiers.meta ?? false,
    option: false,
    sequence: "",
    number: false,
    raw: "SHOULD_NEVER_APPEAR_IN_OUTPUT",
    eventType: "press",
    source: "raw",
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as KeyEvent;
}

// ─── Tests: LOGGABLE_NAMED_KEYS ──────────────────────────────────────────────

describe("LOGGABLE_NAMED_KEYS", () => {
  test("includes all required navigation keys", () => {
    const required = [
      "escape", "return", "tab", "backspace", "delete",
      "pageup", "pagedown", "up", "down", "left", "right",
      "home", "end",
    ];
    for (const key of required) {
      expect(LOGGABLE_NAMED_KEYS.has(key)).toBe(true);
    }
  });

  test("includes all function keys f1-f12", () => {
    for (let i = 1; i <= 12; i++) {
      expect(LOGGABLE_NAMED_KEYS.has(`f${i}`)).toBe(true);
    }
  });

  test("does NOT include single-char printable characters", () => {
    const printableChars = ["a", "b", "z", "1", "9", " "];
    // space is actually a named key, skip that
    const nonSpacePrintable = printableChars.filter((c) => c !== " ");
    for (const char of nonSpacePrintable) {
      expect(LOGGABLE_NAMED_KEYS.has(char)).toBe(false);
    }
  });
});

// ─── Tests: getPrivacySafeKeyName ────────────────────────────────────────────

describe("getPrivacySafeKeyName — privacy rules", () => {
  describe("named navigation/control keys (no modifier)", () => {
    test("returns 'escape' for the escape key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("escape"))).toBe("escape");
    });

    test("returns 'return' for the return key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("return"))).toBe("return");
    });

    test("returns 'tab' for the tab key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("tab"))).toBe("tab");
    });

    test("returns 'backspace' for the backspace key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("backspace"))).toBe("backspace");
    });

    test("returns 'delete' for the delete key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("delete"))).toBe("delete");
    });

    test("returns 'up' for the up arrow key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("up"))).toBe("up");
    });

    test("returns 'down' for the down arrow key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("down"))).toBe("down");
    });

    test("returns 'left' for the left arrow key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("left"))).toBe("left");
    });

    test("returns 'right' for the right arrow key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("right"))).toBe("right");
    });

    test("returns 'pageup' for the page-up key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("pageup"))).toBe("pageup");
    });

    test("returns 'pagedown' for the page-down key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("pagedown"))).toBe("pagedown");
    });

    test("returns 'home' for the home key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("home"))).toBe("home");
    });

    test("returns 'end' for the end key", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("end"))).toBe("end");
    });

    test("returns 'f1' through 'f12' for function keys", () => {
      for (let i = 1; i <= 12; i++) {
        expect(getPrivacySafeKeyName(makeKeyEvent(`f${i}`))).toBe(`f${i}`);
      }
    });

    test("handles uppercase key names by lowercasing them", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("ESCAPE"))).toBe("escape");
      expect(getPrivacySafeKeyName(makeKeyEvent("RETURN"))).toBe("return");
    });
  });

  describe("single-char printable keys WITHOUT modifiers — redacted", () => {
    test("returns null for single-char letter key 'a'", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("a"))).toBeNull();
    });

    test("returns null for single-char letter key 'z'", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("z"))).toBeNull();
    });

    test("returns null for single-char digit key '1'", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("1"))).toBeNull();
    });

    test("returns null for single-char punctuation key '!'", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("!"))).toBeNull();
    });

    test("returns null for single-char punctuation key '.'", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("."))).toBeNull();
    });
  });

  describe("modifier combos (ctrl+key)", () => {
    test("returns 'ctrl+c' for Ctrl+C", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("c", { ctrl: true }))).toBe("ctrl+c");
    });

    test("returns 'ctrl+o' for Ctrl+O", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("o", { ctrl: true }))).toBe("ctrl+o");
    });

    test("returns 'ctrl+escape' for Ctrl+Escape", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("escape", { ctrl: true }))).toBe("ctrl+escape");
    });

    test("returns 'ctrl+a' for Ctrl+A (select-all hotkey)", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("a", { ctrl: true }))).toBe("ctrl+a");
    });

    test("returns 'ctrl+z' for Ctrl+Z (undo hotkey)", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("z", { ctrl: true }))).toBe("ctrl+z");
    });
  });

  describe("modifier combos (meta+key)", () => {
    test("returns 'meta+f' for Meta+F", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("f", { meta: true }))).toBe("meta+f");
    });

    test("returns 'meta+b' for Meta+B", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("b", { meta: true }))).toBe("meta+b");
    });

    test("returns 'meta+return' for Meta+Enter", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("return", { meta: true }))).toBe("meta+return");
    });
  });

  describe("modifier combos (ctrl+meta+key)", () => {
    test("returns 'ctrl+meta+c' for Ctrl+Meta+C", () => {
      expect(getPrivacySafeKeyName(makeKeyEvent("c", { ctrl: true, meta: true }))).toBe("ctrl+meta+c");
    });
  });

  describe("privacy: raw field is never included", () => {
    test("output string does NOT contain the raw field value", () => {
      const event = makeKeyEvent("a", { ctrl: true });
      const keyName = getPrivacySafeKeyName(event);
      expect(keyName).not.toContain("SHOULD_NEVER_APPEAR_IN_OUTPUT");
    });

    test("named key output does NOT contain the raw field value", () => {
      const event = makeKeyEvent("escape");
      const keyName = getPrivacySafeKeyName(event);
      expect(keyName).not.toContain("SHOULD_NEVER_APPEAR_IN_OUTPUT");
    });
  });
});

// ─── Tests: diagnostic writer registry ───────────────────────────────────────

describe("diagnostic writer registry", () => {
  afterEach(() => {
    clearActiveDiagnosticWriter();
  });

  test("getActiveDiagnosticWriter() returns undefined before any writer is set", () => {
    clearActiveDiagnosticWriter();
    expect(getActiveDiagnosticWriter()).toBeUndefined();
  });

  test("setActiveDiagnosticWriter() stores the writer and getActiveDiagnosticWriter() returns it", () => {
    const mockWriter = (_entry: Omit<DiagnosticLogEntry, "seq" | "ts">) => {};
    setActiveDiagnosticWriter(mockWriter);
    expect(getActiveDiagnosticWriter()).toBe(mockWriter);
  });

  test("clearActiveDiagnosticWriter() removes the stored writer", () => {
    const mockWriter = (_entry: Omit<DiagnosticLogEntry, "seq" | "ts">) => {};
    setActiveDiagnosticWriter(mockWriter);
    clearActiveDiagnosticWriter();
    expect(getActiveDiagnosticWriter()).toBeUndefined();
  });
});

// ─── Tests: key press diagnostic entry schema ─────────────────────────────────

describe("key press diagnostic entry schema", () => {
  const capturedEntries: Array<Omit<DiagnosticLogEntry, "seq" | "ts">> = [];

  beforeEach(() => {
    capturedEntries.length = 0;
    setActiveDiagnosticWriter((entry) => {
      capturedEntries.push(entry);
    });
  });

  afterEach(() => {
    clearActiveDiagnosticWriter();
  });

  test("entry has category 'key_press'", () => {
    const writeDiagnostic = getActiveDiagnosticWriter()!;
    writeDiagnostic({
      category: "key_press",
      keyName: "escape",
      modifiers: { ctrl: false, shift: false, meta: false },
      eventType: "press",
      owner: "chat",
    });
    expect(capturedEntries.length).toBe(1);
    expect(capturedEntries[0]?.category).toBe("key_press");
  });

  test("entry includes keyName field", () => {
    const writeDiagnostic = getActiveDiagnosticWriter()!;
    writeDiagnostic({
      category: "key_press",
      keyName: "ctrl+c",
      modifiers: { ctrl: true, shift: false, meta: false },
      eventType: "press",
      owner: "chat",
    });
    expect(capturedEntries[0]?.keyName).toBe("ctrl+c");
  });

  test("entry includes modifiers object with ctrl/shift/meta fields", () => {
    const writeDiagnostic = getActiveDiagnosticWriter()!;
    writeDiagnostic({
      category: "key_press",
      keyName: "ctrl+c",
      modifiers: { ctrl: true, shift: false, meta: false },
      eventType: "press",
      owner: "chat",
    });
    const entry = capturedEntries[0];
    expect(entry?.modifiers).toEqual({ ctrl: true, shift: false, meta: false });
  });

  test("entry includes eventType field", () => {
    const writeDiagnostic = getActiveDiagnosticWriter()!;
    writeDiagnostic({
      category: "key_press",
      keyName: "escape",
      modifiers: { ctrl: false, shift: false, meta: false },
      eventType: "release",
      owner: "chat",
    });
    expect(capturedEntries[0]?.eventType).toBe("release");
  });

  test("entry includes owner field", () => {
    const writeDiagnostic = getActiveDiagnosticWriter()!;
    writeDiagnostic({
      category: "key_press",
      keyName: "escape",
      modifiers: { ctrl: false, shift: false, meta: false },
      eventType: "press",
      owner: "dialog",
    });
    expect(capturedEntries[0]?.owner).toBe("dialog");
  });

  test("entry does NOT include raw field", () => {
    const writeDiagnostic = getActiveDiagnosticWriter()!;
    writeDiagnostic({
      category: "key_press",
      keyName: "escape",
      modifiers: { ctrl: false, shift: false, meta: false },
      eventType: "press",
      owner: "chat",
    });
    const entry = capturedEntries[0] as Record<string, unknown>;
    expect(entry?.["raw"]).toBeUndefined();
  });
});
