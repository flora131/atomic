import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { KeyBinding, PasteEvent, TextareaRenderable } from "@opentui/core";
import type { CommandDefinition } from "@/commands/tui/index.ts";
import { loadCommandHistory } from "@/state/chat/composer/command-history.ts";
import {
  applyAutocompleteSelection,
  applyComposerHighlights,
  deriveComposerAutocompleteState,
  getComposerAutocompleteSuggestions,
} from "@/state/chat/composer/autocomplete.ts";
import type {
  ComposerAutocompleteSuggestion,
  InputScrollbarState,
  UseComposerControllerArgs,
} from "@/state/chat/composer/types.ts";

export interface UseComposerInputStateResult {
  autocompleteSuggestions: ComposerAutocompleteSuggestion[];
  handleAutocompleteIndexChange: (index: number) => void;
  handleAutocompleteSelect: (command: CommandDefinition, action: "complete" | "execute") => void;
  handleBracketedPaste: (event: PasteEvent) => void;
  handleInputChange: (rawValue: string, cursorOffset: number) => void;
  handleTextareaContentChange: () => void;
  handleTextareaCursorChange: () => void;
  historyIndexRef: MutableRefObject<number>;
  historyNavigatingRef: MutableRefObject<boolean>;
  inputScrollbar: InputScrollbarState;
  isEditingQueue: boolean;
  kittyKeyboardDetectedRef: MutableRefObject<boolean>;
  normalizePastedText: (text: string) => string;
  promptHistoryRef: MutableRefObject<string[]>;
  savedInputRef: MutableRefObject<string>;
  setIsEditingQueue: Dispatch<SetStateAction<boolean>>;
  syncInputScrollbar: () => void;
  textareaKeyBindings: KeyBinding[];
  textareaRef: MutableRefObject<TextareaRenderable | null>;
}

