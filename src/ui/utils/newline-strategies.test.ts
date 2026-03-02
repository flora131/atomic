import { describe, expect, test } from "bun:test";

import {
  getEnqueueShortcutLabel,
  isBareLinefeedEvent,
  shouldApplyBackslashLineContinuation,
  shouldEnqueueMessageFromKeyEvent,
  shouldInsertNewlineFromKeyEvent,
} from "./newline-strategies.ts";

describe("newline strategies", () => {
  test("supports linefeed newline path for Ctrl+J-compatible terminals", () => {
    expect(
      shouldInsertNewlineFromKeyEvent({
        name: "linefeed",
        ctrl: false,
        shift: false,
        meta: false,
      }),
    ).toBe(true);
  });

  test("keeps modifyOtherKeys-style Shift+Enter newline compatibility", () => {
    expect(
      shouldInsertNewlineFromKeyEvent({
        name: "return",
        shift: false,
        raw: "\x1b[27;2;13~",
      }),
    ).toBe(true);
  });
});

describe("backslash fallback gating", () => {
  test("activates when kitty protocol is not detected and value ends with backslash", () => {
    expect(shouldApplyBackslashLineContinuation("line one\\", false)).toBe(true);
  });

  test("does not activate when kitty protocol is detected", () => {
    expect(shouldApplyBackslashLineContinuation("line one\\", true)).toBe(false);
  });
});

describe("enqueue shortcut handling", () => {
  test("uses Cmd+Shift+Enter on macOS", () => {
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "return", shift: true, meta: true, ctrl: false },
        "darwin",
      ),
    ).toBe(true);
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "return", shift: true, ctrl: true, meta: false },
        "darwin",
      ),
    ).toBe(false);
  });

  test("uses Ctrl+Shift+Enter on non-mac platforms", () => {
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "return", shift: true, ctrl: true, meta: false },
        "linux",
      ),
    ).toBe(true);
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "return", shift: true, meta: true, ctrl: false },
        "linux",
      ),
    ).toBe(false);
  });

  test("supports linefeed Enter variants for platform shortcuts", () => {
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "linefeed", shift: true, meta: true, ctrl: false },
        "darwin",
      ),
    ).toBe(true);
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "linefeed", shift: true, ctrl: true, meta: false },
        "win32",
      ),
    ).toBe(true);
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "linefeed", shift: true, meta: false, ctrl: false },
        "linux",
      ),
    ).toBe(false);
  });

  test("renders platform-aware shortcut labels", () => {
    expect(getEnqueueShortcutLabel("darwin")).toBe("cmd+shift+enter");
    expect(getEnqueueShortcutLabel("linux")).toBe("ctrl+shift+enter");
    expect(getEnqueueShortcutLabel("win32")).toBe("ctrl+shift+enter");
  });

  test("detects Ctrl+Shift+Enter from CSI-u raw sequence (non-mac)", () => {
    // \x1b[13;6u = Enter codepoint 13, modifier 6 (Ctrl+Shift)
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "undefined-key", raw: "\x1b[13;6u" },
        "win32",
      ),
    ).toBe(true);
    // Linefeed codepoint variant
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "undefined-key", raw: "\x1b[10;6u" },
        "linux",
      ),
    ).toBe(true);
  });

  test("detects Cmd+Shift+Enter from CSI-u raw sequence (macOS)", () => {
    // modifier 10 = 0b1001 + 1 = meta + shift (mods-1 = 9 → shift=1, meta=8)
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "undefined-key", raw: "\x1b[13;10u" },
        "darwin",
      ),
    ).toBe(true);
  });

  test("detects Ctrl+Shift+Enter from modifyOtherKeys raw sequence", () => {
    // \x1b[27;6;13~ = modifyOtherKeys modifier 6 (Ctrl+Shift), codepoint 13
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "return", raw: "\x1b[27;6;13~" },
        "win32",
      ),
    ).toBe(true);
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "return", raw: "\x1b[27;6;10~" },
        "linux",
      ),
    ).toBe(true);
  });

  test("does not detect enqueue from Shift-only CSI-u (no Ctrl)", () => {
    // modifier 2 = Shift only (mods-1=1, shift=1, ctrl=0)
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "undefined-key", raw: "\x1b[13;2u" },
        "win32",
      ),
    ).toBe(false);
  });

  test("does not detect enqueue from bare linefeed", () => {
    expect(
      shouldEnqueueMessageFromKeyEvent(
        { name: "linefeed", shift: false, ctrl: false, raw: "\n" },
        "win32",
      ),
    ).toBe(false);
  });
});

describe("isBareLinefeedEvent", () => {
  test("returns true for bare linefeed with no modifiers and raw \\n", () => {
    expect(isBareLinefeedEvent({
      name: "linefeed",
      shift: false,
      ctrl: false,
      meta: false,
      raw: "\n",
    })).toBe(true);
  });

  test("returns false when shift is set", () => {
    expect(isBareLinefeedEvent({
      name: "linefeed",
      shift: true,
      ctrl: false,
      meta: false,
      raw: "\n",
    })).toBe(false);
  });

  test("returns false for meta-linefeed (ESC+\\n)", () => {
    expect(isBareLinefeedEvent({
      name: "linefeed",
      shift: false,
      ctrl: false,
      meta: true,
      raw: "\x1b\n",
    })).toBe(false);
  });

  test("returns false for return events", () => {
    expect(isBareLinefeedEvent({
      name: "return",
      shift: false,
      ctrl: false,
      meta: false,
      raw: "\r",
    })).toBe(false);
  });

  test("returns false when raw is an escape sequence, not bare \\n", () => {
    expect(isBareLinefeedEvent({
      name: "linefeed",
      shift: false,
      ctrl: false,
      meta: false,
      raw: "\x1b[10u",
    })).toBe(false);
  });
});
