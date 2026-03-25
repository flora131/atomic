/**
 * Tests for src/commands/core/registry.ts
 *
 * Unit tests for CommandRegistry:
 * - register: name registration, duplicate detection, alias registration, case-insensitivity
 * - unregister: removal of command and its aliases
 * - get: lookup by name, alias, and case-insensitive matching
 * - search: prefix matching, hidden exclusion, alias prefix, sorting, deduplication
 * - all: listing non-hidden commands
 * - has: existence check by name or alias
 * - size: command count
 * - clear: full reset
 */

import { test, describe, expect, beforeEach } from "bun:test";
import { CommandRegistry } from "@/commands/core/registry.ts";
import type { CommandDefinition, CommandCategory } from "@/commands/core/types.ts";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createCommand(
  overrides: Partial<CommandDefinition> & { name: string },
): CommandDefinition {
  return {
    category: "builtin" as CommandCategory,
    description: "Test command",
    execute: async () => ({ success: true }),
    ...overrides,
  } as CommandDefinition;
}

// ---------------------------------------------------------------------------
// Fresh registry per test
// ---------------------------------------------------------------------------

let registry: CommandRegistry;

beforeEach(() => {
  registry = new CommandRegistry();
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe("register", () => {
  test("registers a command by name", () => {
    const cmd = createCommand({ name: "hello" });
    registry.register(cmd);

    expect(registry.get("hello")).toBe(cmd);
    expect(registry.size()).toBe(1);
  });

  test("throws when registering duplicate name", () => {
    registry.register(createCommand({ name: "hello" }));

    expect(() => registry.register(createCommand({ name: "hello" }))).toThrow(
      "Command name 'hello' is already registered",
    );
  });

  test("registers command aliases", () => {
    const cmd = createCommand({ name: "greet", aliases: ["hi", "hey"] });
    registry.register(cmd);

    expect(registry.get("hi")).toBe(cmd);
    expect(registry.get("hey")).toBe(cmd);
  });

  test("throws when alias conflicts with existing command", () => {
    registry.register(createCommand({ name: "hi" }));

    expect(() =>
      registry.register(createCommand({ name: "greet", aliases: ["hi"] })),
    ).toThrow("Alias 'hi' conflicts with existing command or alias");
  });

  test("throws when alias conflicts with existing alias", () => {
    registry.register(createCommand({ name: "greet", aliases: ["hi"] }));

    expect(() =>
      registry.register(createCommand({ name: "salute", aliases: ["hi"] })),
    ).toThrow("Alias 'hi' conflicts with existing command or alias");
  });

  test("throws when name conflicts with existing alias", () => {
    registry.register(createCommand({ name: "greet", aliases: ["hi"] }));

    expect(() => registry.register(createCommand({ name: "hi" }))).toThrow(
      "Command name 'hi' is already registered",
    );
  });

  test("case-insensitive name registration", () => {
    registry.register(createCommand({ name: "Hello" }));

    expect(() => registry.register(createCommand({ name: "hello" }))).toThrow(
      "Command name 'hello' is already registered",
    );
    expect(() => registry.register(createCommand({ name: "HELLO" }))).toThrow(
      "Command name 'hello' is already registered",
    );
  });
});

// ---------------------------------------------------------------------------
// unregister
// ---------------------------------------------------------------------------

describe("unregister", () => {
  test("removes a registered command", () => {
    registry.register(createCommand({ name: "hello" }));

    expect(registry.unregister("hello")).toBe(true);
    expect(registry.has("hello")).toBe(false);
    expect(registry.size()).toBe(0);
  });

  test("returns false for non-existent command", () => {
    expect(registry.unregister("nope")).toBe(false);
  });

  test("also removes command's aliases", () => {
    registry.register(
      createCommand({ name: "greet", aliases: ["hi", "hey"] }),
    );

    registry.unregister("greet");

    expect(registry.has("hi")).toBe(false);
    expect(registry.has("hey")).toBe(false);
    expect(registry.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("get", () => {
  test("returns command by name", () => {
    const cmd = createCommand({ name: "hello" });
    registry.register(cmd);

    expect(registry.get("hello")).toBe(cmd);
  });

  test("returns command by alias", () => {
    const cmd = createCommand({ name: "greet", aliases: ["hi"] });
    registry.register(cmd);

    expect(registry.get("hi")).toBe(cmd);
  });

  test("returns undefined for unknown name", () => {
    expect(registry.get("nope")).toBeUndefined();
  });

  test("case-insensitive lookup", () => {
    const cmd = createCommand({ name: "Hello", aliases: ["Hi"] });
    registry.register(cmd);

    expect(registry.get("hello")).toBe(cmd);
    expect(registry.get("HELLO")).toBe(cmd);
    expect(registry.get("hi")).toBe(cmd);
    expect(registry.get("HI")).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("search", () => {
  test("finds commands matching prefix", () => {
    registry.register(createCommand({ name: "help" }));
    registry.register(createCommand({ name: "hello" }));
    registry.register(createCommand({ name: "exit" }));

    const results = registry.search("hel");

    expect(results).toHaveLength(2);
    const names = results.map((c) => c.name);
    expect(names).toContain("help");
    expect(names).toContain("hello");
  });

  test("excludes hidden commands", () => {
    registry.register(createCommand({ name: "visible" }));
    registry.register(createCommand({ name: "hidden-cmd", hidden: true }));

    const results = registry.search(""); // empty prefix matches all non-hidden

    const names = results.map((c) => c.name);
    expect(names).toContain("visible");
    expect(names).not.toContain("hidden-cmd");
  });

  test("finds commands by alias prefix", () => {
    const cmd = createCommand({ name: "greet", aliases: ["hi"] });
    registry.register(cmd);

    const results = registry.search("hi");

    expect(results).toHaveLength(1);
    expect(results[0]).toBe(cmd);
  });

  test("sorts results: exact match first, then by category priority, then alphabetical", () => {
    // Register commands with different categories
    registry.register(createCommand({ name: "build", category: "builtin" }));
    registry.register(createCommand({ name: "bot", category: "agent" }));
    registry.register(createCommand({ name: "backup", category: "workflow" }));
    // "build" has category builtin (priority 3), "bot" agent (2), "backup" workflow (0)

    const results = registry.search("b");
    const names = results.map((c) => c.name);

    // workflow (0) < agent (2) < builtin (3)
    expect(names).toEqual(["backup", "bot", "build"]);
  });

  test("exact match gets priority over category ordering", () => {
    registry.register(createCommand({ name: "b", category: "file" })); // exact, low priority cat
    registry.register(createCommand({ name: "build", category: "workflow" })); // prefix, high priority cat

    const results = registry.search("b");

    // "b" is exact match so it should come first despite file category (5) > workflow (0)
    expect(results[0]!.name).toBe("b");
    expect(results[1]!.name).toBe("build");
  });

  test("does not duplicate commands found via both name and alias", () => {
    const cmd = createCommand({ name: "greet", aliases: ["greeting"] });
    registry.register(cmd);

    // Both "greet" and "greeting" start with "greet"
    const results = registry.search("greet");

    expect(results).toHaveLength(1);
    expect(results[0]).toBe(cmd);
  });

  test("hidden commands found via alias prefix are also excluded", () => {
    registry.register(
      createCommand({ name: "secret", aliases: ["sc"], hidden: true }),
    );

    const results = registry.search("sc");
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// all
// ---------------------------------------------------------------------------

describe("all", () => {
  test("returns all non-hidden commands", () => {
    registry.register(createCommand({ name: "alpha" }));
    registry.register(createCommand({ name: "beta" }));

    const results = registry.all();

    expect(results).toHaveLength(2);
    const names = results.map((c) => c.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });

  test("excludes hidden commands", () => {
    registry.register(createCommand({ name: "visible" }));
    registry.register(createCommand({ name: "invisible", hidden: true }));

    const results = registry.all();

    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("visible");
  });
});

// ---------------------------------------------------------------------------
// has
// ---------------------------------------------------------------------------

describe("has", () => {
  test("returns true for registered names", () => {
    registry.register(createCommand({ name: "hello" }));

    expect(registry.has("hello")).toBe(true);
  });

  test("returns true for registered aliases", () => {
    registry.register(createCommand({ name: "greet", aliases: ["hi"] }));

    expect(registry.has("hi")).toBe(true);
  });

  test("returns false for unknown names", () => {
    expect(registry.has("nope")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// size
// ---------------------------------------------------------------------------

describe("size", () => {
  test("returns 0 for empty registry", () => {
    expect(registry.size()).toBe(0);
  });

  test("returns correct count after registrations", () => {
    registry.register(createCommand({ name: "a" }));
    registry.register(createCommand({ name: "b" }));
    registry.register(createCommand({ name: "c" }));

    expect(registry.size()).toBe(3);
  });

  test("does not count aliases as separate commands", () => {
    registry.register(
      createCommand({ name: "greet", aliases: ["hi", "hey"] }),
    );

    expect(registry.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe("clear", () => {
  test("empties both commands and aliases", () => {
    registry.register(
      createCommand({ name: "greet", aliases: ["hi", "hey"] }),
    );
    registry.register(createCommand({ name: "exit" }));

    registry.clear();

    expect(registry.size()).toBe(0);
    expect(registry.has("greet")).toBe(false);
    expect(registry.has("hi")).toBe(false);
    expect(registry.has("hey")).toBe(false);
    expect(registry.has("exit")).toBe(false);
  });

  test("allows re-registration after clear", () => {
    const cmd = createCommand({ name: "hello" });
    registry.register(cmd);
    registry.clear();

    // Should not throw — the name is free again
    const cmd2 = createCommand({ name: "hello" });
    registry.register(cmd2);

    expect(registry.get("hello")).toBe(cmd2);
    expect(registry.size()).toBe(1);
  });
});
