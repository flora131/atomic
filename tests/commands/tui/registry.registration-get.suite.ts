import { beforeEach, describe, expect, test } from "bun:test";
import {
  CommandRegistry,
  type CommandDefinition,
} from "@/commands/tui/registry.ts";

describe("CommandRegistry registration and lookup", () => {
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

      expect(() => registry.register(command2)).toThrow(
        "Command name 'test' is already registered",
      );
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
        aliases: ["test"],
        execute: () => ({ success: true }),
      };

      registry.register(command1);

      expect(() => registry.register(command2)).toThrow(
        "Alias 'test' conflicts with existing command or alias",
      );
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
        aliases: ["f"],
        execute: () => ({ success: true }),
      };

      registry.register(command1);

      expect(() => registry.register(command2)).toThrow(
        "Alias 'f' conflicts with existing command or alias",
      );
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

      expect(() => registry.register(command2)).toThrow(
        "Command name 'test' is already registered",
      );
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
      expect(registry.get("nonexistent")).toBeUndefined();
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
});