export function useComposerInputState({
  activeQuestion,
  addMessage,
  clipboard,
  commandStyleIdRef,
  executeCommand,
  showModelSelector,
  updateWorkflowState,
  workflowState,
}: Pick<
  UseComposerControllerArgs,
  | "activeQuestion"
  | "addMessage"
  | "clipboard"
  | "commandStyleIdRef"
  | "executeCommand"
  | "showModelSelector"
  | "updateWorkflowState"
  | "workflowState"
>): UseComposerInputStateResult {
  const [inputScrollbar, setInputScrollbar] = useState<InputScrollbarState>({
    visible: false,
    viewportHeight: 1,
    thumbTop: 0,
    thumbSize: 1,
  });
  const [isEditingQueue, setIsEditingQueue] = useState(false);

  const promptHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");
  const historyNavigatingRef = useRef(false);
  const kittyKeyboardDetectedRef = useRef(false);
  const textareaRef = useRef<TextareaRenderable>(null);

  useEffect(() => {
    void (async () => {
      const persisted = await loadCommandHistory();
      if (persisted.length > 0) {
        promptHistoryRef.current = persisted;
      }
    })();
  }, []);

  const syncInputScrollbar = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    let viewportHeight: number;
    let totalLines: number;
    try {
      viewportHeight = Math.max(1, Math.floor(textarea.editorView.getViewport().height));
      totalLines = Math.max(1, textarea.editorView.getTotalVirtualLineCount());
    } catch {
      return;
    }

    const maxScrollTop = Math.max(0, totalLines - viewportHeight);
    const scrollTop = Math.max(0, Math.floor(textarea.scrollY));
    const visible = maxScrollTop > 0;
    const thumbSize = visible
      ? Math.max(1, Math.round((viewportHeight / totalLines) * viewportHeight))
      : viewportHeight;
    const maxThumbTop = Math.max(0, viewportHeight - thumbSize);
    const thumbTop = maxScrollTop > 0
      ? Math.round((scrollTop / maxScrollTop) * maxThumbTop)
      : 0;

    setInputScrollbar((previous) => {
      if (
        previous.visible === visible &&
        previous.viewportHeight === viewportHeight &&
        previous.thumbTop === thumbTop &&
        previous.thumbSize === thumbSize
      ) {
        return previous;
      }
      return { visible, viewportHeight, thumbTop, thumbSize };
    });
  }, []);

  const handleInputChange = useCallback((rawValue: string, cursorOffset: number) => {
    if (historyNavigatingRef.current) return;
    const nextState = deriveComposerAutocompleteState(rawValue, cursorOffset, workflowState);
    if (nextState) {
      updateWorkflowState(nextState);
    }
  }, [updateWorkflowState, workflowState]);

  const handleTextareaContentChange = useCallback(() => {
    const textarea = textareaRef.current;
    const value = textarea?.plainText ?? "";
    const cursorOffset = textarea?.cursorOffset ?? value.length;
    handleInputChange(value, cursorOffset);
    syncInputScrollbar();

    if (!textarea) return;
    applyComposerHighlights(textarea, value, commandStyleIdRef.current);
  }, [commandStyleIdRef, handleInputChange, syncInputScrollbar]);

  const handleTextareaCursorChange = useCallback(() => {
    syncInputScrollbar();
  }, [syncInputScrollbar]);

  const handleAutocompleteSelect = useCallback((command: CommandDefinition, action: "complete" | "execute") => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    applyAutocompleteSelection({
      action,
      addMessage,
      command,
      executeCommand,
      textarea,
      updateWorkflowState,
      workflowState,
    });
  }, [addMessage, executeCommand, updateWorkflowState, workflowState]);

  const handleAutocompleteIndexChange = useCallback((index: number) => {
    updateWorkflowState({ selectedSuggestionIndex: index });
  }, [updateWorkflowState]);

  const textareaKeyBindings: KeyBinding[] = [
    { name: "return", action: "submit" },
    { name: "linefeed", action: "newline" },
    { name: "return", shift: true, action: "newline" },
    { name: "linefeed", shift: true, action: "newline" },
    { name: "return", meta: true, action: "newline" },
    { name: "linefeed", meta: true, action: "newline" },
  ];

  const normalizePastedText = useCallback((text: string) => {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }, []);

  const handleBracketedPaste = useCallback((event: PasteEvent) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    event.preventDefault();
    const normalized = normalizePastedText(event.text);
    const pastedContent = normalized.trim();
    if (!pastedContent) {
      const clipboardText = clipboard.readText();
      if (clipboardText) {
        textarea.insertText(normalizePastedText(clipboardText));
        handleTextareaContentChange();
      }
      return;
    }

    textarea.insertText(normalized);
    handleTextareaContentChange();
  }, [clipboard, handleTextareaContentChange, normalizePastedText]);

  const autocompleteSuggestions = useMemo(() => {
    return getComposerAutocompleteSuggestions(workflowState);
  }, [workflowState]);

  useEffect(() => {
    setTimeout(() => {
      syncInputScrollbar();
    }, 0);
  }, [syncInputScrollbar, workflowState.argumentHint]);

  useEffect(() => {
    if (activeQuestion || showModelSelector) {
      return;
    }

    const interval = setInterval(() => {
      syncInputScrollbar();
    }, 80);
    return () => clearInterval(interval);
  }, [activeQuestion, showModelSelector, syncInputScrollbar]);

  return {
    autocompleteSuggestions,
    handleAutocompleteIndexChange,
    handleAutocompleteSelect,
    handleBracketedPaste,
    handleInputChange,
    handleTextareaContentChange,
    handleTextareaCursorChange,
    historyIndexRef,
    historyNavigatingRef,
    inputScrollbar,
    isEditingQueue,
    kittyKeyboardDetectedRef,
    normalizePastedText,
    promptHistoryRef,
    savedInputRef,
    setIsEditingQueue,
    syncInputScrollbar,
    textareaKeyBindings,
    textareaRef,
  };
}
