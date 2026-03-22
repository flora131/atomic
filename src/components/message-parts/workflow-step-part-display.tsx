import React from "react";
import type { WorkflowStepPart } from "@/state/parts/types.ts";
import { useThemeColors } from "@/theme/index.tsx";
import { STATUS } from "@/theme/icons.ts";

export interface WorkflowStepPartDisplayProps {
  part: WorkflowStepPart;
  isLast: boolean;
}

const STATUS_ICONS: Record<WorkflowStepPart["status"], string> = {
  running: STATUS.active,
  completed: STATUS.success,
  error: STATUS.error,
  skipped: STATUS.pending,
};

function useStatusColor(status: WorkflowStepPart["status"]): string {
  const colors = useThemeColors();
  switch (status) {
    case "running": return colors.accent;
    case "completed": return colors.success;
    case "error": return colors.error;
    case "skipped": return colors.warning;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Renders a stage banner for workflow step transitions.
 * Persists across all statuses with color-coded visual feedback:
 *   - Blue accent while running
 *   - Green on successful completion
 *   - Yellow for skipped/interrupted
 *   - Red on error
 */
export function WorkflowStepPartDisplay({ part }: WorkflowStepPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const statusColor = useStatusColor(part.status);
  const icon = STATUS_ICONS[part.status];

  const durationLabel =
    part.status === "completed" && part.durationMs !== undefined
      ? ` (${formatDuration(part.durationMs)})`
      : "";

  return (
    <box flexDirection="row" gap={1}>
      <text fg={statusColor}>│</text>
      <text>
        <span fg={statusColor}>{icon}</span>
        {" "}
        <span fg={statusColor}>
          <strong>{part.nodeName.toUpperCase()}</strong>
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
