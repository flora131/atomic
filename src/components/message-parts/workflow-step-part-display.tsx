import React from "react";
import type { WorkflowStepPart } from "@/state/parts/types.ts";
import { useThemeColors } from "@/theme/index.tsx";
export interface WorkflowStepPartDisplayProps {
  part: WorkflowStepPart;
  isLast: boolean;
}

function useStatusColor(status: WorkflowStepPart["status"]): string {
  const colors = useThemeColors();
  switch (status) {
    case "running": return colors.accent;
    case "completed": return colors.success;
    case "error": return colors.error;
    case "skipped": return colors.warning;
    case "interrupted": return colors.warning;
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Renders a stage banner for workflow step transitions.
 * Persists across executed statuses with color-coded visual feedback:
 *   - Blue accent while running
 *   - Green on successful completion
 *   - Red on error
 * Skipped stages render nothing to avoid visual clutter.
 */
export function WorkflowStepPartDisplay({ part }: WorkflowStepPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const statusColor = useStatusColor(part.status);

  const durationLabel =
    part.status === "completed" && part.durationMs !== undefined
      ? ` (${formatDuration(part.durationMs)})`
      : "";

  return (
    <box flexDirection="row" gap={1}>
      <text fg={statusColor}>│</text>
      <text>
        <span fg={statusColor}>
          <strong>{part.nodeId.toUpperCase()}</strong>
        </span>
        {durationLabel && (
          <span fg={colors.muted}>{durationLabel}</span>
        )}
        {part.status === "error" && part.error && (
          <span fg={colors.error}>
            {" "}— {part.error}
          </span>
        )}
      </text>
    </box>
  );
}

export default WorkflowStepPartDisplay;
