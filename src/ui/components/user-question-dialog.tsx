/**
 * UserQuestionDialog Component for HITL Interactions
 *
 * A Claude Code-style dialog for human-in-the-loop questions using OpenTUI patterns.
 * Features numbered options with descriptions, custom input, and keyboard navigation.
 * Styled to match the autocomplete dropdown with text-color-based highlighting.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { KeyEvent, TextareaRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useTheme } from "../theme.tsx";
import { navigateUp, navigateDown } from "../utils/navigation.ts";
import { PROMPT, STATUS, CONNECTOR } from "../constants/icons.ts";

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
  responseMode: "option" | "custom_input" | "chat_about_this" | "declined";
}

export interface UserQuestionDialogProps {
  question: UserQuestion;
  onAnswer: (answer: QuestionAnswer) => void;
  visible?: boolean;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** @deprecated Use navigateUp from utils/navigation.ts directly */
export { navigateUp, navigateDown };

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
export const CHAT_ABOUT_THIS_VALUE = "__chat_about_this__";

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
  const { height: terminalHeight } = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [isChatAboutThis, setIsChatAboutThis] = useState(false);

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

  // Calculate the row offset of each option within the list content
  const optionRowOffsets = useMemo(() => {
    const offsets: number[] = [];
    let row = 0;
    for (let i = 0; i < allOptions.length; i++) {
      const option = allOptions[i]!;

      offsets.push(row);
      row += 1; // label row
      if (option.description) row += 1; // description row
    }
    return { offsets, totalRows: row };
  }, [allOptions]);

  // Reserve space for header (~4 rows) and footer (2 rows)
  const maxListHeight = Math.max(5, terminalHeight - 6);
  const listHeight = Math.min(optionRowOffsets.totalRows, maxListHeight);

  // Scroll to keep highlighted item visible
  useEffect(() => {
    if (!scrollRef.current || allOptions.length === 0 || isEditingCustom || isChatAboutThis) return;
    const scrollBox = scrollRef.current;
    const selectedRow = optionRowOffsets.offsets[highlightedIndex] ?? 0;
    const itemHeight = allOptions[highlightedIndex]?.description ? 2 : 1;

    if (selectedRow < scrollBox.scrollTop) {
      scrollBox.scrollTo(selectedRow);
    } else if (selectedRow + itemHeight > scrollBox.scrollTop + listHeight) {
      scrollBox.scrollTo(selectedRow + itemHeight - listHeight);
    }
  }, [highlightedIndex, optionRowOffsets, listHeight, isEditingCustom, isChatAboutThis, allOptions]);

  // Submit the answer
  const submitAnswer = useCallback((
    values: string[],
    responseMode: "option" | "custom_input" | "chat_about_this" = "option"
  ) => {
    onAnswer({
      selected: question.multiSelect ? values : values[0] ?? "",
      cancelled: false,
      responseMode,
    });
  }, [question.multiSelect, onAnswer]);

  // Cancel/decline
  const cancelDialog = useCallback(() => {
    onAnswer({
      selected: question.multiSelect ? [] : "",
      cancelled: true,
      responseMode: "declined",
    });
  }, [question.multiSelect, onAnswer]);

  // Handle custom text submission - read from textarea ref
  const submitCustomText = useCallback(() => {
    const text = textareaRef.current?.plainText ?? "";
    const trimmed = text.trim();
    if (trimmed || isChatAboutThis) {
      submitAnswer(
        [trimmed],
        isChatAboutThis ? "chat_about_this" : "custom_input"
      );
    }
    setIsEditingCustom(false);
    setIsChatAboutThis(false);
  }, [submitAnswer, isChatAboutThis]);

  useKeyboard(
    useCallback(
      (event: KeyEvent) => {
        if (!visible) return;

        const key = event.name ?? "";

        // If editing custom input or chatting about question, only handle escape and return
        if (isEditingCustom || isChatAboutThis) {
          if (key === "escape") {
            event.stopPropagation();
            setIsEditingCustom(false);
            setIsChatAboutThis(false);
            return;
          }
          if (key === "return") {
            event.stopPropagation();
            submitCustomText();
            return;
          }
          // Don't stop propagation - let textarea handle other keys
          return;
        }

        // Stop propagation to prevent other handlers from running
        // This ensures the dialog captures keyboard events exclusively
        event.stopPropagation();

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

          // Handle "Chat about this" - enter chat input mode
          if (option.value === CHAT_ABOUT_THIS_VALUE) {
            setIsChatAboutThis(true);
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
      [visible, isEditingCustom, isChatAboutThis, optionsCount, regularOptionsCount, highlightedIndex, selectedValues, question, allOptions, submitAnswer, cancelDialog, submitCustomText]
    )
  );

  if (!visible) {
    return null;
  }

  // Render inline within the chat flow (not as overlay) to match Claude Code behavior
  return (
    <box
      flexDirection="column"
      marginTop={1}
    >
      {/* Header badge - Claude Code style: compact inline badge */}
      <box marginBottom={1}>
        <text>
          <span style={{ fg: colors.border }}>{CONNECTOR.roundedTopLeft}{CONNECTOR.horizontal}</span>
          <span style={{ fg: colors.foreground }}> {STATUS.pending} {question.header} </span>
          <span style={{ fg: colors.border }}>{CONNECTOR.horizontal}{CONNECTOR.roundedTopRight}</span>
        </text>
      </box>

      {/* Question text - bold */}
      <text style={{ fg: colors.foreground, attributes: 1 }} wrapMode="word">
        {question.question}
      </text>

      {/* Custom input / Chat about this mode */}
      {(isEditingCustom || isChatAboutThis) ? (
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
            <text style={{ fg: colors.accent }}>{PROMPT.cursor} </text>
            <textarea
              ref={textareaRef}
              placeholder={isChatAboutThis ? "Type your thoughts..." : "Type your answer..."}
              focused={true}
              minHeight={1}
              maxHeight={5}
              flexGrow={1}
              wrapMode="word"
            />
          </box>
          <text style={{ fg: colors.muted }}>
            Enter to submit · Esc to go back
          </text>
        </box>
      ) : (
        <>
          {/* Options list - Claude Code style: clean, minimal */}
          <scrollbox
            ref={scrollRef}
            height={listHeight}
            scrollY={true}
            scrollX={false}
            marginTop={1}
          >
            {allOptions.map((option, index) => {
              const isHighlighted = index === highlightedIndex;
              const isSelected = selectedValues.includes(option.value);
              const isSpecialOption = option.value === CUSTOM_INPUT_VALUE || option.value === CHAT_ABOUT_THIS_VALUE;
              // Sequential numbering: 1, 2, 3, 4, 5, 6...
              const displayNumber = index + 1;

              // Use accent color for highlighted items (like autocomplete)
              const labelColor = isHighlighted ? colors.accent : colors.foreground;
              const descColor = isHighlighted ? colors.accent : colors.muted;

              return (
                <React.Fragment key={option.value}>
                  {/* Label line: ❯ N. Label */}
                  <text>
                    <span style={{ fg: isHighlighted ? colors.accent : colors.muted }}>
                      {isHighlighted ? `${PROMPT.cursor} ` : "  "}
                    </span>
                    <span style={{ fg: labelColor }}>
                      {displayNumber}. {question.multiSelect && !isSpecialOption ? (
                        <span style={{ fg: isSelected ? colors.success : colors.muted }}>
                          {isSelected ? `[${STATUS.success}] ` : "[ ] "}
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
          </scrollbox>
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
