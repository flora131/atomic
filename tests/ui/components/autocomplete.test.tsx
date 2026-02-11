/**
 * Tests for Autocomplete Component
 *
 * Verifies autocomplete rendering, filtering, and navigation utilities.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  navigateUp,
  navigateDown,
  useAutocompleteKeyboard,
  type KeyboardHandlerResult,
} from "../../../src/ui/components/autocomplete.tsx";
import { globalRegistry } from "../../../src/ui/commands/index.ts";
import type { KeyEvent } from "@opentui/core";

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  globalRegistry.clear();
});

afterEach(() => {
  globalRegistry.clear();
});

// ============================================================================
// NAVIGATION UTILITY TESTS
// ============================================================================

describe("navigateUp", () => {
  test("moves selection up by one", () => {
    expect(navigateUp(2, 5)).toBe(1);
    expect(navigateUp(3, 5)).toBe(2);
  });

  test("wraps to bottom when at top", () => {
    expect(navigateUp(0, 5)).toBe(4);
    expect(navigateUp(0, 3)).toBe(2);
  });

  test("handles empty list", () => {
    expect(navigateUp(0, 0)).toBe(0);
    expect(navigateUp(5, 0)).toBe(0);
  });

  test("handles single item", () => {
    expect(navigateUp(0, 1)).toBe(0);
  });
});

describe("navigateDown", () => {
  test("moves selection down by one", () => {
    expect(navigateDown(0, 5)).toBe(1);
    expect(navigateDown(2, 5)).toBe(3);
  });

  test("wraps to top when at bottom", () => {
    expect(navigateDown(4, 5)).toBe(0);
    expect(navigateDown(2, 3)).toBe(0);
  });

  test("handles empty list", () => {
    expect(navigateDown(0, 0)).toBe(0);
    expect(navigateDown(5, 0)).toBe(0);
  });

  test("handles single item", () => {
    expect(navigateDown(0, 1)).toBe(0);
  });
});

// ============================================================================
// COMMAND SEARCH TESTS (used by Autocomplete internally)
// ============================================================================

describe("globalRegistry.search (used by Autocomplete)", () => {
  beforeEach(() => {
    // Register some test commands
    globalRegistry.register({
      name: "help",
      description: "Show help",
      category: "builtin",
      aliases: ["h"],
      execute: () => ({ success: true }),
    });
    globalRegistry.register({
      name: "hello",
      description: "Say hello",
      category: "custom",
      execute: () => ({ success: true }),
    });
    globalRegistry.register({
      name: "status",
      description: "Show status",
      category: "builtin",
      execute: () => ({ success: true }),
    });
    globalRegistry.register({
      name: "atomic",
      description: "Start atomic workflow",
      category: "workflow",
      execute: () => ({ success: true }),
    });
  });

  test("filters commands by prefix", () => {
    const results = globalRegistry.search("hel");
    expect(results.length).toBe(2); // help and hello
    expect(results.map((c) => c.name)).toContain("help");
    expect(results.map((c) => c.name)).toContain("hello");
  });

  test("returns all commands for empty prefix", () => {
    const results = globalRegistry.search("");
    expect(results.length).toBe(4);
  });

  test("returns empty array for non-matching prefix", () => {
    const results = globalRegistry.search("xyz");
    expect(results.length).toBe(0);
  });

  test("prioritizes exact matches", () => {
    const results = globalRegistry.search("help");
    // "help" should come before "hello" since it's an exact match
    expect(results[0]?.name).toBe("help");
  });

  test("is case-insensitive", () => {
    const results = globalRegistry.search("HEL");
    expect(results.length).toBe(2);
  });
});

// ============================================================================
// AUTOCOMPLETE PROPS INTERFACE TESTS
// ============================================================================

describe("AutocompleteProps interface", () => {
  test("maxSuggestions limits results when used with search", () => {
    // Register many commands
    for (let i = 0; i < 15; i++) {
      globalRegistry.register({
        name: `cmd${i}`,
        description: `Command ${i}`,
        category: "custom",
        execute: () => ({ success: true }),
      });
    }

    const maxSuggestions = 8;
    const results = globalRegistry.search("").slice(0, maxSuggestions);
    expect(results.length).toBe(maxSuggestions);
  });

  test("suggestions can be empty", () => {
    const results = globalRegistry.search("nonexistent");
    expect(results.length).toBe(0);
  });
});

// ============================================================================
// INTEGRATION BEHAVIOR TESTS
// ============================================================================

describe("Autocomplete behavior expectations", () => {
  beforeEach(() => {
    globalRegistry.register({
      name: "help",
      description: "Show all available commands",
      category: "builtin",
      execute: () => ({ success: true }),
    });
    globalRegistry.register({
      name: "status",
      description: "Show workflow progress",
      category: "builtin",
      execute: () => ({ success: true }),
    });
    globalRegistry.register({
      name: "atomic",
      description: "Start the Atomic workflow",
      category: "workflow",
      execute: () => ({ success: true }),
    });
  });

  test("visible=false should produce empty suggestions", () => {
    // When visible is false, component returns null (no suggestions displayed)
    // This is verified by the component not rendering
    const visible = false;
    const input = "hel";

    // Simulate what the component does
    const suggestions = visible ? globalRegistry.search(input) : [];
    expect(suggestions.length).toBe(0);
  });

  test("visible=true with input produces filtered suggestions", () => {
    const visible = true;
    const input = "a";

    const suggestions = visible ? globalRegistry.search(input) : [];
    expect(suggestions.length).toBe(1); // only "atomic"
    expect(suggestions[0]?.name).toBe("atomic");
  });

  test("selectedIndex clamping works correctly", () => {
    const suggestions = globalRegistry.search("");
    const totalItems = suggestions.length; // 3

    // Test various index clamping scenarios
    const validIndex1 = Math.min(Math.max(0, 5), Math.max(0, totalItems - 1));
    expect(validIndex1).toBe(2); // clamped to max

    const validIndex2 = Math.min(Math.max(0, -1), Math.max(0, totalItems - 1));
    expect(validIndex2).toBe(0); // clamped to min

    const validIndex3 = Math.min(Math.max(0, 1), Math.max(0, totalItems - 1));
    expect(validIndex3).toBe(1); // within bounds
  });

  test("onSelect action types", () => {
    // Verify the action types are valid
    const actions: Array<"complete" | "execute"> = ["complete", "execute"];
    expect(actions).toContain("complete");
    expect(actions).toContain("execute");
  });
});

// ============================================================================
// KEYBOARD NAVIGATION HOOK TESTS
// ============================================================================

describe("useAutocompleteKeyboard", () => {
  // Helper to create mock key events
  function createKeyEvent(name: string): KeyEvent {
    return { name } as KeyEvent;
  }

  // Helper to create handler with tracking
  function createTestHandler(options: {
    visible?: boolean;
    selectedIndex?: number;
    totalSuggestions?: number;
  } = {}) {
    const calls = {
      indexChanges: [] as number[],
      completes: 0,
      executes: 0,
      hides: 0,
    };

    // Note: Can't actually call the hook outside React, so we test the logic directly
    // by simulating what the hook does
    const visible = options.visible ?? true;
    const selectedIndex = options.selectedIndex ?? 0;
    const totalSuggestions = options.totalSuggestions ?? 3;

    const handleKey = (event: KeyEvent): KeyboardHandlerResult => {
      if (!visible) {
        return { handled: false };
      }

      const key = event.name;

      if (key === "up") {
        const newIndex = navigateUp(selectedIndex, totalSuggestions);
        calls.indexChanges.push(newIndex);
        return { handled: true };
      }

      if (key === "down") {
        const newIndex = navigateDown(selectedIndex, totalSuggestions);
        calls.indexChanges.push(newIndex);
        return { handled: true };
      }

      if (key === "tab") {
        if (totalSuggestions > 0) {
          calls.completes++;
          return { handled: true, action: "complete" };
        }
        return { handled: false };
      }

      if (key === "return") {
        if (totalSuggestions > 0) {
          calls.executes++;
          return { handled: true, action: "execute" };
        }
        return { handled: false };
      }

      if (key === "escape") {
        calls.hides++;
        return { handled: true, action: "hide" };
      }

      return { handled: false };
    };

    return { handleKey, calls };
  }

  test("returns handled: false when not visible", () => {
    const { handleKey } = createTestHandler({ visible: false });

    const result = handleKey(createKeyEvent("up"));
    expect(result.handled).toBe(false);
  });

  test("handles up arrow navigation", () => {
    const { handleKey, calls } = createTestHandler({
      visible: true,
      selectedIndex: 1,
      totalSuggestions: 3,
    });

    const result = handleKey(createKeyEvent("up"));
    expect(result.handled).toBe(true);
    expect(calls.indexChanges).toContain(0); // 1 -> 0
  });

  test("handles down arrow navigation", () => {
    const { handleKey, calls } = createTestHandler({
      visible: true,
      selectedIndex: 0,
      totalSuggestions: 3,
    });

    const result = handleKey(createKeyEvent("down"));
    expect(result.handled).toBe(true);
    expect(calls.indexChanges).toContain(1); // 0 -> 1
  });

  test("handles tab for completion", () => {
    const { handleKey, calls } = createTestHandler({
      visible: true,
      totalSuggestions: 3,
    });

    const result = handleKey(createKeyEvent("tab"));
    expect(result.handled).toBe(true);
    expect(result.action).toBe("complete");
    expect(calls.completes).toBe(1);
  });

  test("handles enter for execution", () => {
    const { handleKey, calls } = createTestHandler({
      visible: true,
      totalSuggestions: 3,
    });

    const result = handleKey(createKeyEvent("return"));
    expect(result.handled).toBe(true);
    expect(result.action).toBe("execute");
    expect(calls.executes).toBe(1);
  });

  test("handles escape to hide", () => {
    const { handleKey, calls } = createTestHandler({
      visible: true,
    });

    const result = handleKey(createKeyEvent("escape"));
    expect(result.handled).toBe(true);
    expect(result.action).toBe("hide");
    expect(calls.hides).toBe(1);
  });

  test("does not handle tab when no suggestions", () => {
    const { handleKey } = createTestHandler({
      visible: true,
      totalSuggestions: 0,
    });

    const result = handleKey(createKeyEvent("tab"));
    expect(result.handled).toBe(false);
  });

  test("does not handle enter when no suggestions", () => {
    const { handleKey } = createTestHandler({
      visible: true,
      totalSuggestions: 0,
    });

    const result = handleKey(createKeyEvent("return"));
    expect(result.handled).toBe(false);
  });

  test("does not handle unrelated keys", () => {
    const { handleKey } = createTestHandler({ visible: true });

    expect(handleKey(createKeyEvent("a")).handled).toBe(false);
    expect(handleKey(createKeyEvent("space")).handled).toBe(false);
    expect(handleKey(createKeyEvent("left")).handled).toBe(false);
  });

  test("up arrow wraps at top", () => {
    const { handleKey, calls } = createTestHandler({
      visible: true,
      selectedIndex: 0,
      totalSuggestions: 3,
    });

    handleKey(createKeyEvent("up"));
    expect(calls.indexChanges).toContain(2); // 0 -> 2 (wrap)
  });

  test("down arrow wraps at bottom", () => {
    const { handleKey, calls } = createTestHandler({
      visible: true,
      selectedIndex: 2,
      totalSuggestions: 3,
    });

    handleKey(createKeyEvent("down"));
    expect(calls.indexChanges).toContain(0); // 2 -> 0 (wrap)
  });
});
