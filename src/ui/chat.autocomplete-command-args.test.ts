import { describe, expect, test } from "bun:test";
import type { CommandDefinition } from "./commands/index.ts";
import { resolveSlashAutocompleteExecution } from "./chat.tsx";

function createCommand(name: string): CommandDefinition {
  return {
    name,
    description: `Command ${name}`,
    category: "skill",
    execute: () => ({ success: true }),
  };
}

describe("resolveSlashAutocompleteExecution", () => {
  test("preserves typed slash command arguments when command exists", () => {
    const command = createCommand("prompt-engineer");

    const resolved = resolveSlashAutocompleteExecution({
      rawInput: "/prompt-engineer Refine my prompt: add debugging output to all critical functions",
      selectedCommandName: "prompt-engineer",
      getCommandByName: (name) => (name === command.name ? command : undefined),
    });

    expect(resolved).toEqual({
      commandName: "prompt-engineer",
      commandArgs: "Refine my prompt: add debugging output to all critical functions",
      userMessage: "/prompt-engineer Refine my prompt: add debugging output to all critical functions",
      trigger: "input",
    });
  });

  test("falls back to selected command when no typed args are present", () => {
    const resolved = resolveSlashAutocompleteExecution({
      rawInput: "/prompt-eng",
      selectedCommandName: "prompt-engineer",
      getCommandByName: () => undefined,
    });

    expect(resolved).toEqual({
      commandName: "prompt-engineer",
      commandArgs: "",
      userMessage: "/prompt-engineer",
      trigger: "autocomplete",
    });
  });

  test("falls back to selected command when typed command is not registered", () => {
    const resolved = resolveSlashAutocompleteExecution({
      rawInput: "/unknown-command some args",
      selectedCommandName: "prompt-engineer",
      getCommandByName: () => undefined,
    });

    expect(resolved).toEqual({
      commandName: "prompt-engineer",
      commandArgs: "",
      userMessage: "/prompt-engineer",
      trigger: "autocomplete",
    });
  });
});
