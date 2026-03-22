/**
 * TruncationPartDisplay Component
 *
 * Renders a truncation summary banner.
 */

import React from "react";
import type { TruncationPart } from "@/state/parts/types.ts";
import { useThemeColors } from "@/theme/index.tsx";
import { MISC } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";

export interface TruncationPartDisplayProps {
  part: TruncationPart;
  isLast: boolean;
}

export function TruncationPartDisplay({ part }: TruncationPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();

  return (
    <box flexDirection="column">
      <text fg={colors.muted}>
        {`${MISC.separator} Visible conversation truncated ${MISC.separator}`}
      </text>
      {part.summary && (
        <box marginLeft={SPACING.INDENT}>
          <text fg={colors.muted}>{part.summary}</text>
        </box>
      )}
    </box>
  );
}

export default TruncationPartDisplay;
