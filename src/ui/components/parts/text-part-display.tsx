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

export interface TextPartDisplayProps {
  part: TextPart;
  isLast: boolean;
}

export function TextPartDisplay({ part, isLast }: TextPartDisplayProps): JSX.Element {
  const colors = useThemeColors();
  const displayContent = useThrottledValue(part.content, part.isStreaming ? 100 : 0);

  if (!displayContent) {
    return <box />;
  }

  return (
    <box flexDirection="column">
      <text color={colors.foreground}>{displayContent}</text>
    </box>
  );
}

export default TextPartDisplay;
