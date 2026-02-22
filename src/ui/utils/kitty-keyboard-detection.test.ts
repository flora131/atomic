import { describe, expect, test } from "bun:test";

import { getNextKittyKeyboardDetectionState } from "./kitty-keyboard-detection.ts";

describe("kitty keyboard detection state", () => {
  test("does not activate for Backspace CSI-u", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[127u")).toBe(false);
  });

  test("does not activate for Tab CSI-u", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[9u")).toBe(false);
  });

  test("does not activate for plain Enter CSI-u (no modifier)", () => {
    // Plain \x1b[13u must NOT trigger — terminal may still send
    // Shift+Enter as "\" + "\r" requiring the backslash fallback.
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[13u")).toBe(false);
  });

  test("does not activate for plain Linefeed CSI-u (no modifier)", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[10u")).toBe(false);
  });

  test("activates for Shift+Enter CSI-u", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[13;2u")).toBe(true);
  });

  test("activates for Ctrl+Enter CSI-u", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[13;5u")).toBe(true);
  });

  test("does not activate for regular key modifyOtherKeys (e.g., 'a')", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;1;97~")).toBe(false);
  });

  test("does not activate for plain Enter modifyOtherKeys (modifier 1)", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;1;13~")).toBe(false);
  });

  test("activates for Shift+Enter modifyOtherKeys", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;2;13~")).toBe(true);
  });

  test("activates for Ctrl+Enter modifyOtherKeys", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;5;13~")).toBe(true);
  });

  test("once activated, stays activated (latch behavior)", () => {
    expect(getNextKittyKeyboardDetectionState(true, undefined)).toBe(true);
    expect(getNextKittyKeyboardDetectionState(true, "\r")).toBe(true);
  });

  test("does not activate for plain \\r", () => {
    expect(getNextKittyKeyboardDetectionState(false, "\r")).toBe(false);
  });
});
