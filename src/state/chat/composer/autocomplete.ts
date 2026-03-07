import type { TextareaRenderable } from "@opentui/core";
import type { CommandDefinition } from "@/commands/tui/index.ts";
import { globalRegistry } from "@/commands/tui/index.ts";
import {
  getMentionSuggestions,
  resolveSlashAutocompleteExecution,
} from "@/state/chat/helpers.ts";
import type { WorkflowChatState } from "@/state/chat/types.ts";
import type {
  ComposerAutocompleteSelectionArgs,
  ComposerAutocompleteSuggestion,
} from "@/state/chat/composer/types.ts";

export const HLREF_COMMAND = 1;
export const HLREF_MENTION = 2;

function replaceTextareaValue(textarea: TextareaRenderable, value: string) {
  textarea.gotoBufferHome();
  textarea.gotoBufferEnd({ select: true });
  textarea.deleteChar();
  if (value) {
    textarea.insertText(value);
  }
}

function toHighlightOffset(text: string, index: number): number {
  let newlineCount = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") newlineCount++;
  }
  return index - newlineCount;
}

function findSlashCommandRange(text: string): [number, number] | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return null;

  const leadingWhitespace = text.length - trimmed.length;
  if (leadingWhitespace > 0) {
    const charBefore = text[leadingWhitespace - 1];
    if (charBefore === "\"" || charBefore === "'" || charBefore === "`") return null;
  }

  let i = 1;
  while (i < trimmed.length && /[\w-]/.test(trimmed[i]!)) i++;
  if (i <= 1) return null;

  const name = trimmed.slice(1, i);
  if (i < trimmed.length && !/\s/.test(trimmed[i]!)) return null;

  if (i < trimmed.length) {
    const charAfter = trimmed[i];
    if (charAfter === "\"" || charAfter === "'" || charAfter === "`") return null;
  }

  if (!globalRegistry.has(name)) return null;
  return [leadingWhitespace, leadingWhitespace + i];
}

export function isAtMentionBoundary(char: string): boolean {
  return char === " " || char === "\n" || char === "\t"
    || char === "(" || char === "[" || char === "{"
    || char === "," || char === ";" || char === ":"
    || char === "." || char === "!" || char === "?";
}

export function getComposerAutocompleteSuggestions(
  workflowState: WorkflowChatState,
): ComposerAutocompleteSuggestion[] {
  if (!workflowState.showAutocomplete) return [];
  return workflowState.autocompleteMode === "mention"
    ? getMentionSuggestions(workflowState.autocompleteInput)
    : globalRegistry.search(workflowState.autocompleteInput);
}

export function deriveComposerAutocompleteState(
  rawValue: string,
  cursorOffset: number,
  workflowState: WorkflowChatState,
): Partial<WorkflowChatState> | null {
  const value = rawValue.trimStart();
  if (value.startsWith("/")) {
    const afterSlash = value.slice(1);
    const spaceIndex = afterSlash.indexOf(" ");

    if (spaceIndex === -1) {
      return {
        showAutocomplete: true,
        autocompleteInput: afterSlash,
        selectedSuggestionIndex: 0,
        argumentHint: "",
      };
    }

    const commandName = afterSlash.slice(0, spaceIndex);
    const afterCommandSpace = afterSlash.slice(spaceIndex + 1);
    const command = globalRegistry.get(commandName);
    const textBeforeCursor = rawValue.slice(0, cursorOffset);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex !== -1 && atIndex > spaceIndex + 1) {
      const charBefore = atIndex > 0 ? (rawValue[atIndex - 1] ?? " ") : " ";
      if (isAtMentionBoundary(charBefore) || atIndex === 0) {
        const mentionToken = rawValue.slice(atIndex + 1, cursorOffset);
        if (!mentionToken.includes(" ")) {
          return {
            showAutocomplete: true,
            autocompleteInput: mentionToken,
            selectedSuggestionIndex: 0,
            autocompleteMode: "mention",
            mentionStartOffset: atIndex,
            argumentHint: "",
          };
        }
      }
    }

    return {
      showAutocomplete: false,
      autocompleteInput: "",
      argumentHint: afterCommandSpace.length === 0 ? (command?.argumentHint || "") : "",
    };
  }

  const textBeforeCursor = rawValue.slice(0, cursorOffset);
  const atIndex = textBeforeCursor.lastIndexOf("@");
  if (atIndex !== -1) {
    const charBefore = atIndex > 0 ? (rawValue[atIndex - 1] ?? " ") : " ";
    if (isAtMentionBoundary(charBefore) || atIndex === 0) {
      const mentionToken = rawValue.slice(atIndex + 1, cursorOffset);
      if (!mentionToken.includes(" ")) {
        return {
          showAutocomplete: true,
          autocompleteInput: mentionToken,
          selectedSuggestionIndex: 0,
          autocompleteMode: "mention",
          mentionStartOffset: atIndex,
          argumentHint: "",
        };
      }
    }
  }

  if (workflowState.showAutocomplete || workflowState.argumentHint) {
    return {
      showAutocomplete: false,
      autocompleteInput: "",
      selectedSuggestionIndex: 0,
      argumentHint: "",
      autocompleteMode: "command",
    };
  }

  return null;
}

