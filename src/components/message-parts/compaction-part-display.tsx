/**
 * CompactionPartDisplay Component
 *
 * Renders a compaction summary banner.
 */

import React from "react";
import type { CompactionPart } from "@/state/parts/types.ts";
import { useThemeColors } from "@/theme/index.tsx";
import { MISC } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";

export interface CompactionPartDisplayProps {
  part: CompactionPart;
  isLast: boolean;
}

export function CompactionPartDisplay({ part }: CompactionPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();

  return (
    <box flexDirection="column">
      <text fg={colors.muted}>
        {`${MISC.separator} Conversation compacted ${MISC.separator}`}
      </text>
      {part.summary && (
        <box marginLeft={SPACING.INDENT}>
          <text fg={colors.muted}>{part.summary}</text>
        </box>
      )}
    </box>
  );
}

export default CompactionPartDisplay;
