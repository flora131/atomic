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

  test("does NOT activate for regular key modifyOtherKeys sequences (e.g., 'a')", () => {
    // modifyOtherKeys sends regular keys as CSI 27;modifier;keycode~
    // This should NOT trigger Kitty keyboard detection
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;1;97~")).toBe(false);
  });

  test("does NOT activate for Ctrl+A in modifyOtherKeys format", () => {
    // modifyOtherKeys: Ctrl (modifier=5) + 'a' (keycode=97)
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;5;97~")).toBe(false);
  });

  test("activates for Shift+Enter in modifyOtherKeys format", () => {
    // modifyOtherKeys: Shift (modifier=2) + Enter (keycode=13)
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;2;13~")).toBe(true);
  });

  test("activates for Ctrl+Enter in modifyOtherKeys format", () => {
    // modifyOtherKeys: Ctrl (modifier=5) + Enter (keycode=13)
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;5;13~")).toBe(true);
  });

  test("activates for Alt+Enter in modifyOtherKeys format", () => {
    // modifyOtherKeys: Alt (modifier=3) + Enter (keycode=13)
    expect(getNextKittyKeyboardDetectionState(false, "\x1b[27;3;13~")).toBe(true);
  });

  test("once activated, stays activated (latch behavior)", () => {
    // Once true, always true
    expect(getNextKittyKeyboardDetectionState(true, undefined)).toBe(true);
    expect(getNextKittyKeyboardDetectionState(true, "\r")).toBe(true);
    expect(getNextKittyKeyboardDetectionState(true, "\x1b[27;1;97~")).toBe(true);
  });
});