export function applyComposerHighlights(
  textarea: TextareaRenderable,
  value: string,
  commandStyleId: number,
) {
  textarea.removeHighlightsByRef(HLREF_COMMAND);
  const range = findSlashCommandRange(value);
  if (range) {
    textarea.addHighlightByCharRange({
      start: toHighlightOffset(value, range[0]),
      end: toHighlightOffset(value, range[1]),
      styleId: commandStyleId,
      hlRef: HLREF_COMMAND,
    });
  }
  textarea.removeHighlightsByRef(HLREF_MENTION);
}

export function applyAutocompleteSelection({
  action,
  addMessage,
  command,
  executeCommand,
  textarea,
  updateWorkflowState,
  workflowState,
}: ComposerAutocompleteSelectionArgs & { command: CommandDefinition }): void {
  const isMention = workflowState.autocompleteMode === "mention";
  if (isMention) {
    const fullText = textarea.plainText ?? "";
    const mentionStart = workflowState.mentionStartOffset;
    const mentionEnd = mentionStart + 1 + workflowState.autocompleteInput.length;
    const before = fullText.slice(0, mentionStart);
    const after = fullText.slice(mentionEnd);

    replaceTextareaValue(textarea, "");

    if (action === "complete") {
      const isDirectoryMention = command.name.endsWith("/");
      const suffix = isDirectoryMention ? "" : " ";
      const replacement = `@${command.name}${suffix}`;
      textarea.insertText(before + replacement + after);
      textarea.cursorOffset = mentionStart + replacement.length;

      if (isDirectoryMention) {
        updateWorkflowState({
          showAutocomplete: true,
          autocompleteInput: command.name,
          selectedSuggestionIndex: 0,
          autocompleteMode: "mention",
          mentionStartOffset: mentionStart,
          argumentHint: "",
        });
      } else {
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          selectedSuggestionIndex: 0,
          autocompleteMode: "command",
          argumentHint: "",
        });
      }
      return;
    }

    if (command.category !== "agent") {
      const isDirectory = command.name.endsWith("/");
      const suffix = isDirectory ? "" : " ";
      const replacement = `@${command.name}${suffix}`;
      textarea.insertText(before + replacement + after);
      textarea.cursorOffset = mentionStart + replacement.length;
      updateWorkflowState({
        showAutocomplete: false,
        autocompleteInput: "",
        selectedSuggestionIndex: 0,
        autocompleteMode: "command",
        argumentHint: "",
      });
      return;
    }

    const remaining = (before + after).trim();
    if (remaining) textarea.insertText(remaining);
    updateWorkflowState({
      showAutocomplete: false,
      autocompleteInput: "",
      selectedSuggestionIndex: 0,
      autocompleteMode: "command",
      argumentHint: "",
    });
    addMessage("user", remaining ? `@${command.name} ${remaining}` : `@${command.name}`);
    void executeCommand(command.name, remaining, "mention");
    return;
  }

  const rawInput = textarea.plainText ?? "";
  const resolvedExecution = action === "execute"
    ? resolveSlashAutocompleteExecution({
      rawInput,
      selectedCommandName: command.name,
      getCommandByName: (name) => globalRegistry.get(name),
    })
    : null;
  replaceTextareaValue(textarea, "");
  updateWorkflowState({
    showAutocomplete: false,
    autocompleteInput: "",
    selectedSuggestionIndex: 0,
    autocompleteMode: "command",
    argumentHint: action === "complete" ? (command.argumentHint || "") : "",
  });

  if (action === "complete") {
    textarea.insertText(`/${command.name} `);
    return;
  }

  if (!resolvedExecution) {
    return;
  }

  addMessage("user", resolvedExecution.userMessage);
  void executeCommand(
    resolvedExecution.commandName,
    resolvedExecution.commandArgs,
    resolvedExecution.trigger,
  );
}
