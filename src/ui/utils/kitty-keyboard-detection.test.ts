import { describe, expect, test } from "bun:test";

import { getNextKittyKeyboardDetectionState } from "./kitty-keyboard-detection.ts";

describe("kitty keyboard detection state", () => {
  test("does not activate for Backspace CSI-u", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[127u")).toBe(false);
  });

  test("does not activate for Tab CSI-u", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[9u")).toBe(false);
  });

  test("activates for Enter CSI-u", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[13u")).toBe(true);
  });

  test("activates for Shift+Enter CSI-u", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[13;2u")).toBe(true);
  });
});
