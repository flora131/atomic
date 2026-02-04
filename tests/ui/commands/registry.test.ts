/**
 * Tests for CommandRegistry
 *
 * Verifies command registration, lookup, search, and sorting behavior.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import {
  CommandRegistry,
  type CommandDefinition,
  type CommandResult,
  type CommandCategory,
  type CommandContext,
  type SpawnSubagentOptions,
  type SpawnSubagentResult,
  globalRegistry,
} from "../../../src/ui/commands/registry.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a minimal command definition for testing.
 */
function createCommand(
  name: string,
  options: Partial<Omit<CommandDefinition, "name" | "execute">> = {}
): CommandDefinition {
  return {
    name,
    description: options.description ?? `Description for ${name}`,
    category: options.category ?? "builtin",
    execute: () => ({ success: true }),
    aliases: options.aliases,
    hidden: options.hidden,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("CommandRegistry", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe("register()", () => {
    test("adds command to registry", () => {
      const command = createCommand("help");
      registry.register(command);

      expect(registry.has("help")).toBe(true);
      expect(registry.size()).toBe(1);
    });

    test("allows registering multiple commands", () => {
      registry.register(createCommand("help"));
      registry.register(createCommand("status"));
      registry.register(createCommand("clear"));

      expect(registry.size()).toBe(3);
      expect(registry.has("help")).toBe(true);
      expect(registry.has("status")).toBe(true);
      expect(registry.has("clear")).toBe(true);
    });

    test("registers aliases for command", () => {
      const command = createCommand("help", { aliases: ["h", "?"] });
      registry.register(command);

      expect(registry.has("help")).toBe(true);
      expect(registry.has("h")).toBe(true);
      expect(registry.has("?")).toBe(true);
    });

    test("normalizes command name to lowercase", () => {
      registry.register(createCommand("HELP"));

      expect(registry.has("help")).toBe(true);
      expect(registry.has("HELP")).toBe(true);
      expect(registry.has("Help")).toBe(true);
    });

    test("throws error on duplicate command name", () => {
      registry.register(createCommand("help"));

      expect(() => {
        registry.register(createCommand("help"));
      }).toThrow("Command name 'help' is already registered");
    });

    test("throws error when alias conflicts with existing command", () => {
      registry.register(createCommand("help"));

      expect(() => {
        registry.register(createCommand("assist", { aliases: ["help"] }));
      }).toThrow("Alias 'help' conflicts with existing command or alias");
    });

    test("throws error when alias conflicts with existing alias", () => {
      registry.register(createCommand("help", { aliases: ["h"] }));

      expect(() => {
        registry.register(createCommand("history", { aliases: ["h"] }));
      }).toThrow("Alias 'h' conflicts with existing command or alias");
    });
  });

  describe("get()", () => {
    test("retrieves command by name", () => {
      const command = createCommand("help", { description: "Show help" });
      registry.register(command);

      const retrieved = registry.get("help");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("help");
      expect(retrieved?.description).toBe("Show help");
    });

    test("retrieves command by alias", () => {
      const command = createCommand("help", {
        aliases: ["h", "?"],
        description: "Show help",
      });
      registry.register(command);

      const byH = registry.get("h");
      const byQuestion = registry.get("?");

      expect(byH?.name).toBe("help");
      expect(byQuestion?.name).toBe("help");
      expect(byH?.description).toBe("Show help");
    });

    test("is case-insensitive", () => {
      registry.register(createCommand("help"));

      expect(registry.get("HELP")).toBeDefined();
      expect(registry.get("Help")).toBeDefined();
      expect(registry.get("hElP")).toBeDefined();
    });

    test("returns undefined for unknown command", () => {
      registry.register(createCommand("help"));

      expect(registry.get("unknown")).toBeUndefined();
      expect(registry.get("")).toBeUndefined();
    });
  });

  describe("search()", () => {
    beforeEach(() => {
      registry.register(createCommand("help", { category: "builtin" }));
      registry.register(createCommand("history", { category: "builtin" }));
      registry.register(createCommand("atomic", { category: "workflow" }));
      registry.register(createCommand("approve", { category: "builtin" }));
      registry.register(createCommand("api-test", { category: "custom" }));
    });

    test("returns commands matching prefix", () => {
      const matches = registry.search("h");

      expect(matches.length).toBe(2);
      expect(matches.map((c) => c.name)).toContain("help");
      expect(matches.map((c) => c.name)).toContain("history");
    });

    test("returns all commands for empty prefix", () => {
      const matches = registry.search("");

      expect(matches.length).toBe(5);
    });

    test("returns exact match first", () => {
      const matches = registry.search("help");

      expect(matches[0]?.name).toBe("help");
    });

    test("sorts by category priority (workflow > skill > builtin > custom)", () => {
      const matches = registry.search("a");

      // "atomic" (workflow) should come before "approve" (builtin) and "api-test" (custom)
      const names = matches.map((c) => c.name);
      const approveIndex = names.indexOf("approve");
      const atomicIndex = names.indexOf("atomic");
      const apiTestIndex = names.indexOf("api-test");

      expect(atomicIndex).toBeLessThan(approveIndex);
      expect(approveIndex).toBeLessThan(apiTestIndex);
    });

    test("sorts alphabetically within same category", () => {
      const matches = registry.search("");
      const builtinCommands = matches.filter((c) => c.category === "builtin");
      const names = builtinCommands.map((c) => c.name);

      expect(names).toEqual([...names].sort());
    });

    test("excludes hidden commands", () => {
      registry.register(createCommand("secret", { hidden: true }));

      const matches = registry.search("s");

      expect(matches.map((c) => c.name)).not.toContain("secret");
    });

    test("is case-insensitive", () => {
      const lowerMatches = registry.search("h");
      const upperMatches = registry.search("H");

      expect(lowerMatches.length).toBe(upperMatches.length);
      expect(lowerMatches.map((c) => c.name)).toEqual(
        upperMatches.map((c) => c.name)
      );
    });

    test("includes commands when alias matches", () => {
      registry.register(createCommand("workflow", { aliases: ["wf"] }));

      const matches = registry.search("wf");

      expect(matches.map((c) => c.name)).toContain("workflow");
    });

    test("does not duplicate command when both name and alias match", () => {
      // Use a fresh registry for this test to avoid conflict with beforeEach
      const freshRegistry = new CommandRegistry();
      freshRegistry.register(createCommand("helper", { aliases: ["help-me"] }));

      // Search for "help" which matches both "helper" (name) and nothing else
      // Actually, let's test with a command that has an alias starting the same
      freshRegistry.register(createCommand("history", { aliases: ["hist"] }));

      // Search for "hist" - should match alias and possibly command
      const matches = freshRegistry.search("hist");
      const historyMatches = matches.filter((c) => c.name === "history");

      // Should only appear once even though alias "hist" matches
      expect(historyMatches.length).toBe(1);
    });
  });

  describe("all()", () => {
    test("returns all visible commands", () => {
      registry.register(createCommand("help"));
      registry.register(createCommand("status"));
      registry.register(createCommand("hidden-cmd", { hidden: true }));

      const all = registry.all();

      expect(all.length).toBe(2);
      expect(all.map((c) => c.name)).toContain("help");
      expect(all.map((c) => c.name)).toContain("status");
      expect(all.map((c) => c.name)).not.toContain("hidden-cmd");
    });

    test("returns empty array when no commands registered", () => {
      const all = registry.all();

      expect(all).toEqual([]);
    });

    test("sorts by category then alphabetically", () => {
      registry.register(createCommand("zulu", { category: "builtin" }));
      registry.register(createCommand("alpha", { category: "workflow" }));
      registry.register(createCommand("beta", { category: "builtin" }));

      const all = registry.all();
      const names = all.map((c) => c.name);

      // Workflow commands first, then builtin (per spec section 5.3: workflow > skill > builtin)
      expect(names.indexOf("alpha")).toBeLessThan(names.indexOf("beta"));
      expect(names.indexOf("alpha")).toBeLessThan(names.indexOf("zulu"));
      // Alphabetical within builtin
      expect(names.indexOf("beta")).toBeLessThan(names.indexOf("zulu"));
    });
  });

  describe("has()", () => {
    test("returns true for existing command", () => {
      registry.register(createCommand("help"));

      expect(registry.has("help")).toBe(true);
    });

    test("returns true for existing alias", () => {
      registry.register(createCommand("help", { aliases: ["h"] }));

      expect(registry.has("h")).toBe(true);
    });

    test("returns false for non-existing command", () => {
      expect(registry.has("unknown")).toBe(false);
    });
  });

  describe("size()", () => {
    test("returns number of registered commands", () => {
      expect(registry.size()).toBe(0);

      registry.register(createCommand("help"));
      expect(registry.size()).toBe(1);

      registry.register(createCommand("status"));
      expect(registry.size()).toBe(2);
    });

    test("does not count aliases", () => {
      registry.register(createCommand("help", { aliases: ["h", "?"] }));

      expect(registry.size()).toBe(1);
    });
  });

  describe("clear()", () => {
    test("removes all commands and aliases", () => {
      registry.register(createCommand("help", { aliases: ["h"] }));
      registry.register(createCommand("status"));

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.has("help")).toBe(false);
      expect(registry.has("h")).toBe(false);
      expect(registry.has("status")).toBe(false);
    });
  });

  describe("command execution", () => {
    test("execute function is called with correct arguments", async () => {
      let capturedArgs: string | undefined;
      let capturedContext: object | undefined;

      const command: CommandDefinition = {
        name: "test",
        description: "Test command",
        category: "builtin",
        execute: (args, context) => {
          capturedArgs = args;
          capturedContext = context;
          return { success: true };
        },
      };

      registry.register(command);
      const retrieved = registry.get("test");

      const mockContext = {
        session: null,
        state: { isStreaming: false, messageCount: 0 },
        addMessage: () => {},
        setStreaming: () => {},
        sendMessage: () => {},
        spawnSubagent: async () => ({ success: true, output: "Mock output" }),
        agentType: undefined,
        modelOps: undefined,
      };

      await retrieved?.execute("some args", mockContext);

      expect(capturedArgs).toBe("some args");
      expect(capturedContext).toBeDefined();
    });

    test("execute can return CommandResult", async () => {
      const command: CommandDefinition = {
        name: "test",
        description: "Test command",
        category: "builtin",
        execute: () => ({
          success: true,
          message: "Command executed",
          stateUpdate: { workflowActive: true },
        }),
      };

      registry.register(command);
      const retrieved = registry.get("test");

      const mockContext = {
        session: null,
        state: { isStreaming: false, messageCount: 0 },
        addMessage: () => {},
        setStreaming: () => {},
        sendMessage: () => {},
        spawnSubagent: async () => ({ success: true, output: "Mock output" }),
        agentType: undefined,
        modelOps: undefined,
      };

      const result = (await retrieved?.execute("", mockContext)) as CommandResult;

      expect(result.success).toBe(true);
      expect(result.message).toBe("Command executed");
      expect(result.stateUpdate?.workflowActive).toBe(true);
    });

    test("execute can return Promise<CommandResult>", async () => {
      const command: CommandDefinition = {
        name: "async-test",
        description: "Async test command",
        category: "builtin",
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { success: true, message: "Async done" };
        },
      };

      registry.register(command);
      const retrieved = registry.get("async-test");

      const mockContext = {
        session: null,
        state: { isStreaming: false, messageCount: 0 },
        addMessage: () => {},
        setStreaming: () => {},
        sendMessage: () => {},
        spawnSubagent: async () => ({ success: true, output: "Mock output" }),
        agentType: undefined,
        modelOps: undefined,
      };

      const result = (await retrieved?.execute("", mockContext)) as CommandResult;

      expect(result.success).toBe(true);
      expect(result.message).toBe("Async done");
    });
  });
});

