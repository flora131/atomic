/**
 * UserQuestionDialog Component for HITL Interactions
 *
 * A Claude Code-style dialog for human-in-the-loop questions using OpenTUI patterns.
 * Features numbered options with descriptions, custom input, and keyboard navigation.
 * Styled to match the autocomplete dropdown with text-color-based highlighting.
 */

import React, { useState, useCallback, useMemo, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useTheme } from "../theme.tsx";

// ============================================================================
// TYPES
// ============================================================================

export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface UserQuestion {
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionAnswer {
  selected: string | string[];
  cancelled: boolean;
}

export interface UserQuestionDialogProps {
  question: UserQuestion;
  onAnswer: (answer: QuestionAnswer) => void;
  visible?: boolean;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function navigateUp(currentIndex: number, totalItems: number): number {
  if (totalItems === 0) return 0;
  return currentIndex <= 0 ? totalItems - 1 : currentIndex - 1;
}

export function navigateDown(currentIndex: number, totalItems: number): number {
  if (totalItems === 0) return 0;
  return currentIndex >= totalItems - 1 ? 0 : currentIndex + 1;
}

export function toggleSelection(selected: string[], value: string): string[] {
  if (selected.includes(value)) {
    return selected.filter((v) => v !== value);
  }
  return [...selected, value];
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Special option values
const CUSTOM_INPUT_VALUE = "__custom_input__";
const CHAT_ABOUT_THIS_VALUE = "__chat_about_this__";

// ============================================================================
// USER QUESTION DIALOG COMPONENT
// ============================================================================

export function UserQuestionDialog({
  question,
  onAnswer,
  visible = true,
}: UserQuestionDialogProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [isEditingCustom, setIsEditingCustom] = useState(false);

  const textareaRef = useRef<TextareaRenderable>(null);

  // Build the full options list including "Type something" and "Chat about this"
  const allOptions = useMemo(() => {
    const opts = [...question.options];
    // Add "Type something" option
    opts.push({
      label: "Type something.",
      value: CUSTOM_INPUT_VALUE,
      description: undefined,
    });
    // Add "Chat about this" option (separated)
    opts.push({
      label: "Chat about this",
      value: CHAT_ABOUT_THIS_VALUE,
      description: undefined,
    });
    return opts;
  }, [question.options]);

  const optionsCount = allOptions.length;
  const regularOptionsCount = question.options.length;

  // Submit the answer
  const submitAnswer = useCallback((values: string[]) => {
    onAnswer({
      selected: question.multiSelect ? values : values[0] ?? "",
      cancelled: false,
    });
  }, [question.multiSelect, onAnswer]);

  // Cancel/decline
  const cancelDialog = useCallback(() => {
    onAnswer({
      selected: question.multiSelect ? [] : "",
      cancelled: true,
    });
  }, [question.multiSelect, onAnswer]);

  // Handle custom text submission - read from textarea ref
  const submitCustomText = useCallback(() => {
    const text = textareaRef.current?.plainText ?? "";
    if (text.trim()) {
      submitAnswer([text.trim()]);
    }
    setIsEditingCustom(false);
  }, [submitAnswer]);

  useKeyboard(
    useCallback(
      (event: KeyEvent) => {
        if (!visible) return;

        // Stop propagation to prevent other handlers from running
        // This ensures the dialog captures keyboard events exclusively
        event.stopPropagation();

        const key = event.name ?? "";

        // If editing custom input, handle differently
        if (isEditingCustom) {
          if (key === "escape") {
            setIsEditingCustom(false);
            return;
          }
          if (key === "return") {
            submitCustomText();
            return;
          }
          // Let textarea handle other keys
          return;
        }

        // Number keys 1-9 for direct selection
        if (key >= "1" && key <= "9") {
          const index = parseInt(key) - 1;
          if (index < regularOptionsCount) {
            const option = allOptions[index];
            if (option) {
              if (question.multiSelect) {
                setSelectedValues((prev) => toggleSelection(prev, option.value));
                setHighlightedIndex(index);
              } else {
                submitAnswer([option.value]);
              }
            }
          }
          return;
        }

        // Up navigation (also Ctrl+P, k)
        if (key === "up" || (event.ctrl && key === "p") || key === "k") {
          setHighlightedIndex((prev) => navigateUp(prev, optionsCount));
          return;
        }

        // Down navigation (also Ctrl+N, j)
        if (key === "down" || (event.ctrl && key === "n") || key === "j") {
          setHighlightedIndex((prev) => navigateDown(prev, optionsCount));
          return;
        }

        // Space for toggle in multi-select
        if (key === "space") {
          const option = allOptions[highlightedIndex];
          if (!option) return;

          // Don't toggle special options with space
          if (option.value === CUSTOM_INPUT_VALUE || option.value === CHAT_ABOUT_THIS_VALUE) {
            return;
          }

          if (question.multiSelect) {
            setSelectedValues((prev) => toggleSelection(prev, option.value));
          } else {
            setSelectedValues([option.value]);
          }
          return;
        }

        // Enter to select/submit
        if (key === "return") {
          const option = allOptions[highlightedIndex];
          if (!option) return;

          // Handle "Type something" option
          if (option.value === CUSTOM_INPUT_VALUE) {
            setIsEditingCustom(true);
            return;
          }

          // Handle "Chat about this" - treat as a special selection
          if (option.value === CHAT_ABOUT_THIS_VALUE) {
            submitAnswer([CHAT_ABOUT_THIS_VALUE]);
            return;
          }

          if (question.multiSelect) {
            // In multi-select, enter on a regular option toggles it
            setSelectedValues((prev) => toggleSelection(prev, option.value));
          } else {
            // In single-select, enter submits the highlighted option
            submitAnswer([option.value]);
          }
          return;
        }

        // Escape to cancel
        if (key === "escape") {
          cancelDialog();
          return;
        }
      },
      [visible, isEditingCustom, optionsCount, regularOptionsCount, highlightedIndex, selectedValues, question, allOptions, submitAnswer, cancelDialog, submitCustomText]
    )
  );

  if (!visible) {
    return null;
  }

  // Index where "Chat about this" starts (after separator)
  const chatAboutThisIndex = optionsCount - 1;

  // Render inline within the chat flow (not as overlay) to match Claude Code behavior
  return (
    <box
      flexDirection="column"
      marginTop={1}
    >
      {/* Header badge - Claude Code style: compact inline badge */}
      <box marginBottom={1}>
        <text>
          <span style={{ fg: colors.border }}>╭─</span>
          <span style={{ fg: colors.foreground }}> □ {question.header} </span>
          <span style={{ fg: colors.border }}>─╮</span>
        </text>
      </box>

      {/* Question text - bold */}
      <text style={{ fg: colors.foreground, attributes: 1 }} wrapMode="word">
        {question.question}
      </text>

      {/* Custom input mode */}
      {isEditingCustom ? (
        <box flexDirection="column" marginTop={1}>
          <box
            border
            borderStyle="rounded"
            borderColor={colors.accent}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="row"
            alignItems="center"
          >
            <text style={{ fg: colors.accent }}>❯ </text>
            <textarea
              ref={textareaRef}
              placeholder="Type your answer..."
              focused={true}
              height={1}
              flexGrow={1}
            />
          </box>
          <text style={{ fg: colors.muted }}>
            Enter to submit · Esc to cancel
          </text>
        </box>
      ) : (
        <>
          {/* Options list - Claude Code style: clean, minimal */}
          <box flexDirection="column" marginTop={1}>
            {allOptions.map((option, index) => {
              const isHighlighted = index === highlightedIndex;
              const isSelected = selectedValues.includes(option.value);
              const isSpecialOption = option.value === CUSTOM_INPUT_VALUE || option.value === CHAT_ABOUT_THIS_VALUE;
              // Sequential numbering: 1, 2, 3, 4, 5, 6...
              const displayNumber = index + 1;

              // Add separator before "Chat about this" (last option)
              const showSeparator = index === chatAboutThisIndex;

              // Use accent color for highlighted items (like autocomplete)
              const labelColor = isHighlighted ? colors.accent : colors.foreground;
              const descColor = isHighlighted ? colors.accent : colors.muted;

              // Check if previous option had a description (need spacing)
              const prevOption = index > 0 ? allOptions[index - 1] : null;
              const needsSpacingAfterDescription = prevOption?.description && !showSeparator;

              return (
                <React.Fragment key={option.value}>
                  {showSeparator && (
                    <box marginTop={1} marginBottom={0}>
                      <text style={{ fg: colors.muted }}>{" "}</text>
                    </box>
                  )}
                  {/* Add newline spacing after previous option's description */}
                  {needsSpacingAfterDescription && (
                    <box height={1} />
                  )}
                  {/* Label line: ❯ N. Label */}
                  <text>
                    <span style={{ fg: isHighlighted ? colors.accent : colors.muted }}>
                      {isHighlighted ? "❯ " : "  "}
                    </span>
                    <span style={{ fg: labelColor }}>
                      {displayNumber}. {question.multiSelect && !isSpecialOption ? (
                        <span style={{ fg: isSelected ? colors.success : colors.muted }}>
                          {isSelected ? "[✓] " : "[ ] "}
                        </span>
                      ) : null}
                      <span style={{ fg: labelColor, attributes: isHighlighted ? 1 : undefined }}>
                        {option.label}
                      </span>
                    </span>
                  </text>
                  {/* Description on next line - indented past number to avoid blending */}
                  {option.description && (
                    <text style={{ fg: descColor }}>
                      {"     "}{option.description}
                    </text>
                  )}
                </React.Fragment>
              );
            })}
          </box>

          {/* Keyboard hints */}
          <box marginTop={1}>
            <text style={{ fg: colors.muted }}>
              Enter to select · ↑/↓ to navigate · Esc to cancel
            </text>
          </box>
        </>
      )}
    </box>
  );
}

export default UserQuestionDialog;
