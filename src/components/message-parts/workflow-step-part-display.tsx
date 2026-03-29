import React from "react";
import type { WorkflowStepPart } from "@/state/parts/types.ts";
import { useThemeColors } from "@/theme/index.tsx";
import { AnimatedBlinkIndicator } from "@/components/animated-blink-indicator.tsx";
import { STATUS, MISC } from "@/theme/icons.ts";

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

const STATUS_ICONS: Record<WorkflowStepPart["status"], string> = {
  running: "",          // uses AnimatedBlinkIndicator instead
  completed: STATUS.success, // ✓
  error: STATUS.error,       // ✗
  skipped: STATUS.pending,   // ○
  interrupted: MISC.warning, // ⚠
};

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
 *   - Blinking ● while running
 *   - ✓ on successful completion
 *   - ✗ on error
 *   - ⚠ on interrupted
 * Skipped stages render nothing to avoid visual clutter.
 */
export function WorkflowStepPartDisplay({ part }: WorkflowStepPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const statusColor = useStatusColor(part.status);

  const durationLabel =
    part.status === "completed" && part.durationMs !== undefined
      ? ` (${formatDuration(part.durationMs)})`
      : "";

  const icon = part.status === "running"
    ? <AnimatedBlinkIndicator color={statusColor} />
    : <span fg={statusColor}>{STATUS_ICONS[part.status]}</span>;

  return (
    <box flexDirection="row" gap={1}>
      <text>{icon}</text>
      <text>
        <span fg={statusColor}>
          <strong>{part.indicator ?? part.nodeId.toUpperCase()}</strong>
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
