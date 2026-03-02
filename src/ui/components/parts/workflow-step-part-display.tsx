import React from "react";
import type { WorkflowStepPart } from "../../parts/types.ts";
import { useThemeColors } from "../../theme.tsx";
import { MISC, STATUS } from "../../constants/icons.ts";

export interface WorkflowStepPartDisplayProps {
  part: WorkflowStepPart;
  isLast: boolean;
}

function formatStepDuration(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return "";
  return ` (${Math.max(1, Math.round(durationMs / 1000))}s)`;
}

function getStepStatusLabel(part: WorkflowStepPart): { icon: string; label: string; colorKey: "muted" | "success" | "error" | "warning" } {
  switch (part.status) {
    case "running":
      return { icon: STATUS.active, label: "running", colorKey: "muted" };
    case "completed":
      return { icon: STATUS.success, label: "completed", colorKey: "success" };
    case "error":
      return { icon: STATUS.error, label: "error", colorKey: "error" };
    case "skipped":
      return { icon: STATUS.pending, label: "skipped", colorKey: "warning" };
  }
}

export function WorkflowStepPartDisplay({ part }: WorkflowStepPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const status = getStepStatusLabel(part);
  const color = colors[status.colorKey];

  return (
    <box flexDirection="column">
      <text style={{ fg: color }}>
        {`${MISC.separator} ${status.icon} Step: ${part.nodeName} ${status.label}${formatStepDuration(part.durationMs)} ${MISC.separator}`}
      </text>
    </box>
  );
}

export default WorkflowStepPartDisplay;
