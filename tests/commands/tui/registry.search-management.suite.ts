import { beforeEach, describe, expect, test } from "bun:test";
import {
  CommandRegistry,
  type CommandDefinition,
} from "@/commands/tui/registry.ts";

describe("CommandRegistry search and management", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
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
      expect(results.map((command) => command.name)).toContain("help");
      expect(results.map((command) => command.name)).toContain("history");
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
      expect(results[0]?.name).toBe("help");
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
      expect(results[0]?.name).toBe("help");
    });

    test("returns empty array when no matches found", () => {
      registry.register({
        name: "help",
        description: "Show help",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      expect(registry.search("xyz")).toHaveLength(0);
    });

    test("performs case-insensitive search", () => {
      registry.register({
        name: "Help",
        description: "Show help",
        category: "builtin",
        execute: () => ({ success: true }),
      });

      const results = registry.search("hel");
      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("Help");
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
      expect(results[0]?.name).toBe("test");
      expect(results[1]?.name).toBe("testing");
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
      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("help");
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
      expect(registry.unregister("nonexistent")).toBe(false);
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
});
