/**
 * Tests for CommandRegistry command lookup, registration, and alias resolution
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { CommandRegistry, type CommandDefinition, type CommandResult } from "./registry.ts";

describe("CommandRegistry", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe("register", () => {
    test("registers a command successfully", () => {
      const command: CommandDefinition = {
        name: "test",
        description: "Test command",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      registry.register(command);

      expect(registry.has("test")).toBe(true);
      expect(registry.size()).toBe(1);
    });

    test("registers a command with aliases", () => {
      const command: CommandDefinition = {
        name: "help",
        description: "Show help",
        category: "builtin",
        aliases: ["h", "?"],
        execute: () => ({ success: true }),
      };

      registry.register(command);

      expect(registry.has("help")).toBe(true);
      expect(registry.has("h")).toBe(true);
      expect(registry.has("?")).toBe(true);
    });

    test("throws error on duplicate command name", () => {
      const command1: CommandDefinition = {
        name: "test",
        description: "First test",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      const command2: CommandDefinition = {
        name: "test",
        description: "Second test",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      registry.register(command1);

      expect(() => registry.register(command2)).toThrow("Command name 'test' is already registered");
    });

    test("throws error when alias conflicts with existing command name", () => {
      const command1: CommandDefinition = {
        name: "test",
        description: "Test command",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      const command2: CommandDefinition = {
        name: "other",
        description: "Other command",
        category: "builtin",
        aliases: ["test"], // Conflicts with command1's name
        execute: () => ({ success: true }),
      };

      registry.register(command1);

      expect(() => registry.register(command2)).toThrow("Alias 'test' conflicts with existing command or alias");
    });

    test("throws error when alias conflicts with another alias", () => {
      const command1: CommandDefinition = {
        name: "first",
        description: "First command",
        category: "builtin",
        aliases: ["f"],
        execute: () => ({ success: true }),
      };

      const command2: CommandDefinition = {
        name: "second",
        description: "Second command",
        category: "builtin",
        aliases: ["f"], // Conflicts with command1's alias
        execute: () => ({ success: true }),
      };

      registry.register(command1);

      expect(() => registry.register(command2)).toThrow("Alias 'f' conflicts with existing command or alias");
    });

    test("handles case-insensitive registration", () => {
      const command1: CommandDefinition = {
        name: "Test",
        description: "Test command",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      const command2: CommandDefinition = {
        name: "test",
        description: "Another test",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      registry.register(command1);

      // Should throw because "test" and "Test" are treated the same
      expect(() => registry.register(command2)).toThrow("Command name 'test' is already registered");
    });
  });

  describe("get", () => {
    test("retrieves command by name", () => {
      const command: CommandDefinition = {
        name: "test",
        description: "Test command",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      registry.register(command);

      const retrieved = registry.get("test");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("test");
      expect(retrieved?.description).toBe("Test command");
    });

    test("retrieves command by alias", () => {
      const command: CommandDefinition = {
        name: "help",
        description: "Show help",
        category: "builtin",
        aliases: ["h", "?"],
        execute: () => ({ success: true }),
      };

      registry.register(command);

      const byName = registry.get("help");
      const byAlias1 = registry.get("h");
      const byAlias2 = registry.get("?");

      expect(byName).toBeDefined();
      expect(byAlias1).toBe(byName);
      expect(byAlias2).toBe(byName);
    });

    test("returns undefined for non-existent command", () => {
      const result = registry.get("nonexistent");
      expect(result).toBeUndefined();
    });

    test("performs case-insensitive lookup", () => {
      const command: CommandDefinition = {
        name: "Test",
        description: "Test command",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      registry.register(command);

      expect(registry.get("test")).toBeDefined();
      expect(registry.get("TEST")).toBeDefined();
      expect(registry.get("TeSt")).toBeDefined();
    });

    test("performs case-insensitive alias lookup", () => {
      const command: CommandDefinition = {
        name: "help",
        description: "Show help",
        category: "builtin",
        aliases: ["H"],
        execute: () => ({ success: true }),
      };

      registry.register(command);

      expect(registry.get("h")).toBeDefined();
      expect(registry.get("H")).toBeDefined();
    });
  });

  describe("search", () => {
    test("finds commands matching prefix", () => {
      registry.register({
        name: "help",
        description: "Show help",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "history",
        description: "Show history",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "exit",
        description: "Exit app",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      const results = registry.search("h");
      expect(results.length).toBe(2);
      expect(results.map((c) => c.name)).toContain("help");
      expect(results.map((c) => c.name)).toContain("history");
    });

    test("finds commands by alias prefix", () => {
      registry.register({
        name: "help",
        description: "Show help",
        category: "builtin",
        aliases: ["h"],
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "exit",
        description: "Exit app",
        category: "builtin",
        aliases: ["quit"],
        execute: () => ({ success: true }),
      });

      const results = registry.search("h");
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("help");
    });

    test("excludes hidden commands from search results", () => {
      registry.register({
        name: "help",
        description: "Show help",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "hidden",
        description: "Hidden command",
        category: "builtin",
        hidden: true,
        execute: () => ({ success: true }),
      });

      const results = registry.search("h");
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("help");
    });

    test("returns empty array when no matches found", () => {
      registry.register({
        name: "help",
        description: "Show help",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      const results = registry.search("xyz");
      expect(results.length).toBe(0);
    });

    test("performs case-insensitive search", () => {
      registry.register({
        name: "Help",
        description: "Show help",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      const results = registry.search("hel");
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("Help");
    });

    test("sorts results with exact matches first", () => {
      registry.register({
        name: "test",
        description: "Test command",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "testing",
        description: "Testing command",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      const results = registry.search("test");
      expect(results[0]!.name).toBe("test");
      expect(results[1]!.name).toBe("testing");
    });

    test("avoids duplicate results when alias matches", () => {
      registry.register({
        name: "help",
        description: "Show help",
        category: "builtin",
        aliases: ["h", "halp"],
        execute: () => ({ success: true }),
      });

      const results = registry.search("h");
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("help");
    });
  });

  describe("unregister", () => {
    test("removes command and its aliases", () => {
      const command: CommandDefinition = {
        name: "test",
        description: "Test command",
        category: "builtin",
        aliases: ["t"],
        execute: () => ({ success: true }),
      };

      registry.register(command);
      expect(registry.has("test")).toBe(true);
      expect(registry.has("t")).toBe(true);

      const removed = registry.unregister("test");
      expect(removed).toBe(true);
      expect(registry.has("test")).toBe(false);
      expect(registry.has("t")).toBe(false);
    });

    test("returns false when command does not exist", () => {
      const removed = registry.unregister("nonexistent");
      expect(removed).toBe(false);
    });

    test("allows re-registration after unregister", () => {
      const command: CommandDefinition = {
        name: "test",
        description: "Test command",
        category: "builtin",
        execute: () => ({ success: true }),
      };

      registry.register(command);
      registry.unregister("test");

      // Should not throw
      expect(() => registry.register(command)).not.toThrow();
      expect(registry.has("test")).toBe(true);
    });
  });

  describe("has", () => {
    test("returns true for registered command", () => {
      registry.register({
        name: "test",
        description: "Test command",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      expect(registry.has("test")).toBe(true);
    });

    test("returns true for registered alias", () => {
      registry.register({
        name: "help",
        description: "Show help",
        category: "builtin",
        aliases: ["h"],
        execute: () => ({ success: true }),
      });

      expect(registry.has("h")).toBe(true);
    });

    test("returns false for non-existent command", () => {
      expect(registry.has("nonexistent")).toBe(false);
    });
  });

  describe("size", () => {
    test("returns 0 for empty registry", () => {
      expect(registry.size()).toBe(0);
    });

    test("returns correct count of registered commands", () => {
      registry.register({
        name: "test1",
        description: "Test 1",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "test2",
        description: "Test 2",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      expect(registry.size()).toBe(2);
    });

    test("does not count aliases in size", () => {
      registry.register({
        name: "test",
        description: "Test command",
        category: "builtin",
        aliases: ["t", "tst"],
        execute: () => ({ success: true }),
      });

      expect(registry.size()).toBe(1);
    });
  });

  describe("clear", () => {
    test("removes all commands and aliases", () => {
      registry.register({
        name: "test1",
        description: "Test 1",
        category: "builtin",
        aliases: ["t1"],
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "test2",
        description: "Test 2",
        category: "builtin",
        aliases: ["t2"],
        execute: () => ({ success: true }),
      });

      expect(registry.size()).toBe(2);

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.has("test1")).toBe(false);
      expect(registry.has("t1")).toBe(false);
      expect(registry.has("test2")).toBe(false);
      expect(registry.has("t2")).toBe(false);
    });
  });

  describe("all", () => {
    test("returns all non-hidden commands", () => {
      registry.register({
        name: "visible1",
        description: "Visible 1",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "visible2",
        description: "Visible 2",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "hidden",
        description: "Hidden",
        category: "builtin",
        hidden: true,
        execute: () => ({ success: true }),
      });

      const all = registry.all();
      expect(all.length).toBe(2);
      expect(all.map((c) => c.name)).toContain("visible1");
      expect(all.map((c) => c.name)).toContain("visible2");
      expect(all.map((c) => c.name)).not.toContain("hidden");
    });

    test("returns empty array for empty registry", () => {
      const all = registry.all();
      expect(all.length).toBe(0);
    });
  });

  describe("category sorting", () => {
    test("prioritizes workflow commands in search results", () => {
      registry.register({
        name: "test-builtin",
        description: "Builtin test",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "test-workflow",
        description: "Workflow test",
        category: "workflow",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "test-skill",
        description: "Skill test",
        category: "skill",
        execute: () => ({ success: true }),
      });

      const results = registry.search("test");
      
      // Workflow should be first, then skill, then builtin
      expect(results[0]!.category).toBe("workflow");
      expect(results[1]!.category).toBe("skill");
      expect(results[2]!.category).toBe("builtin");
    });

    test("sorts alphabetically within same category", () => {
      registry.register({
        name: "zebra",
        description: "Zebra command",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      registry.register({
        name: "apple",
        description: "Apple command",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      const results = registry.search("");
      expect(results[0]!.name).toBe("apple");
      expect(results[1]!.name).toBe("zebra");
    });
  });
});
