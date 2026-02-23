import { describe, expect, test } from "bun:test";
import { isBackgroundTerminationKey } from "./background-agent-termination.ts";

describe("background-agent keybinding non-conflict", () => {
  test("Ctrl+O is NOT detected as background termination key", () => {
    // Ctrl+O is used for transcript toggle
    expect(isBackgroundTerminationKey({ ctrl: true, name: "o" })).toBe(false);
  });

  test("Ctrl+C is NOT detected as background termination key", () => {
    // Ctrl+C is used for interruption
    expect(isBackgroundTerminationKey({ ctrl: true, name: "c" })).toBe(false);
  });

  test("Ctrl+F IS detected as background termination key", () => {
    expect(isBackgroundTerminationKey({ ctrl: true, name: "f" })).toBe(true);
  });

  test("Ctrl+Shift+F is NOT detected (modifier exclusion)", () => {
    expect(isBackgroundTerminationKey({ ctrl: true, shift: true, name: "f" })).toBe(false);
  });

  test("Ctrl+Meta+F is NOT detected (modifier exclusion)", () => {
    expect(isBackgroundTerminationKey({ ctrl: true, meta: true, name: "f" })).toBe(false);
  });

  test("plain F without Ctrl is NOT detected", () => {
    expect(isBackgroundTerminationKey({ name: "f" })).toBe(false);
  });

  test("common Ctrl+key combos do not conflict with background termination", () => {
    const nonConflictingKeys = ["a", "b", "c", "d", "e", "g", "h", "i", "j", "k", "l", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"];
    for (const key of nonConflictingKeys) {
      expect(isBackgroundTerminationKey({ ctrl: true, name: key })).toBe(false);
    }
  });

  test("Ctrl+F detected while Ctrl+O is not — simultaneous non-conflict", () => {
    const ctrlF = { ctrl: true, name: "f" };
    const ctrlO = { ctrl: true, name: "o" };
    
    expect(isBackgroundTerminationKey(ctrlF)).toBe(true);
    expect(isBackgroundTerminationKey(ctrlO)).toBe(false);
  });
});
