import type { RefObject } from "react";
import type { KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { navigateDown, navigateUp } from "@/lib/ui/navigation.ts";
import { globalRegistry } from "@/commands/tui/index.ts";
import type { UseMessageQueueReturn } from "@/hooks/use-message-queue.ts";
import type { CommandExecutionTrigger, WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import {
  shouldApplyBackslashLineContinuation,
  shouldInsertNewlineFallbackFromKeyEvent,
} from "@/state/chat/shared/helpers/newline-strategies.ts";
import { resolveSlashAutocompleteExecution } from "@/state/chat/shared/helpers/index.ts";
import type { ChatAutocompleteSuggestion } from "@/state/chat/keyboard/types.ts";

function replaceTextareaValue(textarea: TextareaRenderable, value: string) {
  textarea.gotoBufferHome();
  textarea.gotoBufferEnd({ select: true });
  textarea.deleteChar();
  if (value) {
    textarea.insertText(value);
  }
}

interface HandleNavigationKeyArgs {
  autocompleteSuggestions: ChatAutocompleteSuggestion[];
  event: KeyEvent;
  historyIndexRef: RefObject<number>;
  historyNavigatingRef: RefObject<boolean>;
  isEditingQueue: boolean;
  isStreaming: boolean;
  messageQueue: UseMessageQueueReturn;
  promptHistoryRef: RefObject<string[]>;
  savedInputRef: RefObject<string>;
  scrollboxRef: RefObject<ScrollBoxRenderable | null>;
  setIsEditingQueue: (value: boolean) => void;
  textareaRef: RefObject<TextareaRenderable | null>;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  workflowState: WorkflowChatState;
}

export function handleNavigationKey({
  autocompleteSuggestions,
  event,
  historyIndexRef,
  historyNavigatingRef,
  isEditingQueue,
  isStreaming,
  messageQueue,
  promptHistoryRef,
  savedInputRef,
  scrollboxRef,
  setIsEditingQueue,
  textareaRef,
  updateWorkflowState,
  workflowState,
}: HandleNavigationKeyArgs): boolean {
  if (event.name === "pageup") {
    if (scrollboxRef.current) {
      scrollboxRef.current.scrollBy(-scrollboxRef.current.height / 2);
    }
    return true;
  }

  if (event.name === "pagedown") {
    if (scrollboxRef.current) {
      scrollboxRef.current.scrollBy(scrollboxRef.current.height / 2);
    }
    return true;
  }

  if (event.name === "up" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
    const newIndex = navigateUp(workflowState.selectedSuggestionIndex, autocompleteSuggestions.length);
    updateWorkflowState({ selectedSuggestionIndex: newIndex });
    return true;
  }

  if (event.name === "up" && messageQueue.count > 0 && !isStreaming) {
    const textarea = textareaRef.current;
    if (messageQueue.currentEditIndex === -1) {
      const lastIndex = messageQueue.count - 1;
      const queuedMessage = messageQueue.queue[lastIndex];
      if (queuedMessage && textarea) {
        replaceTextareaValue(textarea, queuedMessage.content);
      }
      messageQueue.setEditIndex(lastIndex);
      setIsEditingQueue(true);
    } else if (messageQueue.currentEditIndex > 0) {
      if (textarea) {
        messageQueue.updateAt(messageQueue.currentEditIndex, textarea.plainText ?? "");
      }
      const previousIndex = messageQueue.currentEditIndex - 1;
      const previousMessage = messageQueue.queue[previousIndex];
      if (previousMessage && textarea) {
        replaceTextareaValue(textarea, previousMessage.content);
      }
      messageQueue.setEditIndex(previousIndex);
    }
    return true;
  }

  if (event.name === "down" && isEditingQueue && messageQueue.count > 0) {
    const textarea = textareaRef.current;
    if (messageQueue.currentEditIndex < messageQueue.count - 1) {
      if (textarea) {
        messageQueue.updateAt(messageQueue.currentEditIndex, textarea.plainText ?? "");
      }
      const nextIndex = messageQueue.currentEditIndex + 1;
      const nextMessage = messageQueue.queue[nextIndex];
      if (nextMessage && textarea) {
        replaceTextareaValue(textarea, nextMessage.content);
      }
      messageQueue.setEditIndex(nextIndex);
    } else {
      if (textarea) {
        messageQueue.updateAt(messageQueue.currentEditIndex, textarea.plainText ?? "");
        replaceTextareaValue(textarea, "");
      }
      setIsEditingQueue(false);
      messageQueue.setEditIndex(-1);
    }
    return true;
  }

  if (event.name === "down" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
    const newIndex = navigateDown(workflowState.selectedSuggestionIndex, autocompleteSuggestions.length);
    updateWorkflowState({ selectedSuggestionIndex: newIndex });
    return true;
  }

  if (
    event.name === "up"
    && !workflowState.showAutocomplete
    && !isEditingQueue
    && (isStreaming || messageQueue.count === 0)
  ) {
    const textarea = textareaRef.current;
    if (textarea) {
      const cursorOffset = textarea.cursorOffset;
      if (cursorOffset === 0) {
        if (promptHistoryRef.current.length > 0) {
          const historyIndex = historyIndexRef.current;
          const history = promptHistoryRef.current;
          historyNavigatingRef.current = true;
          if (historyIndex === -1) {
            savedInputRef.current = textarea.plainText ?? "";
            const newIndex = history.length - 1;
            historyIndexRef.current = newIndex;
            replaceTextareaValue(textarea, history[newIndex]!);
            textarea.gotoBufferHome();
          } else if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            historyIndexRef.current = newIndex;
            replaceTextareaValue(textarea, history[newIndex]!);
            textarea.gotoBufferHome();
          }
          historyNavigatingRef.current = false;
          event.stopPropagation();
          return true;
        }
      } else {
        const absoluteVisualRow = Math.floor(textarea.scrollY) + textarea.visualCursor.visualRow;
        if (absoluteVisualRow === 0) {
          textarea.gotoBufferHome();
          event.stopPropagation();
          return true;
        }
      }
    }
  }

  if (
    event.name === "down"
    && !workflowState.showAutocomplete
    && !isEditingQueue
    && (isStreaming || messageQueue.count === 0)
  ) {
    const textarea = textareaRef.current;
    if (textarea) {
      const cursorOffset = textarea.cursorOffset;
      const textLength = (textarea.plainText ?? "").length;
      if (cursorOffset === textLength) {
        if (historyIndexRef.current >= 0) {
          const historyIndex = historyIndexRef.current;
          const history = promptHistoryRef.current;
          historyNavigatingRef.current = true;
          if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            historyIndexRef.current = newIndex;
            replaceTextareaValue(textarea, history[newIndex]!);
          } else {
            historyIndexRef.current = -1;
            replaceTextareaValue(textarea, savedInputRef.current);
          }
          historyNavigatingRef.current = false;
          event.stopPropagation();
          return true;
        }
      } else {
        const absoluteVisualRow = Math.floor(textarea.scrollY) + textarea.visualCursor.visualRow;
        const totalVirtualLines = textarea.editorView.getTotalVirtualLineCount();
        if (absoluteVisualRow >= totalVirtualLines - 1) {
          textarea.gotoBufferEnd();
          event.stopPropagation();
          return true;
        }
      }
    }
  }

  if (
    (event.name === "up" || event.name === "down")
    && !workflowState.showAutocomplete
    && !isEditingQueue
    && !isStreaming
    && messageQueue.count === 0
  ) {
    const inputValue = textareaRef.current?.plainText ?? "";
    if (inputValue.trim() === "" && scrollboxRef.current) {
      scrollboxRef.current.scrollBy(event.name === "up" ? -1 : 1);
      return true;
    }
  }

  return false;
}

