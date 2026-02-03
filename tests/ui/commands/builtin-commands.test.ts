/**
 * Tests for Built-in Commands
 *
 * Verifies the behavior of /help, /theme, /clear, /compact commands.
 *
 * Note: /status command removed - progress tracked via research/progress.txt instead
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  helpCommand,
  themeCommand,
  clearCommand,
  compactCommand,
  builtinCommands,
  registerBuiltinCommands,
} from "../../../src/ui/commands/builtin-commands.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
} from "../../../src/ui/commands/registry.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock CommandContext for testing.
 */
function createMockContext(
  stateOverrides: Partial<CommandContextState> = {}
): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 5,
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      pendingApproval: false,
      specApproved: undefined,
      feedback: null,
      ...stateOverrides,
    },
    addMessage: () => {},
    setStreaming: () => {},
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("helpCommand", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  test("has correct metadata", () => {
    expect(helpCommand.name).toBe("help");
    expect(helpCommand.category).toBe("builtin");
    expect(helpCommand.aliases).toContain("h");
    expect(helpCommand.aliases).toContain("?");
  });

  test("returns success when no commands registered", () => {
    const context = createMockContext();
    const result = helpCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toBe("No commands available.");
  });

  test("lists all registered commands", () => {
    globalRegistry.register({
      name: "test",
      description: "Test command",
      category: "builtin",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = helpCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("test");
    expect(result.message).toContain("Test command");
  });

  test("groups commands by category", () => {
    globalRegistry.register({
      name: "builtin-cmd",
      description: "Builtin",
      category: "builtin",
      execute: () => ({ success: true }),
    });
    globalRegistry.register({
      name: "workflow-cmd",
      description: "Workflow",
      category: "workflow",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = helpCommand.execute("", context);

    expect(result.message).toContain("Built-in");
    expect(result.message).toContain("Workflows");
  });

  test("shows aliases in help output", () => {
    globalRegistry.register({
      name: "test",
      description: "Test",
      category: "builtin",
      aliases: ["t", "tst"],
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = helpCommand.execute("", context);

    expect(result.message).toContain("t, tst");
  });

  test("shows Ralph workflow documentation when /ralph is registered", () => {
    globalRegistry.register({
      name: "ralph",
      description: "Start the Ralph autonomous implementation workflow",
      category: "workflow",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = helpCommand.execute("", context);

    // Check Ralph workflow section is present
    expect(result.message).toContain("**Ralph Workflow**");
    expect(result.message).toContain("autonomous implementation workflow");

    // Check usage examples
    expect(result.message).toContain("/ralph");
    expect(result.message).toContain("--yolo");
    expect(result.message).toContain("--resume");

    // Check options
    expect(result.message).toContain("--feature-list");
    expect(result.message).toContain("--max-iterations");

    // Check interrupt instructions
    expect(result.message).toContain("Ctrl+C");
    expect(result.message).toContain("Esc");
  });

  test("does not show Ralph documentation when /ralph is not registered", () => {
    globalRegistry.register({
      name: "other-workflow",
      description: "Other workflow",
      category: "workflow",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = helpCommand.execute("", context);

    // Ralph section should not be present
    expect(result.message).not.toContain("**Ralph Workflow**");
    expect(result.message).not.toContain("--yolo");
  });
});

// /status command removed - progress tracked via research/progress.txt instead
// /reject command removed - spec approval is now manual before workflow

describe("themeCommand", () => {
  test("has correct metadata", () => {
    expect(themeCommand.name).toBe("theme");
    expect(themeCommand.category).toBe("builtin");
  });

  test("toggles theme without argument", () => {
    const context = createMockContext();
    const result = themeCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("toggled");
  });

  test("switches to dark theme explicitly", () => {
    const context = createMockContext();
    const result = themeCommand.execute("dark", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("dark");
  });

  test("switches to light theme explicitly", () => {
    const context = createMockContext();
    const result = themeCommand.execute("light", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("light");
  });

  test("is case-insensitive for theme name", () => {
    const context = createMockContext();
    const result = themeCommand.execute("DARK", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("dark");
  });
});

describe("clearCommand", () => {
  test("has correct metadata", () => {
    expect(clearCommand.name).toBe("clear");
    expect(clearCommand.category).toBe("builtin");
    expect(clearCommand.aliases).toContain("cls");
    expect(clearCommand.aliases).toContain("c");
  });

  test("clears messages and returns success", () => {
    const context = createMockContext({ messageCount: 10 });
    const result = clearCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.clearMessages).toBe(true);
  });
});

describe("builtinCommands array", () => {
  test("contains all built-in commands", () => {
    expect(builtinCommands).toContain(helpCommand);
    // /status command removed - progress tracked via research/progress.txt instead
    expect(builtinCommands).toContain(themeCommand);
    expect(builtinCommands).toContain(clearCommand);
    expect(builtinCommands).toContain(compactCommand);
  });

  test("has 4 commands", () => {
    // /status command removed - progress tracked via research/progress.txt instead
    // /reject command removed - spec approval is now manual before workflow
    expect(builtinCommands.length).toBe(4);
  });
});

describe("registerBuiltinCommands", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  afterEach(() => {
    globalRegistry.clear();
  });

  test("registers all built-in commands", () => {
    registerBuiltinCommands();

    expect(globalRegistry.has("help")).toBe(true);
    // /status command removed - progress tracked via research/progress.txt instead
    expect(globalRegistry.has("status")).toBe(false);
    expect(globalRegistry.has("theme")).toBe(true);
    expect(globalRegistry.has("clear")).toBe(true);
    expect(globalRegistry.has("compact")).toBe(true);
    // /reject command removed - spec approval is now manual before workflow
    expect(globalRegistry.has("reject")).toBe(false);
  });

  test("registers aliases", () => {
    registerBuiltinCommands();

    expect(globalRegistry.has("h")).toBe(true);
    expect(globalRegistry.has("?")).toBe(true);
    // /status "s" alias removed - progress tracked via research/progress.txt instead
    expect(globalRegistry.has("s")).toBe(false);
    expect(globalRegistry.has("cls")).toBe(true);
    expect(globalRegistry.has("c")).toBe(true);
    // /reject "no" alias removed - spec approval is now manual before workflow
    expect(globalRegistry.has("no")).toBe(false);
  });

  test("is idempotent (can be called multiple times)", () => {
    registerBuiltinCommands();
    registerBuiltinCommands();

    // Should not throw and should still have correct count
    // /status command removed - now 4 commands instead of 5
    // /reject command removed - spec approval is now manual before workflow
    expect(globalRegistry.size()).toBe(4);
  });

  test("commands are executable after registration", async () => {
    registerBuiltinCommands();

    const helpCmd = globalRegistry.get("help");
    const context = createMockContext();

    const result = await helpCmd?.execute("", context);

    expect(result?.success).toBe(true);
  });
});
