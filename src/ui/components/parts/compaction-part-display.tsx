/**
 * CompactionPartDisplay Component
 *
 * Renders a compaction summary banner.
 */

import React from "react";
import type { CompactionPart } from "../../parts/types.ts";
import { useThemeColors } from "../../theme.tsx";
import { MISC } from "../../constants/icons.ts";

export interface CompactionPartDisplayProps {
  part: CompactionPart;
  isLast: boolean;
}

export function CompactionPartDisplay({ part }: CompactionPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <text style={{ fg: colors.muted }}>
        {`${MISC.separator} Conversation compacted ${MISC.separator}`}
      </text>
      {part.summary && (
        <box marginLeft={2}>
          <text style={{ fg: colors.muted }}>{part.summary}</text>
        </box>
      )}
    </box>
  );
}

export default CompactionPartDisplay;
