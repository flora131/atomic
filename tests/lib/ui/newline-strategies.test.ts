import { describe, expect, test } from "bun:test";

import {
  isBareLinefeedEvent,
  shouldApplyBackslashLineContinuation,
  shouldInsertNewlineFromKeyEvent,
} from "@/state/chat/shared/helpers/newline-strategies.ts";

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
