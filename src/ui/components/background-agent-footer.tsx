import React from "react";
import type { ParallelAgent } from "./parallel-agents-tree.tsx";
import { useTheme } from "../theme.tsx";
import { SPACING } from "../constants/spacing.ts";
import { MISC, STATUS } from "../constants/icons.ts";
import { formatBackgroundAgentFooterStatus } from "../utils/background-agent-footer.ts";

export interface BackgroundAgentFooterProps {
  agents: readonly ParallelAgent[];
}

export function BackgroundAgentFooter({
  agents,
}: BackgroundAgentFooterProps): React.ReactNode {
  const { theme } = useTheme();
  const label = formatBackgroundAgentFooterStatus(agents);

  if (!label) {
    return null;
  }

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={SPACING.CONTAINER_PAD}
      paddingRight={SPACING.CONTAINER_PAD}
      marginTop={SPACING.NONE}
    >
      <text style={{ fg: theme.colors.muted }}>
        <span style={{ fg: theme.colors.dim }}>{STATUS.background}</span> {label}
        <span style={{ fg: theme.colors.dim }}> {MISC.separator} ctrl+f terminate</span>
      </text>
    </box>
  );
}

export default BackgroundAgentFooter;
