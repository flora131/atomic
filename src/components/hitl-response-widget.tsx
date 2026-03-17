/**
 * HitlResponseWidget Component
 *
 * A distinctive TUI widget rendered inline in the chat conversation stream
 * when a user answers a HITL (human-in-the-loop) question. Shows the original
 * question posed by the agent alongside the user's response in a compact,
 * visually prominent card.
 *
 * Design: Bordered card with rounded corners using Catppuccin palette accents.
 * The question is rendered in a subdued tone with the answer highlighted,
 * creating a clear visual record of the interaction.
 */

import React from "react";
import { useThemeColors } from "@/theme/index.tsx";
import { STATUS, CONNECTOR, PROMPT } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import type { HitlContext } from "@/state/chat/shared/types/index.ts";

export interface HitlResponseWidgetProps {
  context: HitlContext;
}

export function HitlResponseWidget({ context }: HitlResponseWidgetProps): React.ReactNode {
  const colors = useThemeColors();
  const isDeclined = context.cancelled || context.responseMode === "declined";
  const isChatAbout = context.responseMode === "chat_about_this";

  const statusIcon = isDeclined ? STATUS.error : STATUS.success;
  const statusColor = isDeclined ? colors.warning : colors.success;

  // Build the header badge label
  const headerLabel = context.header || "Question";

  // Answer display text
  const answerDisplay = isDeclined
    ? "Declined"
    : isChatAbout
      ? `"${context.answer}"`
      : context.answer;

  const answerColor = isDeclined
    ? colors.muted
    : colors.userBubbleFg;

  const answerBg = isDeclined
    ? undefined
    : colors.userBubbleBg;

  return (
    <box
      flexDirection="column"
    >
      {/* Header badge — rounded connector style matching UserQuestionDialog */}
      <box marginBottom={SPACING.NONE}>
        <text>
          <span fg={colors.border}>
            {CONNECTOR.roundedTopLeft}{CONNECTOR.horizontal}
          </span>
          <span fg={statusColor}> {statusIcon} </span>
          <span fg={colors.foreground}>{headerLabel} </span>
          <span fg={colors.border}>
            {CONNECTOR.horizontal}{CONNECTOR.roundedTopRight}
          </span>
        </text>
      </box>

      {/* Question text — muted, wrapping */}
      {context.question.length > 0 && (
        <text wrapMode="word" fg={colors.muted}>
          {"  "}{context.question}
        </text>
      )}

      {/* Answer line — prominent with accent prompt cursor */}
      <box marginTop={SPACING.NONE}>
        <text wrapMode="word">
          <span fg={colors.accent}> {PROMPT.cursor} </span>
          <span bg={answerBg} fg={answerColor} attributes={isDeclined ? undefined : 1}>
            {isDeclined ? answerDisplay : ` ${answerDisplay} `}
          </span>
        </text>
      </box>
    </box>
  );
}

export default HitlResponseWidget;
