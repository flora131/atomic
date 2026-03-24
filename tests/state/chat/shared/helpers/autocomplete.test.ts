import { describe, expect, test } from "bun:test";
import {
  resolveSlashAutocompleteExecution,
  getMentionSuggestions,
} from "@/state/chat/shared/helpers/autocomplete.ts";
import type { CommandDefinition } from "@/commands/tui/index.ts";

function makeCommand(name: string): CommandDefinition {
  return {
    name,
    description: `${name} command`,
    category: "general" as CommandDefinition["category"],
    execute: () => ({ success: true as const }),
  };
}

function makeGetCommandByName(knownCommands: string[]) {
  const commands = new Map(knownCommands.map((n) => [n, makeCommand(n)]));
  return (name: string) => commands.get(name);
}

describe("resolveSlashAutocompleteExecution", () => {
  test("returns input trigger for valid slash command with args and known command", () => {
    const result = resolveSlashAutocompleteExecution({
      rawInput: "/help some args",
      selectedCommandName: "fallback",
      getCommandByName: makeGetCommandByName(["help"]),
    });
    expect(result).toEqual({
      commandName: "help",
      commandArgs: "some args",
      userMessage: "/help some args",
      trigger: "input",
    });
  });

  test("returns autocomplete trigger for valid slash command without args", () => {
    const result = resolveSlashAutocompleteExecution({
      rawInput: "/help",
      selectedCommandName: "help",
      getCommandByName: makeGetCommandByName(["help"]),
    });
    expect(result).toEqual({
      commandName: "help",
      commandArgs: "",
      userMessage: "/help",
      trigger: "autocomplete",
    });
  });

  test("returns autocomplete trigger for unknown command even with args", () => {
    const result = resolveSlashAutocompleteExecution({
      rawInput: "/unknown some args",
      selectedCommandName: "selected",
      getCommandByName: makeGetCommandByName(["help"]),
    });
    expect(result).toEqual({
      commandName: "selected",
      commandArgs: "",
      userMessage: "/selected",
      trigger: "autocomplete",
    });
  });

  test("returns autocomplete trigger for non-slash input", () => {
    const result = resolveSlashAutocompleteExecution({
      rawInput: "just some text",
      selectedCommandName: "selected",
      getCommandByName: makeGetCommandByName(["help"]),
    });
    expect(result).toEqual({
      commandName: "selected",
      commandArgs: "",
      userMessage: "/selected",
      trigger: "autocomplete",
    });
  });

  test("trims raw input before parsing", () => {
    const result = resolveSlashAutocompleteExecution({
      rawInput: "  /ralph Build a feature  ",
      selectedCommandName: "fallback",
      getCommandByName: makeGetCommandByName(["ralph"]),
    });
    expect(result).toEqual({
      commandName: "ralph",
      commandArgs: "Build a feature",
      userMessage: "/ralph Build a feature",
      trigger: "input",
    });
  });

  test("returns autocomplete trigger for empty input", () => {
    const result = resolveSlashAutocompleteExecution({
      rawInput: "",
      selectedCommandName: "default",
      getCommandByName: makeGetCommandByName([]),
    });
    expect(result.trigger).toBe("autocomplete");
    expect(result.commandName).toBe("default");
  });

  test("command name is lowercased by parseSlashCommand", () => {
    const result = resolveSlashAutocompleteExecution({
      rawInput: "/HELP do stuff",
      selectedCommandName: "fallback",
      getCommandByName: makeGetCommandByName(["help"]),
    });
    // parseSlashCommand lowercases the command name
    expect(result.commandName).toBe("help");
    expect(result.trigger).toBe("input");
  });
});

// Guard: detect if we're inside a git work-tree so I/O-dependent tests
// can be skipped in shallow clones, bare repos, or non-git environments.
const insideGitWorkTree: boolean = (() => {
  try {
    const res = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"]);
    return res.success && res.stdout.toString().trim() === "true";
  } catch {
    return false;
  }
})();

describe("getMentionSuggestions", () => {
  // This function does real I/O (git ls-files / glob scan) so tests are
  // guarded: they skip when git is unavailable or the repo state is atypical.

  test("returns an array even when git is unavailable", () => {
    // getMentionSuggestions has its own try/catch fallback from git to glob,
    // so it should always return an array regardless of environment.
    const result = getMentionSuggestions("");
    expect(Array.isArray(result)).toBe(true);
  });

  test.skipIf(!insideGitWorkTree)("results have correct shape", () => {
    const results = getMentionSuggestions("");
    expect(results.length).toBeGreaterThan(0);
    for (const item of results) {
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("description");
      expect(item).toHaveProperty("category");
      expect(item).toHaveProperty("execute");
      expect(["folder", "file"]).toContain(item.category);
    }
  });

  test.skipIf(!insideGitWorkTree)("filters by input string", () => {
    const all = getMentionSuggestions("");
    const filtered = getMentionSuggestions("package.json");
    // Filtered should be a subset
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    // All results should contain the search string
    for (const item of filtered) {
      expect(item.name.toLowerCase()).toContain("package.json");
    }
  });

  test.skipIf(!insideGitWorkTree)("sorts directories before files", () => {
    const results = getMentionSuggestions("src");
    const firstDirEnd = results.findIndex((r) => r.category === "file");
    if (firstDirEnd > 0) {
      // All items before firstDirEnd should be folders
      for (let i = 0; i < firstDirEnd; i++) {
        expect(results[i]!.category).toBe("folder");
      }
    }
  });

  test("limits total results", () => {
    const results = getMentionSuggestions("");
    // Max is 15 total (7 dirs + remaining files)
    expect(results.length).toBeLessThanOrEqual(15);
  });
});
