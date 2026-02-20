/**
 * UserQuestionInline Component
 *
 * Renders HITL (Human-in-the-Loop) permission questions inline after
 * their associated ToolPart, rather than as a fixed-position overlay.
 *
 * This is the key architectural change from the parts-based rendering spec.
 * Inspired by OpenCode's QuestionPrompt at message-part.tsx:547-665.
 *
 * Features model-generated options with descriptions, plus "Type something"
 * and "Chat about this" options — matching the UserQuestionDialog style
 * used by OpenCode and Claude.
 */

import React, { useState, useCallback, useMemo, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useThemeColors } from "../../theme.tsx";
import { STATUS, PROMPT, CONNECTOR } from "../../constants/icons.ts";
import { SPACING } from "../../constants/spacing.ts";
import { navigateUp, navigateDown } from "../../utils/navigation.ts";
import type { PermissionOption } from "../../../sdk/types.ts";

// Special option values — same as UserQuestionDialog
const CUSTOM_INPUT_VALUE = "__custom_input__";
const CHAT_ABOUT_THIS_VALUE = "__chat_about_this__";

export interface PendingQuestion {
  requestId: string;
  header: string;
  question: string;
  options: PermissionOption[];
  multiSelect: boolean;
  respond: (answer: string | string[]) => void;
}

export interface UserQuestionInlineProps {
  question: PendingQuestion;
  onAnswer: (answer: string | string[]) => void;
}

export function UserQuestionInline({ question, onAnswer }: UserQuestionInlineProps): React.ReactNode {
  const colors = useThemeColors();
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [isChatAboutThis, setIsChatAboutThis] = useState(false);
  const textareaRef = useRef<TextareaRenderable>(null);

  // Build the full options list including "Type something" and "Chat about this"
  const allOptions = useMemo(() => {
    const opts: Array<{ label: string; value: string; description?: string }> = [
      ...question.options,
      { label: "Type something.", value: CUSTOM_INPUT_VALUE, description: undefined },
      { label: "Chat about this", value: CHAT_ABOUT_THIS_VALUE, description: undefined },
    ];
    return opts;
  }, [question.options]);

  const optionsCount = allOptions.length;
  const regularOptionsCount = question.options.length;

  const submitCustomText = useCallback(() => {
    const text = textareaRef.current?.plainText ?? "";
    const trimmed = text.trim();
    if (trimmed || isChatAboutThis) {
      onAnswer(trimmed);
    }
    setIsEditingCustom(false);
    setIsChatAboutThis(false);
  }, [onAnswer, isChatAboutThis]);

  useKeyboard(
    useCallback((event: KeyEvent) => {
      const key = event.name ?? "";

      // In custom input / chat mode, only handle escape and return
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
        return;
      }

      event.stopPropagation();

      // Number keys 1-9 for direct selection of model-generated options
      if (key >= "1" && key <= "9") {
        const index = parseInt(key) - 1;
        if (index < regularOptionsCount) {
          const option = allOptions[index];
          if (option) {
            onAnswer(option.value);
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

      // Enter to select
      if (key === "return") {
        const option = allOptions[highlightedIndex];
        if (!option) return;

        if (option.value === CUSTOM_INPUT_VALUE) {
          setIsEditingCustom(true);
          return;
        }
        if (option.value === CHAT_ABOUT_THIS_VALUE) {
          setIsChatAboutThis(true);
          return;
        }
        onAnswer(option.value);
        return;
      }

      // Escape to cancel/decline
      if (key === "escape") {
        onAnswer("deny");
        return;
      }
    }, [isEditingCustom, isChatAboutThis, optionsCount, regularOptionsCount, highlightedIndex, allOptions, onAnswer, submitCustomText])
  );

  return (
    <box flexDirection="column" marginTop={SPACING.SECTION}>
      {/* Header badge — matches UserQuestionDialog style */}
      {question.header && (
        <box marginBottom={SPACING.SECTION}>
          <text>
            <span style={{ fg: colors.border }}>{CONNECTOR.roundedTopLeft}{CONNECTOR.horizontal}</span>
            <span style={{ fg: colors.foreground }}> {STATUS.pending} {question.header} </span>
            <span style={{ fg: colors.border }}>{CONNECTOR.horizontal}{CONNECTOR.roundedTopRight}</span>
          </text>
        </box>
      )}

      {/* Question text — bold for visibility */}
      <text style={{ fg: colors.foreground, attributes: 1 }} wrapMode="word">
        {question.question}
      </text>

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
          {/* Options list — model options + "Type something" + "Chat about this" */}
          <box flexDirection="column" marginTop={SPACING.ELEMENT}>
            {allOptions.map((opt, idx) => {
              const isHighlighted = idx === highlightedIndex;
              const labelColor = isHighlighted ? colors.accent : colors.foreground;
              const descColor = isHighlighted ? colors.accent : colors.muted;
              const displayNumber = idx + 1;

              return (
                <React.Fragment key={opt.value}>
                  <text>
                    <span style={{ fg: isHighlighted ? colors.accent : colors.muted }}>
                      {isHighlighted ? `${PROMPT.cursor} ` : "  "}
                    </span>
                    <span style={{ fg: labelColor }}>
                      {displayNumber}.{" "}
                      <span style={{ fg: labelColor, attributes: isHighlighted ? 1 : undefined }}>
                        {opt.label}
                      </span>
                    </span>
                  </text>
                  {opt.description && (
                    <text style={{ fg: descColor }}>
                      {"     "}{opt.description}
                    </text>
                  )}
                </React.Fragment>
              );
            })}
          </box>

          {/* Footer hint */}
          <box marginTop={SPACING.ELEMENT}>
            <text style={{ fg: colors.muted }}>
              Enter to select · ↑/↓ to navigate · Esc to cancel
            </text>
          </box>
        </>
      )}
    </box>
  );
}

export default UserQuestionInline;
