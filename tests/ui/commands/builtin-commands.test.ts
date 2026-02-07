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
  exitCommand,
  modelCommand,
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
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
    agentType: undefined,
    modelOps: undefined,
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

  test("returns success when no commands registered", async () => {
    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toBe("No commands available.");
  });

  test("lists all registered commands", async () => {
    globalRegistry.register({
      name: "test",
      description: "Test command",
      category: "builtin",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("test");
    expect(result.message).toContain("Test command");
  });

  test("groups commands by category", async () => {
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
    const result = await helpCommand.execute("", context);

    expect(result.message).toContain("Built-in");
    expect(result.message).toContain("Workflows");
  });

  test("shows aliases in help output", async () => {
    globalRegistry.register({
      name: "test",
      description: "Test",
      category: "builtin",
      aliases: ["t", "tst"],
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    expect(result.message).toContain("t, tst");
  });

  test("shows Ralph workflow documentation when /ralph is registered", async () => {
    globalRegistry.register({
      name: "ralph",
      description: "Start the Ralph autonomous implementation workflow",
      category: "workflow",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

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

  test("does not show Ralph documentation when /ralph is not registered", async () => {
    globalRegistry.register({
      name: "other-workflow",
      description: "Other workflow",
      category: "workflow",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    // Ralph section should not be present
    expect(result.message).not.toContain("**Ralph Workflow**");
    expect(result.message).not.toContain("--yolo");
  });

  test("shows Sub-Agents section when agent commands are registered", async () => {
    globalRegistry.register({
      name: "codebase-analyzer",
      description: "Analyzes codebase implementation details",
      category: "agent",
      execute: () => ({ success: true }),
    });
    globalRegistry.register({
      name: "debugger",
      description: "Debugging specialist",
      category: "agent",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    // Check Sub-Agent Details section is present
    expect(result.message).toContain("**Sub-Agent Details**");
    expect(result.message).toContain("Specialized agents for specific tasks");

    // Check builtin agents with model info
    expect(result.message).toContain("/codebase-analyzer (opus)");
    expect(result.message).toContain("Deep code analysis");
    expect(result.message).toContain("/debugger (opus)");
    expect(result.message).toContain("Debug errors");
  });

  test("shows all builtin agent details correctly", async () => {
    // Register all builtin agents
    const builtinAgents = [
      { name: "codebase-analyzer", desc: "Analyzes code" },
      { name: "codebase-locator", desc: "Locates files" },
      { name: "codebase-pattern-finder", desc: "Finds patterns" },
      { name: "codebase-online-researcher", desc: "Online research" },
      { name: "codebase-research-analyzer", desc: "Analyzes research" },
      { name: "codebase-research-locator", desc: "Locates research" },
      { name: "debugger", desc: "Debugging" },
    ];

    for (const agent of builtinAgents) {
      globalRegistry.register({
        name: agent.name,
        description: agent.desc,
        category: "agent",
        execute: () => ({ success: true }),
      });
    }

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    // Check all agents are listed with correct models
    expect(result.message).toContain("/codebase-analyzer (opus)");
    expect(result.message).toContain("/codebase-locator (opus)");
    expect(result.message).toContain("/codebase-pattern-finder (opus)");
    expect(result.message).toContain("/codebase-online-researcher (opus)");
    expect(result.message).toContain("/codebase-research-analyzer (opus)");
    expect(result.message).toContain("/codebase-research-locator (opus)");
    expect(result.message).toContain("/debugger (opus)");
  });

  test("shows custom agents without hardcoded details", async () => {
    globalRegistry.register({
      name: "custom-agent",
      description: "A custom agent for testing",
      category: "agent",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    // Custom agents should show their description directly
    expect(result.message).toContain("/custom-agent");
    expect(result.message).toContain("A custom agent for testing");
  });

  test("does not show Sub-Agents section when no agent commands registered", async () => {
    globalRegistry.register({
      name: "test",
      description: "Test command",
      category: "builtin",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    expect(result.message).not.toContain("**Sub-Agent Details**");
  });

  test("groups agent commands under Sub-Agents category in command list", async () => {
    globalRegistry.register({
      name: "codebase-analyzer",
      description: "Analyzes codebase",
      category: "agent",
      execute: () => ({ success: true }),
    });

    const context = createMockContext();
    const result = await helpCommand.execute("", context);

    // Agent commands should be listed under Sub-Agents category
    expect(result.message).toContain("**Sub-Agents**");
  });
});

// /status command removed - progress tracked via research/progress.txt instead
// /reject command removed - spec approval is now manual before workflow

describe("themeCommand", () => {
  test("has correct metadata", () => {
    expect(themeCommand.name).toBe("theme");
    expect(themeCommand.category).toBe("builtin");
  });

  test("toggles theme without argument", async () => {
    const context = createMockContext();
    const result = await themeCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("toggled");
  });

  test("switches to dark theme explicitly", async () => {
    const context = createMockContext();
    const result = await themeCommand.execute("dark", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("dark");
  });

  test("switches to light theme explicitly", async () => {
    const context = createMockContext();
    const result = await themeCommand.execute("light", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("light");
  });

  test("is case-insensitive for theme name", async () => {
    const context = createMockContext();
    const result = await themeCommand.execute("DARK", context);

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

  test("clears messages and returns success", async () => {
    const context = createMockContext({ messageCount: 10 });
    const result = await clearCommand.execute("", context);

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
    expect(builtinCommands).toContain(exitCommand);
    expect(builtinCommands).toContain(modelCommand);
  });

  test("has 6 commands", () => {
    // Commands: help, theme, clear, compact, exit, model
    expect(builtinCommands.length).toBe(6);
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
    expect(globalRegistry.has("exit")).toBe(true);
    expect(globalRegistry.has("model")).toBe(true);
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
    // exit aliases
    expect(globalRegistry.has("quit")).toBe(true);
    expect(globalRegistry.has("q")).toBe(true);
    // model alias
    expect(globalRegistry.has("m")).toBe(true);
    // /reject "no" alias removed - spec approval is now manual before workflow
    expect(globalRegistry.has("no")).toBe(false);
  });

  test("is idempotent (can be called multiple times)", () => {
    registerBuiltinCommands();
    registerBuiltinCommands();

    // Should not throw and should still have correct count
    // Commands: help, theme, clear, compact, exit, model
    expect(globalRegistry.size()).toBe(6);
  });

  test("commands are executable after registration", async () => {
    registerBuiltinCommands();

    const helpCmd = globalRegistry.get("help");
    const context = createMockContext();

    const result = await helpCmd?.execute("", context);

    expect(result?.success).toBe(true);
  });
});
