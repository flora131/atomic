import React from "react";
import type { WorkflowStepPart } from "@/state/parts/types.ts";
import { useThemeColors } from "@/theme/index.tsx";

export interface WorkflowStepPartDisplayProps {
  part: WorkflowStepPart;
  isLast: boolean;
}

/**
 * Renders a simple stage banner for workflow step transitions.
 * Only visible for "running" status (stage start). Completed / error /
 * skipped steps are kept in the parts array for compaction but render nothing.
 */
export function WorkflowStepPartDisplay({ part }: WorkflowStepPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();

  // Only render the start-of-stage banner; completed steps are silent.
  if (part.status !== "running") {
    return null;
  }

  return (
    <box flexDirection="column">
      <text fg={colors.muted}>
        {part.nodeName.toUpperCase()}
      </text>
    </box>
  );
}

export default WorkflowStepPartDisplay;
