/**
 * TextPartDisplay Component
 *
 * Renders a TextPart as styled text with optional throttling
 * during streaming to prevent UI thrashing.
 */

import React from "react";
import type { TextPart } from "../../parts/types.ts";
import { useThrottledValue } from "../../hooks/use-throttled-value.ts";
import { useThemeColors } from "../../theme.tsx";
import { STATUS } from "../../constants/icons.ts";

export interface TextPartDisplayProps {
  part: TextPart;
}

export function TextPartDisplay({ part }: TextPartDisplayProps) {
  const colors = useThemeColors();
  const displayContent = useThrottledValue(part.content, part.isStreaming ? 100 : 0);

  // Strip leading newlines so the circle indicator always has text beside it
  const trimmedContent = displayContent?.replace(/^\n+/, "");

  if (!trimmedContent) {
    return null;
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <box flexShrink={0}>
          <text style={{ fg: colors.foreground }}>{STATUS.active} </text>
        </box>
        <text style={{ fg: colors.foreground }}>{trimmedContent}</text>
      </box>
    </box>
  );
}

export default TextPartDisplay;
