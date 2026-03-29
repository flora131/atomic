/**
 * Sub-interfaces for ChatShellProps.
 *
 * Each interface groups related props by concern so that consumers
 * can depend only on the slice they need.
 */

import type React from "react";
import type {
  KeyBinding,
  MacOSScrollAccel,
  PasteEvent,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextareaRenderable,
} from "@opentui/core";
import type { Model } from "@/services/models/model-transform.ts";
import type { QuestionAnswer, UserQuestion } from "@/state/chat/shared/types/hitl.ts";
import type { ThemeColors } from "@/theme/index.tsx";
import type { ChatMessage, StreamingMeta, WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import type { UseMessageQueueReturn } from "@/hooks/use-message-queue.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ComposerAutocompleteSuggestion } from "@/state/chat/shared/types/composer.ts";
import type { InputScrollbarState } from "@/state/chat/composer/types.ts";

// ── Layout / chrome ───────────────────────────────────────────────────

/** Chrome, header, model display, and general session state. */
export interface ShellLayoutProps {
  availableModels: Model[];
  compactionSummary: string | null;
  currentModelId?: string;
  currentReasoningEffort?: string;
  displayModel: string;
  historyBufferMessages: readonly ChatMessage[];
  initialModelId?: string;
  isStreaming: boolean;
  messageContent: React.ReactNode;
  messageCount: number;
  messages: readonly ChatMessage[];
  model: string;
  parallelAgents: readonly ParallelAgent[];
  showCompactionHistory: boolean;
  showModelSelector: boolean;
  streamingMeta: StreamingMeta | null;
  themeColors: ThemeColors;
  tier: string;
  transcriptMode: boolean;
  version: string;
  workingDir: string;
  workflowState: WorkflowChatState;
  handleModelSelect: (selectedModel: Model, reasoningEffort?: string) => void;
  handleModelSelectorCancel: () => void;
  handleMouseUp: () => void;
}

// ── Input / composer ──────────────────────────────────────────────────

/** Textarea, composer, autocomplete, and input-related props. */
export interface ShellInputProps {
  ctrlCPressed: boolean;
  dynamicPlaceholder: string;
  handleAutocompleteIndexChange: (index: number) => void;
  handleAutocompleteSelect: (
    command: ComposerAutocompleteSuggestion,
    action: "complete" | "execute",
  ) => void;
  handleBracketedPaste: (event: PasteEvent) => void;
  handleSubmit: () => void;
  handleTextareaContentChange: () => void;
  handleTextareaCursorChange: () => void;
  inputSyntaxStyle: SyntaxStyle;
  inputFocused: boolean;
  inputScrollbar: InputScrollbarState;
  isEditingQueue: boolean;
  messageQueue: UseMessageQueueReturn;
  setIsEditingQueue: React.Dispatch<React.SetStateAction<boolean>>;
  showAutocomplete: boolean;
  textareaKeyBindings: KeyBinding[];
  textareaRef: React.RefObject<TextareaRenderable | null>;
  autocompleteInput: string;
  autocompleteMode: "command" | "mention";
  autocompleteSelectedIndex: number;
  autocompleteSuggestions: ComposerAutocompleteSuggestion[];
  argumentHint: string;
}

// ── HITL dialog ───────────────────────────────────────────────────────

/** Question dialog / human-in-the-loop interaction props. */
export interface ShellDialogProps {
  activeQuestion: UserQuestion | null;
  handleQuestionAnswer?: (answer: QuestionAnswer) => void;
}

// ── Scroll behaviour ──────────────────────────────────────────────────

/** Scrollbox and scroll-acceleration props. */
export interface ShellScrollProps {
  scrollAcceleration: MacOSScrollAccel;
  scrollboxRef: React.RefObject<ScrollBoxRenderable | null>;
}
