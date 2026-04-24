/**
 * Tests for `src/sdk/management-commands.ts` — the shared builders that
 * attach `session` + `status` subcommands. Verifies the command shape is
 * correct without actually running the commands (which would call
 * `process.exit`).
 */

import { test, expect, describe } from "bun:test";
import { Command } from "@commander-js/extra-typings";
import {
  addSessionSubcommand,
  addStatusSubcommand,
  addManagementCommands,
} from "../../src/sdk/management-commands.ts";

describe("addSessionSubcommand", () => {
  test("adds a `session` command with `list` / `connect` / `kill` children", () => {
    const parent = new Command("worker");
    addSessionSubcommand(parent);

    const session = parent.commands.find((c) => c.name() === "session");
    expect(session).toBeDefined();

    const childNames = session!.commands.map((c) => c.name()).sort();
    expect(childNames).toEqual(["connect", "kill", "list"]);
  });

  test("`session kill` exposes -y/--yes for non-interactive callers", () => {
    const parent = new Command("worker");
    addSessionSubcommand(parent);

    const session = parent.commands.find((c) => c.name() === "session")!;
    const kill = session.commands.find((c) => c.name() === "kill")!;
    expect(kill.options.find((o) => o.long === "--yes")).toBeDefined();
    expect(kill.options.find((o) => o.short === "-y")).toBeDefined();
  });

  test("all three subcommands accept repeatable `-a/--agent` filters", () => {
    const parent = new Command("worker");
    addSessionSubcommand(parent);

    const session = parent.commands.find((c) => c.name() === "session")!;
    for (const child of session.commands) {
      expect(child.options.find((o) => o.long === "--agent")).toBeDefined();
      expect(child.options.find((o) => o.short === "-a")).toBeDefined();
    }
  });
});

describe("addStatusSubcommand", () => {
  test("adds a `status` command accepting an optional session id", () => {
    const parent = new Command("worker");
    addStatusSubcommand(parent);

    const status = parent.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
    // Commander's `_args` holds the argument definitions.
    // An optional argument has `required: false`.
    const firstArg = status!.registeredArguments[0];
    expect(firstArg).toBeDefined();
    expect(firstArg!.required).toBe(false);
  });

  test("`status` exposes --format json|text option with `json` default", () => {
    const parent = new Command("worker");
    addStatusSubcommand(parent);

    const status = parent.commands.find((c) => c.name() === "status")!;
    const format = status.options.find((o) => o.long === "--format");
    expect(format).toBeDefined();
    expect(format!.defaultValue).toBe("json");
  });
});

describe("addManagementCommands", () => {
  test("attaches both `session` and `status` at once", () => {
    const parent = new Command("worker");
    addManagementCommands(parent);

    const names = parent.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["session", "status"]);
  });
});
