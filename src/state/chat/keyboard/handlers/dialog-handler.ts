/**
 * Dialog Handler — Keyboard Logic for HITL & Model Selector Dialogs
 *
 * Contains pure functions extracted from `UserQuestionDialog` and
 * `ModelSelectorDialog` components. The dialog components import
 * these handlers and invoke them from their own `useKeyboard` hooks,
 * keeping event flow intact while centralising the keyboard LOGIC
 * in the keyboard module.
 *
 * @module
 */

import type { KeyEvent } from "@opentui/core";
import { navigateUp, navigateDown } from "@/lib/ui/navigation.ts";
import type { Model } from "@/services/models/model-transform.ts";
import type { UserQuestion } from "@/state/chat/shared/types/hitl.ts";

// ── Shared utilities ──────────────────────────────────────────────────

/**
 * Toggle a value in a multi-select list.
 */
export function toggleSelection(selected: string[], value: string): string[] {
  if (selected.includes(value)) {
    return selected.filter((v) => v !== value);
  }
  return [...selected, value];
}

/**
 * Check if a key combination is the multi-select submit shortcut.
 */
export function isMultiSelectSubmitKey(key: string, ctrl: boolean, meta: boolean): boolean {
  return (key === "return" || key === "linefeed") && (ctrl || meta);
}

// Special option values used by the UserQuestionDialog.
export const CUSTOM_INPUT_VALUE = "__custom_input__";
export const CHAT_ABOUT_THIS_VALUE = "__chat_about_this__";

// ── User Question Dialog handler ──────────────────────────────────────

export interface UserQuestionHandlerState {
  visible: boolean;
  isEditingCustom: boolean;
  isChatAboutThis: boolean;
  optionsCount: number;
  regularOptionsCount: number;
  highlightedIndex: number;
  selectedValues: string[];
  question: UserQuestion;
  allOptions: ReadonlyArray<{ label: string; value: string; description?: string }>;
}

export interface UserQuestionHandlerActions {
  setHighlightedIndex: (fn: (prev: number) => number) => void;
  setSelectedValues: (fn: (prev: string[]) => string[]) => void;
  setIsEditingCustom: (value: boolean) => void;
  setIsChatAboutThis: (value: boolean) => void;
  submitAnswer: (values: string[], responseMode?: "option" | "custom_input" | "chat_about_this") => void;
  cancelDialog: () => void;
  submitCustomText: () => void;
}

/**
 * Handle a keyboard event for the UserQuestionDialog.
 *
 * Extracted from the component so that all keyboard logic is
 * co-located in the keyboard module and can be reviewed for
 * key conflicts in one place.
 *
 * @returns `true` if the event was consumed and propagation
 *          should stop, `false` otherwise.
 */
export function handleUserQuestionKey(
  event: KeyEvent,
  state: UserQuestionHandlerState,
  actions: UserQuestionHandlerActions,
): boolean {
  if (!state.visible) return false;

  const key = event.name ?? "";

  // --- Custom input / chat-about-this editing mode ---
  if (state.isEditingCustom || state.isChatAboutThis) {
    if (key === "escape") {
      event.stopPropagation();
      actions.setIsEditingCustom(false);
      actions.setIsChatAboutThis(false);
      return true;
    }
    if (key === "return") {
      event.stopPropagation();
      actions.submitCustomText();
      return true;
    }
    // Don't stop propagation — let textarea handle other keys
    return false;
  }

  // Ctrl+C: cancel the dialog (sends a "declined" response to the SDK)
  // and let the event bubble to the parent interrupt handler.
  if (event.ctrl && key === "c") {
    actions.cancelDialog();
    return false;
  }

  // Stop propagation to prevent other handlers from running.
  // This ensures the dialog captures keyboard events exclusively.
  event.stopPropagation();

  // Multi-select submit (Ctrl/Meta+Enter)
  if (state.question.multiSelect && isMultiSelectSubmitKey(key, event.ctrl, event.meta)) {
    if (state.selectedValues.length > 0) {
      actions.submitAnswer(state.selectedValues);
    }
    return true;
  }

  // Number keys 1-9 for direct selection
  if (key >= "1" && key <= "9") {
    const index = parseInt(key) - 1;
    if (index < state.regularOptionsCount) {
      const option = state.allOptions[index];
      if (option) {
        if (state.question.multiSelect) {
          actions.setSelectedValues((prev) => toggleSelection(prev, option.value));
          actions.setHighlightedIndex(() => index);
        } else {
          actions.submitAnswer([option.value]);
        }
      }
    }
    return true;
  }

  // Up navigation (also Ctrl+P, k)
  if (key === "up" || (event.ctrl && key === "p") || key === "k") {
    actions.setHighlightedIndex((prev) => navigateUp(prev, state.optionsCount));
    return true;
  }

  // Down navigation (also Ctrl+N, j)
  if (key === "down" || (event.ctrl && key === "n") || key === "j") {
    actions.setHighlightedIndex((prev) => navigateDown(prev, state.optionsCount));
    return true;
  }

  // Space for toggle in multi-select
  if (key === "space") {
    const option = state.allOptions[state.highlightedIndex];
    if (!option) return true;

    // Don't toggle special options with space
    if (option.value === CUSTOM_INPUT_VALUE || option.value === CHAT_ABOUT_THIS_VALUE) {
      return true;
    }

    if (state.question.multiSelect) {
      actions.setSelectedValues((prev) => toggleSelection(prev, option.value));
    } else {
      actions.setSelectedValues(() => [option.value]);
    }
    return true;
  }

  // Enter to select/submit
  if (key === "return") {
    const option = state.allOptions[state.highlightedIndex];
    if (!option) return true;

    if (option.value === CUSTOM_INPUT_VALUE) {
      actions.setIsEditingCustom(true);
      return true;
    }

    if (option.value === CHAT_ABOUT_THIS_VALUE) {
      actions.setIsChatAboutThis(true);
      return true;
    }

    if (state.question.multiSelect) {
      actions.setSelectedValues((prev) => toggleSelection(prev, option.value));
    } else {
      actions.submitAnswer([option.value]);
    }
    return true;
  }

  // Escape to cancel
  if (key === "escape") {
    actions.cancelDialog();
    return true;
  }

  return true;
}