interface HandleComposeShortcutKeyArgs {
  event: KeyEvent;
  textareaRef: RefObject<TextareaRenderable | null>;
}

export function handleComposeShortcutKey({
  event,
  textareaRef,
}: HandleComposeShortcutKeyArgs): boolean {
  if (shouldInsertNewlineFallbackFromKeyEvent(event)) {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.insertText("\n");
    }
    event.stopPropagation();
    return true;
  }

  return false;
}

interface HandleAutocompleteSelectionKeyArgs {
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  autocompleteSuggestions: ChatAutocompleteSuggestion[];
  event: KeyEvent;
  executeCommand: (commandName: string, args: string, trigger?: CommandExecutionTrigger) => Promise<boolean>;
  kittyKeyboardDetected: boolean;
  textareaRef: RefObject<TextareaRenderable | null>;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  workflowState: WorkflowChatState;
}

export function handleAutocompleteSelectionKey({
  addMessage,
  autocompleteSuggestions,
  event,
  executeCommand,
  kittyKeyboardDetected,
  textareaRef,
  updateWorkflowState,
  workflowState,
}: HandleAutocompleteSelectionKeyArgs): boolean {
  if (event.name === "tab" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
    const selectedCommand = autocompleteSuggestions[workflowState.selectedSuggestionIndex];
    const textarea = textareaRef.current;
    if (selectedCommand && textarea) {
      const isMentionMode = workflowState.autocompleteMode === "mention";
      const isDirectoryMention = isMentionMode && selectedCommand.name.endsWith("/");
      const suffix = isDirectoryMention ? "" : " ";

      if (isMentionMode) {
        const fullText = textarea.plainText ?? "";
        const mentionStart = workflowState.mentionStartOffset;
        const mentionEnd = mentionStart + 1 + workflowState.autocompleteInput.length;
        const before = fullText.slice(0, mentionStart);
        const after = fullText.slice(mentionEnd);
        const replacement = `${selectedCommand.name}${suffix}`;
        const nextText = before + replacement + after;
        const nextCursor = mentionStart + replacement.length;

        replaceTextareaValue(textarea, nextText);
        textarea.cursorOffset = nextCursor;
      } else {
        const fullText = textarea.plainText ?? "";
        const commandTokenEnd = 1 + workflowState.autocompleteInput.length;
        const after = fullText.slice(commandTokenEnd);
        const replacement = `/${selectedCommand.name}${suffix}`;
        replaceTextareaValue(textarea, `${replacement}${after}`);
        textarea.cursorOffset = replacement.length;
      }

      if (isDirectoryMention) {
        updateWorkflowState({
          showAutocomplete: true,
          autocompleteInput: selectedCommand.name,
          selectedSuggestionIndex: 0,
          autocompleteMode: "mention",
          mentionStartOffset: workflowState.mentionStartOffset,
          argumentHint: "",
        });
      } else {
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          selectedSuggestionIndex: 0,
          autocompleteMode: "command",
          argumentHint: workflowState.autocompleteMode === "command"
            ? (selectedCommand.argumentHint || "")
            : "",
        });
      }
    }
    return true;
  }

  if (
    event.name === "return"
    && !event.shift
    && !event.meta
    && workflowState.showAutocomplete
    && autocompleteSuggestions.length > 0
    && !shouldApplyBackslashLineContinuation(textareaRef.current?.plainText ?? "", kittyKeyboardDetected)
  ) {
    const selectedCommand = autocompleteSuggestions[workflowState.selectedSuggestionIndex];
    const textarea = textareaRef.current;
    if (selectedCommand && textarea) {
      const isMentionMode = workflowState.autocompleteMode === "mention";
      const isDirectoryMention = isMentionMode && selectedCommand.name.endsWith("/");

      if (isMentionMode) {
        const fullText = textarea.plainText ?? "";
        const mentionStart = workflowState.mentionStartOffset;
        const mentionEnd = mentionStart + 1 + workflowState.autocompleteInput.length;
        const before = fullText.slice(0, mentionStart);
        const after = fullText.slice(mentionEnd);

        if (isDirectoryMention) {
          const nextText = `${before}${selectedCommand.name}${after}`;
          replaceTextareaValue(textarea, nextText);
          textarea.cursorOffset = mentionStart + selectedCommand.name.length;
          updateWorkflowState({
            showAutocomplete: true,
            autocompleteInput: selectedCommand.name,
            selectedSuggestionIndex: 0,
            autocompleteMode: "mention",
            mentionStartOffset: mentionStart,
            argumentHint: "",
          });
        } else {
          const replacement = `${selectedCommand.name} `;
          const nextText = before + replacement + after;
          replaceTextareaValue(textarea, nextText);
          textarea.cursorOffset = mentionStart + replacement.length;
          updateWorkflowState({
            showAutocomplete: false,
            autocompleteInput: "",
            selectedSuggestionIndex: 0,
            autocompleteMode: "command",
          });
        }
      } else {
        const resolvedExecution = resolveSlashAutocompleteExecution({
          rawInput: textarea.plainText ?? "",
          selectedCommandName: selectedCommand.name,
          getCommandByName: (name) => globalRegistry.get(name),
        });
        replaceTextareaValue(textarea, "");
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          selectedSuggestionIndex: 0,
          autocompleteMode: "command",
        });
        addMessage("user", resolvedExecution.userMessage);
        void executeCommand(
          resolvedExecution.commandName,
          resolvedExecution.commandArgs,
          resolvedExecution.trigger,
        );
      }
    }
    event.stopPropagation();
    return true;
  }

  return false;
}