describe("globalRegistry", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  test("is a CommandRegistry instance", () => {
    expect(globalRegistry).toBeInstanceOf(CommandRegistry);
  });

  test("can register and retrieve commands", () => {
    globalRegistry.register(createCommand("global-test"));

    expect(globalRegistry.has("global-test")).toBe(true);
    expect(globalRegistry.get("global-test")?.name).toBe("global-test");
  });

  test("is shared across imports (singleton)", () => {
    // This test verifies that globalRegistry is the same instance
    // Note: In practice, we can't fully test this without multiple import statements
    // but we can verify it's always the same reference
    const ref1 = globalRegistry;
    const ref2 = globalRegistry;

    expect(ref1).toBe(ref2);
  });
});

// ============================================================================
// COMMAND CATEGORY TYPE TESTS
// ============================================================================

describe("CommandCategory type", () => {
  test("includes 'builtin' for help, clear commands", () => {
    const category: CommandCategory = "builtin";
    expect(category).toBe("builtin");
  });

  test("includes 'skill' for commit, research commands", () => {
    const category: CommandCategory = "skill";
    expect(category).toBe("skill");
  });

  test("includes 'workflow' for ralph command", () => {
    const category: CommandCategory = "workflow";
    expect(category).toBe("workflow");
  });

  test("includes 'agent' for sub-agent commands", () => {
    const category: CommandCategory = "agent";
    expect(category).toBe("agent");
  });

  test("includes 'custom' for user-defined commands", () => {
    const category: CommandCategory = "custom";
    expect(category).toBe("custom");
  });

  test("all categories can be used in CommandDefinition", () => {
    const categories: CommandCategory[] = ["builtin", "skill", "workflow", "agent", "custom"];

    categories.forEach(cat => {
      const command: CommandDefinition = {
        name: `test-${cat}`,
        description: `Test ${cat} command`,
        category: cat,
        execute: () => ({ success: true }),
      };
      expect(command.category).toBe(cat);
    });
  });

  test("registry sorting uses all category priorities", () => {
    const registry = new CommandRegistry();

    // Register commands with different categories
    registry.register(createCommand("custom-cmd", { category: "custom" }));
    registry.register(createCommand("builtin-cmd", { category: "builtin" }));
    registry.register(createCommand("workflow-cmd", { category: "workflow" }));
    registry.register(createCommand("skill-cmd", { category: "skill" }));
    registry.register(createCommand("agent-cmd", { category: "agent" }));

    const all = registry.all();
    const names = all.map(c => c.name);

    // Priority order: workflow > skill > agent > builtin > custom
    expect(names.indexOf("workflow-cmd")).toBeLessThan(names.indexOf("skill-cmd"));
    expect(names.indexOf("skill-cmd")).toBeLessThan(names.indexOf("agent-cmd"));
    expect(names.indexOf("agent-cmd")).toBeLessThan(names.indexOf("builtin-cmd"));
    expect(names.indexOf("builtin-cmd")).toBeLessThan(names.indexOf("custom-cmd"));
  });
});

