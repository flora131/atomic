import React from "react";
import { STATUS, TASK, MISC } from "../constants/icons.ts";
import { SPACING } from "../constants/spacing.ts";
import { useThemeColors } from "../theme.tsx";
import { formatDuration } from "../utils/format.ts";
import type { PhaseData } from "../commands/workflow-commands.ts";

export interface WorkflowPhaseSectionProps {
  phase: PhaseData;
  expanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}

export function getPhaseStatusIcon(status: PhaseData["status"]): string {
  switch (status) {
    case "completed":
      return STATUS.active;
    case "error":
      return STATUS.error;
    case "running":
    default:
      return STATUS.pending;
  }
}

export function getPhaseStatusColorKey(
  status: PhaseData["status"],
): "accent" | "success" | "error" {
  switch (status) {
    case "completed":
      return "success";
    case "error":
      return "error";
    case "running":
    default:
      return "accent";
  }
}

export function getPhaseToggleIcon(expanded: boolean): string {
  return expanded ? MISC.collapsed : TASK.active;
}

export function getCollapsedEventSummary(eventCount: number): string | null {
  if (eventCount <= 0) return null;
  return `${eventCount} event${eventCount === 1 ? "" : "s"}`;
}

export function WorkflowPhaseSection({
  phase,
  expanded = false,
  onToggle,
  children,
}: WorkflowPhaseSectionProps): React.ReactNode {
  const themeColors = useThemeColors();
  const durationText = typeof phase.durationMs === "number"
    ? formatDuration(phase.durationMs).text
    : null;
  const collapsedEventSummary = !expanded
    ? getCollapsedEventSummary(phase.events.length)
    : null;
  const statusColor = themeColors[getPhaseStatusColorKey(phase.status)];

  return (
    <box flexDirection="column" marginTop={SPACING.ELEMENT}>
      <box flexDirection="row" gap={SPACING.ELEMENT} onMouseDown={onToggle}>
        <text style={{ fg: themeColors.muted }}>
          {getPhaseToggleIcon(expanded)}
        </text>
        <text style={{ fg: statusColor }}>{getPhaseStatusIcon(phase.status)}</text>
        <text style={{ fg: themeColors.accent }}>{phase.phaseIcon}</text>
        <text style={{ fg: themeColors.foreground }}>{phase.message}</text>
        {durationText && (
          <text style={{ fg: themeColors.muted }}>({durationText})</text>
        )}
        {collapsedEventSummary && (
          <text style={{ fg: themeColors.dim }}>
            {MISC.separator} {collapsedEventSummary}
          </text>
        )}
      </box>

      {expanded && children && (
        <box marginLeft={SPACING.INDENT} marginTop={SPACING.NONE}>
          {children}
        </box>
      )}
    </box>
  );
}
