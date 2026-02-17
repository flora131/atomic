/**
 * UserQuestionInline Component
 *
 * Renders HITL (Human-in-the-Loop) permission questions inline after
 * their associated ToolPart, rather than as a fixed-position overlay.
 *
 * This is the key architectural change from the parts-based rendering spec.
 * Inspired by OpenCode's QuestionPrompt at message-part.tsx:547-665.
 */

import React, { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";
import { useThemeColors } from "../../theme.tsx";
import { STATUS, PROMPT, CONNECTOR } from "../../constants/icons.ts";
import { SPACING } from "../../constants/spacing.ts";
import type { PermissionOption } from "../../../sdk/types.ts";

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
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleSelect = useCallback(() => {
    if (question.options.length > 0) {
      const selected = question.options[selectedIndex];
      if (selected) {
        onAnswer(selected.value);
      }
    }
  }, [question.options, selectedIndex, onAnswer]);

  useKeyboard((event: KeyEvent) => {
    const key = event.name ?? "";
    if (key === "up") {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key === "down") {
      setSelectedIndex(i => Math.min(question.options.length - 1, i + 1));
    } else if (key === "return") {
      handleSelect();
    }
  });

  return (
    <box flexDirection="column" marginTop={SPACING.SECTION}>
      {/* Header badge — matches UserQuestionDialog style */}
      {question.header && (
        <box marginBottom={SPACING.SECTION}>
          <text>
            <span style={{ fg: colors.border }}>{CONNECTOR.roundedTopLeft}{CONNECTOR.horizontal}</span>
            <span style={{ fg: colors.accent, attributes: 1 }}> {STATUS.pending} {question.header} </span>
            <span style={{ fg: colors.border }}>{CONNECTOR.horizontal}{CONNECTOR.roundedTopRight}</span>
          </text>
        </box>
      )}

      {/* Question text — bold for visibility */}
      <text style={{ fg: colors.foreground, attributes: 1 }} wrapMode="word">
        {question.question}
      </text>

      {/* Options list — numbered for discoverability, accent for selected */}
      {question.options.length > 0 && (
        <box flexDirection="column" marginTop={SPACING.ELEMENT}>
          {question.options.map((opt, idx) => {
            const isSelected = idx === selectedIndex;
            const labelColor = isSelected ? colors.accent : colors.foreground;
            const descColor = isSelected ? colors.accent : colors.muted;
            return (
              <React.Fragment key={opt.value}>
                <text>
                  <span style={{ fg: isSelected ? colors.accent : colors.muted }}>
                    {isSelected ? `${PROMPT.cursor} ` : "  "}
                  </span>
                  <span style={{ fg: labelColor, attributes: isSelected ? 1 : undefined }}>
                    {idx + 1}. {opt.label}
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
      )}

      {/* Footer hint */}
      <box marginTop={SPACING.ELEMENT}>
        <text style={{ fg: colors.muted }}>
          Enter to select · ↑/↓ to navigate
        </text>
      </box>
    </box>
  );
}

export default UserQuestionInline;
