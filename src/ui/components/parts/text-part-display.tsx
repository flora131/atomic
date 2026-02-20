/**
 * TextPartDisplay Component
 *
 * Renders a TextPart as markdown with optional throttling
 * during streaming to prevent UI thrashing. Uses <markdown>
 * when syntaxStyle is available, otherwise falls back to
 * <code filetype="markdown"> with conceal/streaming.
 */

import React, { useMemo } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { TextPart } from "../../parts/types.ts";
import { useThrottledValue } from "../../hooks/use-throttled-value.ts";
import { createMarkdownSyntaxStyle, useTheme, useThemeColors } from "../../theme.tsx";
import { STATUS } from "../../constants/icons.ts";

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

  // Strip leading/trailing whitespace so the circle indicator always has text
  // beside it and trailing blank lines don't create excessive spacing before
  // the next part in the message.
  const trimmedContent = displayContent?.replace(/^\n+/, "").replace(/\n+$/, "");

  if (!trimmedContent) {
    return null;
  }

  return (
    <box flexDirection="column">
      {syntaxStyle ? (
        <markdown
          content={`${STATUS.active} ${trimmedContent}`}
          syntaxStyle={syntaxStyle}
          streaming={part.isStreaming}
          conceal={true}
        />
      ) : (
        <code
          content={`${STATUS.active} ${trimmedContent}`}
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
