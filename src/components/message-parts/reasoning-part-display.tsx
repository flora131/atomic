/**
 * ReasoningPartDisplay Component
 *
 * Renders a ReasoningPart showing the model's reasoning/thinking process.
 * Uses <markdown> with a dimmed syntax style for visual distinction from
 * primary response content, matching TextPartDisplay's rendering path for
 * consistent block formatting (spacing, tables, lists). Falls back to
 * <code filetype="markdown"> when no syntaxStyle is provided.
 */

import React, { useMemo } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ReasoningPart } from "@/state/parts/types.ts";
import { createDimmedSyntaxStyle, createMarkdownSyntaxStyle, useTheme, useThemeColors } from "@/theme/index.tsx";
import { SPACING } from "@/theme/spacing.ts";
import { MISC } from "@/theme/icons.ts";
import { normalizeMarkdownNewlines } from "@/lib/ui/format.ts";

// Apply MarkdownRenderable selection patch (idempotent, guarded)
import "@/lib/ui/markdown-selection-patch.ts";

export interface ReasoningPartDisplayProps {
  part: ReasoningPart;
  isLast: boolean;
  syntaxStyle?: SyntaxStyle;
}

export function formatReasoningDurationSeconds(durationMs: number): string {
  if (durationMs <= 0) return "";
  return `${Math.max(1, Math.round(durationMs / 1000))}s`;
}

export function ReasoningPartDisplay({ part, syntaxStyle }: ReasoningPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const { isDark } = useTheme();
  const normalizedContent = normalizeMarkdownNewlines(part.content);
  const durationLabel = formatReasoningDurationSeconds(part.durationMs);

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
      <text fg={colors.muted}>
        {part.isStreaming
          ? `${MISC.thinking} Thinking...`
          : `${MISC.thinking} Thought${durationLabel ? ` (${durationLabel})` : ""}`}
      </text>
      {normalizedContent && (
        <box marginLeft={SPACING.INDENT}>
          {syntaxStyle ? (
            <markdown
              content={normalizedContent}
              syntaxStyle={dimmedStyle}
              streaming={part.isStreaming}
              conceal={true}
              // @ts-expect-error selectable is a valid Renderable property but not typed in MarkdownOptions
              selectable={true}
            />
          ) : (
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={part.isStreaming}
              syntaxStyle={dimmedStyle}
              content={normalizedContent}
              conceal={true}
              fg={colors.muted}
            />
          )}
        </box>
      )}
    </box>
  );
}

export default ReasoningPartDisplay;
