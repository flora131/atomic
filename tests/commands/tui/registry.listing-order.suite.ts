import { beforeEach, describe, expect, test } from "bun:test";
import { CommandRegistry } from "@/commands/tui/registry.ts";

describe("CommandRegistry listing and ordering", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
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
      expect(all).toHaveLength(2);
      expect(all.map((command) => command.name)).toContain("visible1");
      expect(all.map((command) => command.name)).toContain("visible2");
      expect(all.map((command) => command.name)).not.toContain("hidden");
    });

    test("returns empty array for empty registry", () => {
      expect(registry.all()).toHaveLength(0);
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

      expect(results[0]?.category).toBe("workflow");
      expect(results[1]?.category).toBe("skill");
      expect(results[2]?.category).toBe("builtin");
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
      expect(results[0]?.name).toBe("apple");
      expect(results[1]?.name).toBe("zebra");
    });
  });
});
