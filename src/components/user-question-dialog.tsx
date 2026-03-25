/**
 * UserQuestionDialog Component for HITL Interactions
 *
 * A Claude Code-style dialog for human-in-the-loop questions using OpenTUI patterns.
 * Features numbered options with descriptions, custom input, and keyboard navigation.
 * Styled to match the autocomplete dropdown with text-color-based highlighting.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { KeyEvent, TextareaRenderable, ScrollBoxRenderable, MouseEvent } from "@opentui/core";
import { createMarkdownSyntaxStyle, useTheme } from "@/theme/index.tsx";
import { normalizeMarkdownNewlines } from "@/lib/ui/format.ts";
import { navigateUp, navigateDown } from "@/lib/ui/navigation.ts";
import { PROMPT, STATUS, CONNECTOR } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import {
  handleUserQuestionKey,
  toggleSelection,
  isMultiSelectSubmitKey,
  CUSTOM_INPUT_VALUE,
  CHAT_ABOUT_THIS_VALUE,
} from "@/state/chat/keyboard/handlers/dialog-handler.ts";

import type { UserQuestion, QuestionAnswer } from "@/state/chat/shared/types/hitl.ts";

export interface UserQuestionDialogProps {
  question: UserQuestion;
  onAnswer: (answer: QuestionAnswer) => void;
  visible?: boolean;
}

// Re-export utilities for backward compatibility (used by tests and app.tsx barrel)
export { toggleSelection, isMultiSelectSubmitKey, CHAT_ABOUT_THIS_VALUE };

// ============================================================================
// USER QUESTION DIALOG COMPONENT
// ============================================================================

export function UserQuestionDialog({
  question,
  onAnswer,
  visible = true,
}: UserQuestionDialogProps): React.ReactNode {
  const { theme, isDark } = useTheme();
  const colors = theme.colors;
  const { height: terminalHeight } = useTerminalDimensions();

  const markdownSyntaxStyle = useMemo(
    () => createMarkdownSyntaxStyle(colors, isDark),
    [colors, isDark],
  );
  useEffect(() => () => { markdownSyntaxStyle.destroy(); }, [markdownSyntaxStyle]);

  const normalizedQuestion = useMemo(
    () => normalizeMarkdownNewlines(question.question),
    [question.question],
  );
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [isChatAboutThis, setIsChatAboutThis] = useState(false);

  const textareaRef = useRef<TextareaRenderable>(null);
  const prevHighlightedRef = useRef(highlightedIndex);

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

  // Reserve space for header (~4 rows), footer (2 rows), and outer chat app UI elements
  const maxListHeight = Math.max(5, terminalHeight - 12);
  const listHeight = Math.min(optionRowOffsets.totalRows, maxListHeight);

  // Render-time scroll correction: adjust scroll position when
  // highlightedIndex changes, using a prevRef guard to prevent
  // redundant scrollTo calls.
  if (
    scrollRef.current &&
    allOptions.length > 0 &&
    !isEditingCustom &&
    !isChatAboutThis &&
    prevHighlightedRef.current !== highlightedIndex
  ) {
    prevHighlightedRef.current = highlightedIndex;
    const scrollBox = scrollRef.current;
    const selectedRow = optionRowOffsets.offsets[highlightedIndex] ?? 0;
    const itemHeight = allOptions[highlightedIndex]?.description ? 2 : 1;

    if (selectedRow < scrollBox.scrollTop) {
      scrollBox.scrollTo(selectedRow);
    } else if (selectedRow + itemHeight > scrollBox.scrollTop + listHeight) {
      scrollBox.scrollTo(selectedRow + itemHeight - listHeight);
    }
  }
  prevHighlightedRef.current = highlightedIndex;

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

  // Translate mouse wheel scroll into selection movement so the highlight follows
  const handleMouseScroll = useCallback((event: MouseEvent) => {
    if (isEditingCustom || isChatAboutThis) return;
    const direction = event.scroll?.direction;
    if (direction === "up") {
      setHighlightedIndex((prev) => navigateUp(prev, optionsCount));
    } else if (direction === "down") {
      setHighlightedIndex((prev) => navigateDown(prev, optionsCount));
    }
    event.stopPropagation();
  }, [optionsCount, isEditingCustom, isChatAboutThis]);

  useKeyboard(
    useCallback(
      (event: KeyEvent) => {
        handleUserQuestionKey(event, {
          visible: !!question,
          isEditingCustom,
          isChatAboutThis,
          optionsCount,
          regularOptionsCount,
          highlightedIndex,
          selectedValues,
          question,
          allOptions,
        }, {
          setHighlightedIndex: (fn) => setHighlightedIndex(fn),
          setSelectedValues: (fn) => setSelectedValues(fn),
          setIsEditingCustom,
          setIsChatAboutThis,
          submitAnswer: (values, mode) => submitAnswer(values, mode),
          cancelDialog: () => cancelDialog(),
          submitCustomText: () => submitCustomText(),
        });
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
      marginTop={SPACING.SECTION}
    >
      {/* Header badge - Claude Code style: compact inline badge */}
      <box marginBottom={SPACING.SECTION}>
        <text>
          <span fg={colors.border}>{CONNECTOR.roundedTopLeft}{CONNECTOR.horizontal}</span>
          <span fg={colors.foreground}> {STATUS.pending} {question.header} </span>
          <span fg={colors.border}>{CONNECTOR.horizontal}{CONNECTOR.roundedTopRight}</span>
        </text>
      </box>

      {/* Question text - markdown rendered */}
      <markdown
        content={normalizedQuestion}
        syntaxStyle={markdownSyntaxStyle}
        conceal={true}
      />

      {/* Custom input / Chat about this mode */}
      {(isEditingCustom || isChatAboutThis) ? (
        <box flexDirection="column" marginTop={SPACING.ELEMENT}>
          <box
            border
            borderStyle="rounded"
            borderColor={colors.accent}
            paddingLeft={SPACING.CONTAINER_PAD}
            paddingRight={SPACING.CONTAINER_PAD}
            flexDirection="row"
            alignItems="center"
          >
            <text fg={colors.accent}>{PROMPT.cursor} </text>
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
          <text fg={colors.muted}>
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
            marginTop={SPACING.ELEMENT}
          >
            <box flexDirection="column" onMouseScroll={handleMouseScroll}>
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
                    <span fg={isHighlighted ? colors.accent : colors.muted}>
                      {isHighlighted ? `${PROMPT.cursor} ` : "  "}
                    </span>
                    <span fg={labelColor}>
                      {displayNumber}. {question.multiSelect && !isSpecialOption ? (
                        <span fg={isSelected ? colors.success : colors.muted}>
                          {isSelected ? `[${STATUS.success}] ` : "[ ] "}
                        </span>
                      ) : null}
                      <span fg={labelColor} attributes={isHighlighted ? 1 : undefined}>
                        {option.label}
                      </span>
                    </span>
                  </text>
                  {/* Description on next line - indented past number to avoid blending */}
                  {option.description && (
                    <text fg={descColor}>
                      {"     "}{option.description}
                    </text>
                  )}
                </React.Fragment>
              );
            })}
            </box>
          </scrollbox>
          <box marginTop={SPACING.ELEMENT}>
            <text fg={colors.muted}>
              {question.multiSelect
                ? "Enter/Space to toggle · Ctrl+Enter to submit · ↑/↓ to navigate · Esc to cancel"
                : "Enter to select · ↑/↓ to navigate · Esc to cancel"}
            </text>
          </box>
        </>
      )}
    </box>
  );
}

export default UserQuestionDialog;
