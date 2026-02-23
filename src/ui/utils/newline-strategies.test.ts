import { describe, expect, test } from "bun:test";

import {
  getEnqueueShortcutLabel,
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
});
