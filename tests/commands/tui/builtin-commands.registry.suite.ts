import { describe, expect, test } from "bun:test";
import { CommandRegistry } from "@/commands/tui/registry.ts";
import { builtinCommands } from "./builtin-commands.test-support.ts";

describe("Built-in Commands registry exports", () => {
  describe("builtinCommands", () => {
    test("exports all builtin commands", () => {
      expect(builtinCommands).toBeDefined();
      expect(Array.isArray(builtinCommands)).toBe(true);
      expect(builtinCommands.length).toBeGreaterThan(0);

      const commandNames = builtinCommands.map((command) => command.name);
      expect(commandNames).toContain("theme");
      expect(commandNames).toContain("clear");
      expect(commandNames).toContain("compact");
      expect(commandNames).toContain("exit");
      expect(commandNames).toContain("model");
      expect(commandNames).toContain("mcp");
    });
  });

  describe("registerBuiltinCommands behavior", () => {
    test("registers all builtin commands with registry", () => {
      const registry = new CommandRegistry();

      for (const command of builtinCommands) {
        if (!registry.has(command.name)) {
          registry.register(command);
        }
      }

      expect(registry.has("theme")).toBe(true);
      expect(registry.has("clear")).toBe(true);
      expect(registry.has("compact")).toBe(true);
      expect(registry.has("exit")).toBe(true);
      expect(registry.has("model")).toBe(true);
      expect(registry.has("mcp")).toBe(true);
    });

    test("is idempotent across repeated registrations", () => {
      const registry = new CommandRegistry();

      for (const command of builtinCommands) {
        if (!registry.has(command.name)) {
          registry.register(command);
        }
      }

      const sizeAfterFirst = registry.size();

      for (const command of builtinCommands) {
        if (!registry.has(command.name)) {
          registry.register(command);
        }
      }

      expect(registry.size()).toBe(sizeAfterFirst);
    });
  });
});
