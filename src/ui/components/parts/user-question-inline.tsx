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
import { STATUS, PROMPT } from "../../constants/icons.ts";
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
    <box flexDirection="column" marginTop={1} paddingLeft={2}>
      {question.header && (
        <text style={{ fg: colors.accent, attributes: 1 }}>{`${PROMPT.cursor} ${question.header}`}</text>
      )}
      <text style={{ fg: colors.foreground }}>{question.question}</text>

      {question.options.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          {question.options.map((opt, idx) => {
            const isSelected = idx === selectedIndex;
            const icon = isSelected ? STATUS.active : STATUS.pending;
            const color = isSelected ? colors.accent : colors.muted;
            return (
              <text key={opt.value} style={{ fg: color }}>
                {`  ${icon} ${opt.label}`}
                {opt.description ? ` — ${opt.description}` : ""}
              </text>
            );
          })}
        </box>
      )}
    </box>
  );
}

export default UserQuestionInline;
