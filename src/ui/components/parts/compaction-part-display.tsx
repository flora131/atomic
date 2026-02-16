/**
 * CompactionPartDisplay Component
 *
 * Renders a compaction summary banner.
 */

import React from "react";
import type { CompactionPart } from "../../parts/types.ts";
import { useThemeColors } from "../../theme.tsx";
import { MISC } from "../../constants/icons.ts";
import { SPACING } from "../../constants/spacing.ts";

export interface CompactionPartDisplayProps {
  part: CompactionPart;
  isLast: boolean;
}

export function CompactionPartDisplay({ part }: CompactionPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();

  return (
    <box flexDirection="column" marginTop={SPACING.SECTION} marginBottom={SPACING.SECTION}>
      <text style={{ fg: colors.muted }}>
        {`${MISC.separator} Conversation compacted ${MISC.separator}`}
      </text>
      {part.summary && (
        <box marginLeft={SPACING.INDENT}>
          <text style={{ fg: colors.muted }}>{part.summary}</text>
        </box>
      )}
    </box>
  );
}

export default CompactionPartDisplay;
