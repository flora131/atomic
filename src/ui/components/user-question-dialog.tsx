/**
 * UserQuestionDialog Component for HITL Interactions
 *
 * Displays a dialog overlay for human-in-the-loop questions.
 * Supports single and multi-select options with keyboard navigation.
 *
 * Reference: Feature 11 - Create UserQuestionDialog component for HITL interactions
 */

import React, { useState, useCallback, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";
import { useTheme } from "../theme.tsx";

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single option in the question dialog.
 */
export interface QuestionOption {
  /** Display text for this option */
  label: string;
  /** Value returned when this option is selected */
  value: string;
  /** Optional description for additional context */
  description?: string;
}

/**
 * A question object representing a HITL prompt.
 */
export interface UserQuestion {
  /** The question header/title */
  header: string;
  /** The full question text */
  question: string;
  /** Available options to choose from */
  options: QuestionOption[];
  /** Whether multiple options can be selected */
  multiSelect?: boolean;
}

/**
 * Result of answering a question.
 */
export interface QuestionAnswer {
  /** Selected option value(s) */
  selected: string | string[];
  /** Whether the answer was cancelled */
  cancelled: boolean;
}

/**
 * Props for the UserQuestionDialog component.
 */
export interface UserQuestionDialogProps {
  /** The question to display */
  question: UserQuestion;
  /** Callback when user answers or cancels */
  onAnswer: (answer: QuestionAnswer) => void;
  /** Whether the dialog is visible */
  visible?: boolean;
}

/**
 * Props for an individual option row.
 */
interface OptionRowProps {
  /** The option to display */
  option: QuestionOption;
  /** Whether this option is selected (for multi-select) */
  isChecked: boolean;
  /** Whether this option is highlighted (has focus) */
  isHighlighted: boolean;
  /** Whether multi-select mode is enabled */
  multiSelect: boolean;
  /** Theme colors */
  accentColor: string;
  foregroundColor: string;
  mutedColor: string;
}

// ============================================================================
// OPTION ROW COMPONENT
// ============================================================================

/**
 * Renders a single option row with checkbox/radio indicator.
 */
function OptionRow({
  option,
  isChecked,
  isHighlighted,
  multiSelect,
  accentColor,
  foregroundColor,
  mutedColor,
}: OptionRowProps): React.ReactNode {
  // Determine visual state
  const bgColor = isHighlighted ? accentColor : undefined;
  const fgColor = isHighlighted ? "#000000" : foregroundColor;
  const descColor = isHighlighted ? "#333333" : mutedColor;

  // Checkbox indicator: [x] for checked, [ ] for unchecked
  // Radio indicator: (●) for selected, ( ) for unselected
  const indicator = multiSelect
    ? isChecked
      ? "[x]"
      : "[ ]"
    : isChecked
      ? "(●)"
      : "( )";

  return (
    <box
      flexDirection="row"
      width="100%"
      style={{ bg: bgColor }}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Selection indicator */}
      <box width={4}>
        <text style={{ fg: fgColor }}>{indicator}</text>
      </box>
      {/* Option label and description */}
      <box flexDirection="column" flexGrow={1}>
        <text style={{ fg: fgColor, bold: isHighlighted }}>{option.label}</text>
        {option.description && (
          <text style={{ fg: descColor, attributes: 2 }}>
            {option.description}
          </text>
        )}
      </box>
    </box>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Navigate selection up with wrap.
 */
export function navigateUp(currentIndex: number, totalItems: number): number {
  if (totalItems === 0) return 0;
  return currentIndex <= 0 ? totalItems - 1 : currentIndex - 1;
}

/**
 * Navigate selection down with wrap.
 */
export function navigateDown(currentIndex: number, totalItems: number): number {
  if (totalItems === 0) return 0;
  return currentIndex >= totalItems - 1 ? 0 : currentIndex + 1;
}

/**
 * Toggle a value in an array (add if not present, remove if present).
 */
export function toggleSelection(
  selected: string[],
  value: string
): string[] {
  if (selected.includes(value)) {
    return selected.filter((v) => v !== value);
  } else {
    return [...selected, value];
  }
}

// ============================================================================
// USER QUESTION DIALOG COMPONENT
// ============================================================================

/**
 * Dialog overlay for human-in-the-loop questions.
 *
 * Displays a question with options that can be navigated with keyboard.
 * Supports both single-select and multi-select modes.
 *
 * Keyboard controls:
 * - Up/Down: Navigate options
 * - Space: Toggle selection (multi-select) or select (single-select)
 * - Enter: Confirm selection
 * - Escape: Cancel and close dialog
 *
 * @example
 * ```tsx
 * <UserQuestionDialog
 *   question={{
 *     header: "Choose Theme",
 *     question: "Which theme would you like to use?",
 *     options: [
 *       { label: "Dark", value: "dark" },
 *       { label: "Light", value: "light" },
 *     ],
 *   }}
 *   onAnswer={(answer) => {
 *     if (!answer.cancelled) {
 *       setTheme(answer.selected as string);
 *     }
 *   }}
 *   visible={showDialog}
 * />
 * ```
 */
export function UserQuestionDialog({
  question,
  onAnswer,
  visible = true,
}: UserQuestionDialogProps): React.ReactNode {
  const { theme } = useTheme();

  // Current highlighted option index
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Selected values (for multi-select, can be multiple; for single-select, array of one)
  const [selectedValues, setSelectedValues] = useState<string[]>([]);

  // Memoize options count
  const optionsCount = useMemo(() => question.options.length, [question.options]);

  /**
   * Handle keyboard events for navigation and selection.
   */
  useKeyboard(
    useCallback(
      (event: KeyEvent) => {
        if (!visible) return;

        const key = event.key ?? event.name;

        // Up arrow - navigate up
        if (key === "up") {
          setHighlightedIndex((prev) => navigateUp(prev, optionsCount));
          return;
        }

        // Down arrow - navigate down
        if (key === "down") {
          setHighlightedIndex((prev) => navigateDown(prev, optionsCount));
          return;
        }

        // Space - toggle selection
        if (key === "space" || event.name === "space") {
          const option = question.options[highlightedIndex];
          if (!option) return;

          if (question.multiSelect) {
            // Toggle selection in multi-select mode
            setSelectedValues((prev) => toggleSelection(prev, option.value));
          } else {
            // Single select - replace selection
            setSelectedValues([option.value]);
          }
          return;
        }

        // Enter - confirm selection
        if (key === "return" || event.name === "return") {
          // If nothing selected in single-select, use highlighted option
          let result = selectedValues;
          if (!question.multiSelect && result.length === 0) {
            const option = question.options[highlightedIndex];
            if (option) {
              result = [option.value];
            }
          }

          onAnswer({
            selected: question.multiSelect ? result : result[0] ?? "",
            cancelled: false,
          });
          return;
        }

        // Escape - cancel
        if (key === "escape" || event.name === "escape") {
          onAnswer({
            selected: question.multiSelect ? [] : "",
            cancelled: true,
          });
          return;
        }
      },
      [visible, optionsCount, highlightedIndex, selectedValues, question, onAnswer]
    )
  );

  // Don't render if not visible
  if (!visible) {
    return null;
  }

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      alignItems="center"
      justifyContent="center"
    >
      {/* Dialog box */}
      <box
        flexDirection="column"
        borderStyle="double"
        borderColor={theme.colors.accent}
        style={{ bg: theme.colors.background }}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        minWidth={40}
        maxWidth={60}
      >
        {/* Header */}
        <text style={{ fg: theme.colors.accent, bold: true }}>
          {question.header}
        </text>

        {/* Question text */}
        <text
          style={{ fg: theme.colors.foreground }}
          marginTop={1}
          marginBottom={1}
          wrapMode="word"
        >
          {question.question}
        </text>

        {/* Options list */}
        <box flexDirection="column" marginTop={1}>
          {question.options.map((option, index) => (
            <OptionRow
              key={option.value}
              option={option}
              isChecked={selectedValues.includes(option.value)}
              isHighlighted={index === highlightedIndex}
              multiSelect={question.multiSelect ?? false}
              accentColor={theme.colors.accent}
              foregroundColor={theme.colors.foreground}
              mutedColor={theme.colors.muted}
            />
          ))}
        </box>

        {/* Instructions */}
        <text
          style={{ fg: theme.colors.muted, attributes: 2 }}
          marginTop={1}
        >
          {question.multiSelect
            ? "↑/↓ navigate • Space toggle • Enter confirm • Esc cancel"
            : "↑/↓ navigate • Enter select • Esc cancel"}
        </text>
      </box>
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default UserQuestionDialog;
