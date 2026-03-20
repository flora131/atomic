import { describe, expect, test } from "bun:test";
import { parseSlashCommand } from "@/commands/tui/index.ts";
import { deriveComposerAutocompleteState } from "@/state/chat/composer/autocomplete.ts";
import type { WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import { defaultWorkflowCommandState } from "@/services/workflows/workflow-types.ts";

const baseWorkflowState: WorkflowChatState = {
  showAutocomplete: false,
  autocompleteInput: "",
  selectedSuggestionIndex: 0,
  argumentHint: "",
  autocompleteMode: "command" as const,
  mentionStartOffset: 0,
  workflowActive: false,
  workflowType: null,
  initialPrompt: null,
  currentStage: null,
  stageIndicator: null,
  workflowCommandState: { ...defaultWorkflowCommandState },
};

describe("parseSlashCommand – multiline handling", () => {
  test("command with newline separating args", () => {
    const result = parseSlashCommand("/research-codebase\nDocument the codebase");
    expect(result).toEqual({
      isCommand: true,
      name: "research-codebase",
      args: "Document the codebase",
      raw: "/research-codebase\nDocument the codebase",
    });
  });

  test("command followed by bare newline", () => {
    const result = parseSlashCommand("/help\n");
    expect(result).toEqual({
      isCommand: true,
      name: "help",
      args: "",
      raw: "/help\n",
    });
  });

  test("command with multi-line args", () => {
    const result = parseSlashCommand("/ralph\nBuild auth\nWith JWT tokens");
    expect(result).toEqual({
      isCommand: true,
      name: "ralph",
      args: "Build auth\nWith JWT tokens",
      raw: "/ralph\nBuild auth\nWith JWT tokens",
    });
  });

  test("input not starting with / is not a command even if later lines have /", () => {
    const result = parseSlashCommand("Hello\n/help");
    expect(result.isCommand).toBe(false);
  });

  test("single-line command without args still works", () => {
    const result = parseSlashCommand("/help");
    expect(result).toEqual({
      isCommand: true,
      name: "help",
      args: "",
      raw: "/help",
    });
  });

  test("single-line command with args still works", () => {
    const result = parseSlashCommand("/ralph Build a feature");
    expect(result).toEqual({
      isCommand: true,
      name: "ralph",
      args: "Build a feature",
      raw: "/ralph Build a feature",
    });
  });
});

describe("deriveComposerAutocompleteState – multiline handling", () => {
  test("cursor on first line with partial command shows autocomplete", () => {
    const result = deriveComposerAutocompleteState("/res\nsome other text", 4, baseWorkflowState);
    expect(result).not.toBeNull();
    expect(result!.showAutocomplete).toBe(true);
    expect(result!.autocompleteInput).toBe("res");
  });

  test("cursor NOT on first line does not trigger command autocomplete", () => {
    // rawValue = "/res\nsome other text", cursorOffset = 10 (inside "some other text")
    const result = deriveComposerAutocompleteState("/res\nsome other text", 10, baseWorkflowState);
    // When cursor is not on first line, command autocomplete should not activate
    if (result !== null) {
      // Either showAutocomplete is false or mode is not "command"
      if (result.autocompleteMode === "command" || result.autocompleteMode === undefined) {
        expect(result.showAutocomplete).toBeFalsy();
      }
    }
  });

  test("cursor on first line after complete command hides autocomplete", () => {
    // "/help \nmore text" with cursor at position 6 (after the space)
    const result = deriveComposerAutocompleteState("/help \nmore text", 6, baseWorkflowState);
    expect(result).not.toBeNull();
    expect(result!.showAutocomplete).toBe(false);
  });

  test("single-line partial command still works", () => {
    const result = deriveComposerAutocompleteState("/res", 4, baseWorkflowState);
    expect(result).not.toBeNull();
    expect(result!.showAutocomplete).toBe(true);
    expect(result!.autocompleteInput).toBe("res");
  });

  test("leading whitespace before slash does not trigger command autocomplete", () => {
    const result = deriveComposerAutocompleteState(" /research-codebase", 19, baseWorkflowState);
    if (result !== null) {
      expect(result.showAutocomplete).toBeFalsy();
    }
  });
});