// ── Model Selector Dialog handler ─────────────────────────────────────

export interface ModelSelectorHandlerState {
  visible: boolean;
  selectedIndex: number;
  reasoningModel: Model | null;
  reasoningIndex: number;
  reasoningOptions: ReadonlyArray<{ level: string; isDefault: boolean }>;
  flatModels: readonly Model[];
}

export interface ModelSelectorHandlerActions {
  setSelectedIndex: (fn: (prev: number) => number) => void;
  setReasoningModel: (model: Model | null) => void;
  setReasoningIndex: (fn: (prev: number) => number) => void;
  onSelect: (model: Model, reasoningEffort?: string) => void;
  onCancel: () => void;
  confirmModel: (model: Model) => void;
}

/**
 * Handle a keyboard event for the ModelSelectorDialog.
 *
 * @returns `true` if the event was consumed, `false` otherwise.
 */
export function handleModelSelectorKey(
  event: KeyEvent,
  state: ModelSelectorHandlerState,
  actions: ModelSelectorHandlerActions,
): boolean {
  if (!state.visible) return false;

  event.stopPropagation();
  const key = event.name ?? "";

  // --- Reasoning level selection phase ---
  if (state.reasoningModel && state.reasoningOptions.length > 0) {
    const total = state.reasoningOptions.length;

    if (key === "up" || key === "k") {
      actions.setReasoningIndex((prev) => (prev <= 0 ? total - 1 : prev - 1));
      return true;
    }
    if (key === "down" || key === "j") {
      actions.setReasoningIndex((prev) => (prev >= total - 1 ? 0 : prev + 1));
      return true;
    }
    if (/^[1-9]$/.test(key)) {
      const num = parseInt(key, 10) - 1;
      if (num < total) {
        actions.setReasoningIndex(() => num);
        actions.onSelect(state.reasoningModel, state.reasoningOptions[num]!.level);
      }
      return true;
    }
    if (key === "return" || key === "linefeed") {
      actions.onSelect(state.reasoningModel, state.reasoningOptions[state.reasoningIndex]!.level);
      return true;
    }
    if (key === "escape") {
      actions.setReasoningModel(null);
      return true;
    }
    return false;
  }

  // --- Model selection phase ---
  const totalItems = state.flatModels.length;

  if (key === "up" || key === "k") {
    actions.setSelectedIndex((prev) => navigateUp(prev, totalItems));
    return true;
  }
  if (key === "down" || key === "j") {
    actions.setSelectedIndex((prev) => navigateDown(prev, totalItems));
    return true;
  }

  if (/^[1-9]$/.test(key)) {
    const num = parseInt(key, 10) - 1;
    if (num < totalItems) {
      actions.setSelectedIndex(() => num);
      const model = state.flatModels[num];
      if (model) {
        actions.confirmModel(model);
      }
    }
    return true;
  }

  if (key === "return" || key === "linefeed") {
    const model = state.flatModels[state.selectedIndex];
    if (model) {
      actions.confirmModel(model);
    }
    return true;
  }

  if (key === "escape") {
    actions.onCancel();
    return true;
  }

  return false;
}
