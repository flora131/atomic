/**
 * WorkflowStepPartDisplay Component
 *
 * Renders workflow step transition markers as subtle inline dividers.
 * Running:   ── Step: planner (running) ──────────────
 * Completed: ── Step: planner ✓ (2.3s) ───────────────
 * Error:     ── Step: planner ✗ (1.5s) ───────────────
 */

import React from "react";
import type { WorkflowStepPart } from "../../parts/types.ts";
import { useThemeColors } from "../../theme.tsx";
import { STATUS } from "../../constants/icons.ts";

export interface WorkflowStepPartDisplayProps {
  part: WorkflowStepPart;
  isLast: boolean;
}

function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function WorkflowStepPartDisplay({ part }: WorkflowStepPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();

  let statusIndicator: string;
  let detail: string;

  switch (part.status) {
    case "running":
      statusIndicator = STATUS.active;
      detail = "(running)";
      break;
    case "completed":
      statusIndicator = STATUS.success;
      detail = part.durationMs != null ? `(${formatStepDuration(part.durationMs)})` : "";
      break;
    case "error":
      statusIndicator = STATUS.error;
      detail = part.durationMs != null ? `(${formatStepDuration(part.durationMs)})` : "";
      break;
  }

  const label = `── Step: ${part.nodeName} ${statusIndicator} ${detail} ──`;

  return (
    <box flexDirection="row">
      <text style={{ fg: colors.muted }}>{label}</text>
    </box>
  );
}

export default WorkflowStepPartDisplay;
