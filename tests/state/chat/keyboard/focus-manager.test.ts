/**
 * Unit tests for the determineUIMode pure function.
 *
 * This function has no React dependencies and can be tested directly.
 * It determines which keyboard ownership mode is active based on
 * observable UI state.
 */

import { describe, test, expect } from "bun:test";
import { determineUIMode } from "@/state/chat/keyboard/focus-manager.ts";

// ============================================================================
// Tests: determineUIMode
// ============================================================================

describe("determineUIMode", () => {
  test('returns "chat" when no dialog or selector is active', () => {
    expect(determineUIMode(null, false)).toBe("chat");
  });

  test('returns "dialog" when activeQuestion is present', () => {
    const question = { id: "q1", message: "test?", options: [] };
    expect(determineUIMode(question as any, false)).toBe("dialog");
  });

  test('returns "model-selector" when showModelSelector is true', () => {
    expect(determineUIMode(null, true)).toBe("model-selector");
  });

  test('"dialog" takes priority over "model-selector" when both active', () => {
    const question = { id: "q1", message: "test?", options: [] };
    expect(determineUIMode(question as any, true)).toBe("dialog");
  });

  test('returns "chat" with falsy activeQuestion values', () => {
    expect(determineUIMode(null, false)).toBe("chat");
    expect(determineUIMode(undefined as any, false)).toBe("chat");
  });

  test('returns "dialog" with any truthy activeQuestion object', () => {
    // Minimal truthy object should suffice
    expect(determineUIMode({} as any, false)).toBe("dialog");
  });

  test("showModelSelector false does not override to model-selector", () => {
    expect(determineUIMode(null, false)).toBe("chat");
  });
});
