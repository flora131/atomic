/**
 * ReasoningPartDisplay Component
 *
 * Renders a ReasoningPart showing the model's reasoning/thinking process.
 * Uses <code filetype="markdown"> with a dimmed syntax style for visual
 * distinction from primary response content. If syntaxStyle is missing,
 * falls back to the same markdown code rendering with a local fallback style.
 */

import React, { useMemo } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ReasoningPart } from "../../parts/types.ts";
import { createDimmedSyntaxStyle, createMarkdownSyntaxStyle, useTheme, useThemeColors } from "../../theme.tsx";
import { SPACING } from "../../constants/spacing.ts";
import { normalizeMarkdownNewlines } from "../../utils/format.ts";

export interface ReasoningPartDisplayProps {
  part: ReasoningPart;
  isLast: boolean;
  syntaxStyle?: SyntaxStyle;
}

export function ReasoningPartDisplay({ part, syntaxStyle }: ReasoningPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const { isDark } = useTheme();
  const durationLabel = part.durationMs > 0
    ? `${(part.durationMs / 1000).toFixed(1)}s`
    : "";

  const fallbackSyntaxStyle = useMemo(
    () => createMarkdownSyntaxStyle(colors, isDark),
    [colors, isDark],
  );

  // Memoize the dimmed style variant to avoid recreating on every render
  const dimmedStyle = useMemo(
    () => createDimmedSyntaxStyle(syntaxStyle ?? fallbackSyntaxStyle, 0.6),
    [syntaxStyle, fallbackSyntaxStyle],
  );

  return (
    <box flexDirection="column">
      <text style={{ fg: colors.muted }}>
        {part.isStreaming ? "💭 Thinking..." : `💭 Thought${durationLabel ? ` (${durationLabel})` : ""}`}
      </text>
      {part.content && (
        <box marginLeft={SPACING.INDENT}>
          <code
            filetype="markdown"
            drawUnstyledText={false}
            streaming={part.isStreaming}
            syntaxStyle={dimmedStyle}
            content={normalizeMarkdownNewlines(part.content)}
            conceal={true}
            fg={colors.muted}
          />
        </box>
      )}
    </box>
  );
}

export default ReasoningPartDisplay;
