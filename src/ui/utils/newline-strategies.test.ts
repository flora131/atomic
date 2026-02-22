import { describe, expect, test } from "bun:test";

import {
  shouldApplyBackslashLineContinuation,
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
