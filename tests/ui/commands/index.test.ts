/**
 * Tests for Commands Module Index
 *
 * Verifies command initialization and slash command parsing.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  initializeCommands,
  parseSlashCommand,
  isSlashCommand,
  getCommandPrefix,
  globalRegistry,
  type ParsedSlashCommand,
} from "../../../src/ui/commands/index.ts";

// ============================================================================
// TESTS
// ============================================================================

describe("initializeCommands", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  afterEach(() => {
    globalRegistry.clear();
  });

  test("registers all command types", () => {
    initializeCommands();

    // Built-in commands
    // Note: /approve and /reject removed - spec approval is now manual before workflow
    // Note: /status removed - progress tracked via research/progress.txt instead
    expect(globalRegistry.has("help")).toBe(true);
    expect(globalRegistry.has("status")).toBe(false);
    expect(globalRegistry.has("theme")).toBe(true);
    expect(globalRegistry.has("clear")).toBe(true);
    expect(globalRegistry.has("compact")).toBe(true);
    expect(globalRegistry.has("reject")).toBe(false);

    // Workflow commands (note: /atomic removed, /ralph is the main workflow)
    expect(globalRegistry.has("ralph")).toBe(true);

    // Skill commands
    expect(globalRegistry.has("commit")).toBe(true);
    expect(globalRegistry.has("research-codebase")).toBe(true);
  });

  test("returns count of newly registered commands", () => {
    const count = initializeCommands();
    expect(count).toBeGreaterThan(0);
  });

  test("is idempotent", () => {
    const firstCount = initializeCommands();
    const secondCount = initializeCommands();

    // Second call should register 0 new commands
    expect(secondCount).toBe(0);
    expect(globalRegistry.size()).toBe(firstCount);
  });

  test("registers command aliases", () => {
    initializeCommands();

    // Built-in aliases
    expect(globalRegistry.has("h")).toBe(true); // help
    expect(globalRegistry.has("?")).toBe(true); // help
    // Note: /status "s" alias removed - progress tracked via research/progress.txt instead
    expect(globalRegistry.has("s")).toBe(false);

    // Workflow aliases
    expect(globalRegistry.has("ralph")).toBe(true); // atomic
    expect(globalRegistry.has("loop")).toBe(true); // atomic

    // Skill aliases
    expect(globalRegistry.has("ci")).toBe(true); // commit
    expect(globalRegistry.has("spec")).toBe(true); // create-spec
    // Note: ralph-help alias removed - replaced by SDK-native /ralph workflow
  });

  test("all commands are retrievable after initialization", () => {
    initializeCommands();

    const all = globalRegistry.all();
    expect(all.length).toBeGreaterThan(0);

    // Each command should have required fields
    for (const cmd of all) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe("string");
      expect(typeof cmd.execute).toBe("function");
    }
  });
});

describe("parseSlashCommand", () => {
  test("parses simple command without args", () => {
    const result = parseSlashCommand("/help");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("help");
    expect(result.args).toBe("");
    expect(result.raw).toBe("/help");
  });

  test("parses command with args", () => {
    const result = parseSlashCommand("/atomic Build a feature");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("atomic");
    expect(result.args).toBe("Build a feature");
    expect(result.raw).toBe("/atomic Build a feature");
  });

  test("parses command with multiple spaces in args", () => {
    const result = parseSlashCommand("/commit -m 'Fix bug in login'");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("commit");
    expect(result.args).toBe("-m 'Fix bug in login'");
  });

  test("returns isCommand: false for non-command input", () => {
    const result = parseSlashCommand("Hello world");

    expect(result.isCommand).toBe(false);
    expect(result.name).toBe("");
    expect(result.args).toBe("");
    expect(result.raw).toBe("Hello world");
  });

  test("handles empty input", () => {
    const result = parseSlashCommand("");

    expect(result.isCommand).toBe(false);
    expect(result.name).toBe("");
    expect(result.args).toBe("");
  });

  test("handles whitespace-only input", () => {
    const result = parseSlashCommand("   ");

    expect(result.isCommand).toBe(false);
  });

  test("trims leading/trailing whitespace", () => {
    const result = parseSlashCommand("  /help  ");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("help");
    expect(result.args).toBe("");
  });

  test("lowercases command name", () => {
    const result = parseSlashCommand("/HELP");

    expect(result.name).toBe("help");
  });

  test("preserves args case", () => {
    const result = parseSlashCommand("/commit -m 'Fix Bug'");

    expect(result.args).toBe("-m 'Fix Bug'");
  });

  test("handles command with trailing space but no args", () => {
    const result = parseSlashCommand("/help ");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("help");
    expect(result.args).toBe("");
  });

  test("handles slash only", () => {
    const result = parseSlashCommand("/");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("");
    expect(result.args).toBe("");
  });

  test("handles colon in command name (namespaced commands)", () => {
    const result = parseSlashCommand("/namespace:command");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("namespace:command");
    expect(result.args).toBe("");
  });
});

describe("isSlashCommand", () => {
  test("returns true for slash command", () => {
    expect(isSlashCommand("/help")).toBe(true);
    expect(isSlashCommand("/atomic Build feature")).toBe(true);
    expect(isSlashCommand("/")).toBe(true);
  });

  test("returns false for non-command", () => {
    expect(isSlashCommand("hello")).toBe(false);
    expect(isSlashCommand("")).toBe(false);
    expect(isSlashCommand("  ")).toBe(false);
  });

  test("handles leading whitespace", () => {
    expect(isSlashCommand("  /help")).toBe(true);
  });
});

describe("getCommandPrefix", () => {
  test("extracts prefix from partial command", () => {
    expect(getCommandPrefix("/hel")).toBe("hel");
    expect(getCommandPrefix("/at")).toBe("at");
    expect(getCommandPrefix("/")).toBe("");
  });

  test("returns empty for complete command with args", () => {
    expect(getCommandPrefix("/help status")).toBe("");
    expect(getCommandPrefix("/atomic Build")).toBe("");
  });

  test("returns empty for non-command", () => {
    expect(getCommandPrefix("hello")).toBe("");
    expect(getCommandPrefix("")).toBe("");
  });

  test("lowercases the prefix", () => {
    expect(getCommandPrefix("/HEL")).toBe("hel");
    expect(getCommandPrefix("/AtOmIc")).toBe("atomic");
  });

  test("handles leading whitespace", () => {
    expect(getCommandPrefix("  /hel")).toBe("hel");
  });
});

describe("module exports", () => {
  test("exports CommandRegistry class", async () => {
    const { CommandRegistry } = await import("../../../src/ui/commands/index.ts");
    expect(CommandRegistry).toBeDefined();
    expect(typeof CommandRegistry).toBe("function");
  });

  test("exports globalRegistry singleton", async () => {
    const { globalRegistry } = await import("../../../src/ui/commands/index.ts");
    expect(globalRegistry).toBeDefined();
  });

  test("exports type interfaces", async () => {
    // Types are compile-time only, but we can check the exports exist
    const exports = await import("../../../src/ui/commands/index.ts");
    expect(exports).toBeDefined();
  });

  test("exports builtin command functions", async () => {
    const { registerBuiltinCommands, builtinCommands, helpCommand } = await import(
      "../../../src/ui/commands/index.ts"
    );
    expect(registerBuiltinCommands).toBeDefined();
    expect(builtinCommands).toBeDefined();
    expect(helpCommand).toBeDefined();
  });

  test("exports workflow command functions", async () => {
    const { registerWorkflowCommands, WORKFLOW_DEFINITIONS, getWorkflowMetadata } = await import(
      "../../../src/ui/commands/index.ts"
    );
    expect(registerWorkflowCommands).toBeDefined();
    expect(WORKFLOW_DEFINITIONS).toBeDefined();
    expect(getWorkflowMetadata).toBeDefined();
  });

  test("exports skill command functions", async () => {
    const { registerSkillCommands, SKILL_DEFINITIONS, getSkillMetadata, isRalphSkill } =
      await import("../../../src/ui/commands/index.ts");
    expect(registerSkillCommands).toBeDefined();
    expect(SKILL_DEFINITIONS).toBeDefined();
    expect(getSkillMetadata).toBeDefined();
    expect(isRalphSkill).toBeDefined();
  });
});
