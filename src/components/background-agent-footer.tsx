import React from "react";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import { useTheme } from "@/theme/index.tsx";
import { SPACING } from "@/theme/spacing.ts";
import { MISC } from "@/theme/icons.ts";
import { formatBackgroundAgentFooterStatus } from "@/lib/ui/background-agent-footer.ts";
import { BACKGROUND_FOOTER_CONTRACT } from "@/lib/ui/background-agent-contracts.ts";

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
      <text style={{ fg: theme.colors.dim }}>
        <span style={{ fg: theme.colors.accent }}>{label}</span>
        {" "}{MISC.separator} {BACKGROUND_FOOTER_CONTRACT.terminateHintText}
      </text>
    </box>
  );
}

export default BackgroundAgentFooter;
