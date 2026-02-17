/**
 * ReasoningPartDisplay Component
 *
 * Renders a ReasoningPart showing the model's reasoning/thinking process.
 * Uses <code filetype="markdown"> with a dimmed syntax style for visual
 * distinction from primary response content. Falls back to plain <text>
 * when syntaxStyle is not provided.
 */

import React, { useMemo } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ReasoningPart } from "../../parts/types.ts";
import { useThemeColors, createDimmedSyntaxStyle } from "../../theme.tsx";
import { SPACING } from "../../constants/spacing.ts";

export interface ReasoningPartDisplayProps {
  part: ReasoningPart;
  isLast: boolean;
  syntaxStyle?: SyntaxStyle;
}

export function ReasoningPartDisplay({ part, syntaxStyle }: ReasoningPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const durationLabel = part.durationMs > 0
    ? `${(part.durationMs / 1000).toFixed(1)}s`
    : "";

  // Memoize the dimmed style variant to avoid recreating on every render
  const dimmedStyle = useMemo(
    () => syntaxStyle ? createDimmedSyntaxStyle(syntaxStyle, 0.6) : undefined,
    [syntaxStyle],
  );

  return (
    <box flexDirection="column">
      <text style={{ fg: colors.muted }}>
        {part.isStreaming ? "💭 Thinking..." : `💭 Thought${durationLabel ? ` (${durationLabel})` : ""}`}
      </text>
      {part.content && (
        <box marginLeft={SPACING.INDENT}>
          {dimmedStyle ? (
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={part.isStreaming}
              syntaxStyle={dimmedStyle}
              content={part.content}
              conceal={true}
              fg={colors.muted}
            />
          ) : (
            <text style={{ fg: colors.muted }}>{part.content}</text>
          )}
        </box>
      )}
    </box>
  );
}

export default ReasoningPartDisplay;
