/**
 * Tests for Built-in Commands
 *
 * Verifies the behavior of /help, /status, /theme, /clear, /compact commands.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  helpCommand,
  statusCommand,
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

describe("statusCommand", () => {
  test("has correct metadata", () => {
    expect(statusCommand.name).toBe("status");
    expect(statusCommand.category).toBe("builtin");
    expect(statusCommand.aliases).toContain("s");
  });

  test("shows inactive workflow state", () => {
    const context = createMockContext({ workflowActive: false });
    const result = statusCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("inactive");
  });

  test("shows active workflow state", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "atomic",
    });
    const result = statusCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("atomic");
    expect(result.message).toContain("active");
  });

  test("shows pending approval state", () => {
    const context = createMockContext({
      workflowActive: true,
      pendingApproval: true,
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("pending approval");
    // /reject command removed - spec approval is now manual before workflow
    expect(result.message).toContain("Review the spec");
  });

  test("shows approved spec state", () => {
    const context = createMockContext({
      workflowActive: true,
      specApproved: true,
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("approved");
  });

  test("shows rejected spec with feedback", () => {
    const context = createMockContext({
      workflowActive: true,
      specApproved: false,
      feedback: "Need more details",
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("rejected");
    expect(result.message).toContain("Need more details");
  });

  test("shows initial prompt when set", () => {
    const context = createMockContext({
      initialPrompt: "Build a feature",
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("Build a feature");
  });

  test("shows message count", () => {
    const context = createMockContext({ messageCount: 10 });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("Messages: 10");
  });

  test("shows streaming state", () => {
    const context = createMockContext({ isStreaming: true });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("streaming");
  });

  test("shows current node", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "atomic",
      currentNode: "create_spec",
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("Create Spec");
  });

  test("shows iteration with max", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "atomic",
      iteration: 2,
      maxIterations: 5,
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("2/5");
  });

  test("shows iteration without max", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "atomic",
      iteration: 3,
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("Iteration: 3");
  });

  test("shows feature progress with bar", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "ralph",
      featureProgress: {
        completed: 5,
        total: 10,
      },
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("5/10");
    expect(result.message).toContain("█");
    expect(result.message).toContain("░");
  });

  test("shows current feature name", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "ralph",
      featureProgress: {
        completed: 3,
        total: 10,
        currentFeature: "Add user authentication",
      },
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("Add user authentication");
  });

  test("truncates long feature names", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "ralph",
      featureProgress: {
        completed: 1,
        total: 5,
        currentFeature: "This is a very long feature name that should be truncated when displayed",
      },
    });
    const result = statusCommand.execute("", context);

    // Should be truncated with ...
    expect(result.message).toContain("...");
  });

  test("shows spec not yet created state", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "atomic",
      specApproved: undefined,
      pendingApproval: false,
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("not yet created");
  });

  test("shows comprehensive status", () => {
    const context = createMockContext({
      workflowActive: true,
      workflowType: "ralph",
      currentNode: "implement_feature",
      iteration: 2,
      maxIterations: 5,
      featureProgress: {
        completed: 7,
        total: 15,
        currentFeature: "Feature 8",
      },
      specApproved: true,
      initialPrompt: "Build TUI features",
      messageCount: 42,
    });
    const result = statusCommand.execute("", context);

    expect(result.message).toContain("ralph");
    expect(result.message).toContain("Implement Feature");
    expect(result.message).toContain("2/5");
    expect(result.message).toContain("7/15");
    expect(result.message).toContain("Feature 8");
    expect(result.message).toContain("approved");
    expect(result.message).toContain("Build TUI features");
    expect(result.message).toContain("42");
  });
});

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
    expect(builtinCommands).toContain(statusCommand);
    expect(builtinCommands).toContain(themeCommand);
    expect(builtinCommands).toContain(clearCommand);
    expect(builtinCommands).toContain(compactCommand);
  });

  test("has 5 commands", () => {
    // /reject command removed - spec approval is now manual before workflow
    expect(builtinCommands.length).toBe(5);
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
    expect(globalRegistry.has("status")).toBe(true);
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
    expect(globalRegistry.has("s")).toBe(true);
    expect(globalRegistry.has("cls")).toBe(true);
    expect(globalRegistry.has("c")).toBe(true);
    // /reject "no" alias removed - spec approval is now manual before workflow
    expect(globalRegistry.has("no")).toBe(false);
  });

  test("is idempotent (can be called multiple times)", () => {
    registerBuiltinCommands();
    registerBuiltinCommands();

    // Should not throw and should still have correct count
    // /reject command removed - now 5 commands instead of 6
    expect(globalRegistry.size()).toBe(5);
  });

  test("commands are executable after registration", async () => {
    registerBuiltinCommands();

    const helpCmd = globalRegistry.get("help");
    const context = createMockContext();

    const result = await helpCmd?.execute("", context);

    expect(result?.success).toBe(true);
  });
});