// ============================================================================
// COMMAND CONTEXT INTERFACE TESTS
// ============================================================================

describe("CommandContext interface", () => {
  test("has session field that can be Session or null", () => {
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: () => {},
      spawnSubagent: async () => ({ success: true, output: "" }),
    };

    expect(context.session).toBeNull();
  });

  test("has state field of type CommandContextState", () => {
    const context: CommandContext = {
      session: null,
      state: { isStreaming: true, messageCount: 5 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: () => {},
      spawnSubagent: async () => ({ success: true, output: "" }),
    };

    expect(context.state.isStreaming).toBe(true);
    expect(context.state.messageCount).toBe(5);
  });

  test("has addMessage method with role and content parameters", () => {
    let capturedRole: string | undefined;
    let capturedContent: string | undefined;

    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: (role, content) => {
        capturedRole = role;
        capturedContent = content;
      },
      setStreaming: () => {},
      sendMessage: () => {},
      spawnSubagent: async () => ({ success: true, output: "" }),
    };

    context.addMessage("user", "Hello");

    expect(capturedRole).toBe("user");
    expect(capturedContent).toBe("Hello");
  });

  test("has setStreaming method with streaming parameter", () => {
    let capturedStreaming: boolean | undefined;

    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: (streaming) => {
        capturedStreaming = streaming;
      },
      sendMessage: () => {},
      spawnSubagent: async () => ({ success: true, output: "" }),
    };

    context.setStreaming(true);

    expect(capturedStreaming).toBe(true);
  });

  test("has sendMessage method with content parameter", () => {
    let capturedContent: string | undefined;

    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        capturedContent = content;
      },
      spawnSubagent: async () => ({ success: true, output: "" }),
    };

    context.sendMessage("Test message");

    expect(capturedContent).toBe("Test message");
  });

  test("has spawnSubagent method that returns Promise<SpawnSubagentResult>", async () => {
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: () => {},
      spawnSubagent: async (options) => ({
        success: true,
        output: `Executed with prompt: ${options.systemPrompt}`,
      }),
    };

    const result = await context.spawnSubagent({
      systemPrompt: "You are a test agent",
      message: "Do something",
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("You are a test agent");
  });
});

