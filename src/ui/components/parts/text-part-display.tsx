/**
 * TextPartDisplay Component
 *
 * Renders a TextPart as markdown with optional throttling
 * during streaming to prevent UI thrashing. Uses <markdown>
 * when syntaxStyle is available, otherwise falls back to
 * <code filetype="markdown"> with conceal/streaming.
 */

import React, { useMemo } from "react";
import { MarkdownRenderable, type SyntaxStyle } from "@opentui/core";
import type { TextPart } from "../../parts/types.ts";
import { useThrottledValue } from "../../hooks/use-throttled-value.ts";
import { createMarkdownSyntaxStyle, useTheme, useThemeColors } from "../../theme.tsx";
import { normalizeMarkdownNewlines } from "../../utils/format.ts";

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
  const displayContent = useThrottledValue(part.content, part.isStreaming ? 100 : 0);
  const fallbackSyntaxStyle = useMemo(
    () => createMarkdownSyntaxStyle(colors, isDark),
    [colors, isDark],
  );

  const normalizedContent = normalizeMarkdownNewlines(displayContent ?? "");

  if (!normalizedContent) {
    return null;
  }

  return (
    <box flexDirection="column">
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
  );
}

export default TextPartDisplay;
