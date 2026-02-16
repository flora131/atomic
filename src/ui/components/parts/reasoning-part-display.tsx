/**
 * ReasoningPartDisplay Component
 *
 * Renders a ReasoningPart showing the model's reasoning/thinking process.
 * Displayed with dimmed styling and optional duration indicator.
 */

import React from "react";
import type { ReasoningPart } from "../../parts/types.ts";
import { useThemeColors } from "../../theme.tsx";
import { SPACING } from "../../constants/spacing.ts";

export interface ReasoningPartDisplayProps {
  part: ReasoningPart;
  isLast: boolean;
}

export function ReasoningPartDisplay({ part }: ReasoningPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const durationLabel = part.durationMs > 0
    ? `${(part.durationMs / 1000).toFixed(1)}s`
    : "";

  return (
    <box flexDirection="column">
      <text style={{ fg: colors.muted }}>
        {part.isStreaming ? "💭 Thinking..." : `💭 Thought${durationLabel ? ` (${durationLabel})` : ""}`}
      </text>
      {part.content && (
        <box marginLeft={SPACING.INDENT}>
          <text style={{ fg: colors.muted }}>{part.content}</text>
        </box>
      )}
    </box>
  );
}

export default ReasoningPartDisplay;
