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
import { MarkdownRenderable, type SyntaxStyle } from "@opentui/core";
import type { TextPart } from "../../parts/types.ts";
import { createMarkdownSyntaxStyle, useTheme, useThemeColors } from "../../theme.tsx";
import { normalizeMarkdownNewlines } from "../../utils/format.ts";
import { STATUS } from "../../constants/icons.ts";
import { StreamingBullet } from "../../chat.tsx";

// Patch MarkdownRenderable to support text selection.
// MarkdownRenderable extends Renderable (not TextBufferRenderable), so its
// shouldStartSelection() always returns false, preventing selection from
// starting when the hit test returns a MarkdownRenderable. This patch
// delegates to a bounds check so selection can initiate and then walk into
// the child TextRenderable instances that hold the actual text.
MarkdownRenderable.prototype.shouldStartSelection = function (
  x: number,
  y: number,
) {
  if (!this.selectable) return false;
  const localX = x - this.x;
  const localY = y - this.y;
  return localX >= 0 && localX < this.width && localY >= 0 && localY < this.height;
};

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

  // Animated ● while streaming; static ● once complete.
  // Green ● is reserved for tool/agent blocks on success.
  const bullet = part.isStreaming
    ? <StreamingBullet />
    : <text style={{ fg: colors.foreground }}>{STATUS.active}</text>;

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
