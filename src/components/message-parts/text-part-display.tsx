/**
 * TextPartDisplay Component
 *
 * Renders a TextPart as markdown with a ● bullet prefix per the
 * UI design patterns. Uses <markdown> when syntaxStyle is available,
 * otherwise falls back to <code filetype="markdown"> with conceal/streaming.
 *
 * Layout:
 *   ● First line of markdown content
 *     continuation lines are indented to align with text after the bullet
 */

import React, { useMemo } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { TextPart } from "@/state/parts/types.ts";
import { createMarkdownSyntaxStyle, useTheme, useThemeColors } from "@/theme/index.tsx";
import { normalizeMarkdownNewlines } from "@/lib/ui/format.ts";
import { STATUS } from "@/theme/icons.ts";
import { StreamingBullet } from "@/components/chat-loading-indicator.tsx";

// Apply MarkdownRenderable selection patch (idempotent, guarded)
import "@/lib/ui/markdown-selection-patch.ts";

export interface TextPartDisplayProps {
  part: TextPart;
  syntaxStyle?: SyntaxStyle;
}

export function TextPartDisplay({ part, syntaxStyle }: TextPartDisplayProps) {
  const colors = useThemeColors();
  const { isDark } = useTheme();
  const fallbackSyntaxStyle = useMemo(
    () => createMarkdownSyntaxStyle(colors, isDark),
    [colors, isDark],
  );

  const normalizedContent = normalizeMarkdownNewlines(part.content ?? "");

  if (!normalizedContent) {
    return null;
  }

  // Animated ● / · blinker when streaming; static ● otherwise.
  const bullet = part.isStreaming
    ? <StreamingBullet />
    : <text fg={colors.foreground}>{STATUS.active}</text>;

  return (
    <box flexDirection="row">
      <box flexShrink={0} width={2}>{bullet}</box>
      <box flexGrow={1} flexShrink={1} flexDirection="column">
        {syntaxStyle ? (
          <markdown
            content={normalizedContent}
            syntaxStyle={syntaxStyle}
            streaming={part.isStreaming}
            conceal={true}
            // @ts-expect-error selectable is a valid Renderable property but not typed in MarkdownOptions
            selectable={true}
          />
        ) : (
          <code
            content={normalizedContent}
            filetype="markdown"
            drawUnstyledText={false}
            streaming={part.isStreaming}
            syntaxStyle={syntaxStyle ?? fallbackSyntaxStyle}
            fg={colors.foreground}
            conceal={true}
          />
        )}
      </box>
    </box>
  );
}

export default TextPartDisplay;