// ============================================================================
// SPAWN SUBAGENT OPTIONS TESTS
// ============================================================================

describe("SpawnSubagentOptions interface", () => {
  test("requires systemPrompt and message fields", () => {
    const options: SpawnSubagentOptions = {
      systemPrompt: "You are an analyzer",
      message: "Analyze this code",
    };

    expect(options.systemPrompt).toBe("You are an analyzer");
    expect(options.message).toBe("Analyze this code");
  });

  test("supports optional tools array", () => {
    const options: SpawnSubagentOptions = {
      systemPrompt: "You are an analyzer",
      message: "Analyze this code",
      tools: ["Glob", "Grep", "Read"],
    };

    expect(options.tools).toEqual(["Glob", "Grep", "Read"]);
  });

  test("supports optional model field", () => {
    const options: SpawnSubagentOptions = {
      systemPrompt: "You are an analyzer",
      message: "Analyze this code",
      model: "opus",
    };

    expect(options.model).toBe("opus");
  });

  test("model can be sonnet, opus, or haiku", () => {
    const models: Array<"sonnet" | "opus" | "haiku"> = ["sonnet", "opus", "haiku"];

    models.forEach(model => {
      const options: SpawnSubagentOptions = {
        systemPrompt: "Test",
        message: "Test",
        model,
      };
      expect(options.model).toBe(model);
    });
  });
});

// ============================================================================
// SPAWN SUBAGENT RESULT TESTS
// ============================================================================

describe("SpawnSubagentResult interface", () => {
  test("has success and output fields", () => {
    const result: SpawnSubagentResult = {
      success: true,
      output: "Task completed successfully",
    };

    expect(result.success).toBe(true);
    expect(result.output).toBe("Task completed successfully");
  });

  test("supports optional error field when failed", () => {
    const result: SpawnSubagentResult = {
      success: false,
      output: "",
      error: "Sub-agent failed to complete task",
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe("Sub-agent failed to complete task");
  });
});
