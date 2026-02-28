/**
 * TaskListIndicator Component
 *
 * Renders a task/todo list with status indicators and tree-style connectors,
 * displayed inline under the LoadingIndicator during agent streaming.
 *
 * Uses circle-based status icons consistent with ToolResult and ParallelAgentsTree:
 * - pending:     ○  muted
 * - in_progress: ●  accent (blinking)
 * - completed:   ●  green
 * - error:       ✕  red
 *
 * Reference: Issue #168
 */

import React from "react";

import { CONNECTOR, TASK } from "../constants/icons.ts";
import { useThemeColors, useTheme, getCatppuccinPalette } from "../theme.tsx";
import { truncateText } from "../utils/format.ts";
import { normalizeTaskStatus } from "../utils/task-status.ts";
import { AnimatedBlinkIndicator } from "./animated-blink-indicator.tsx";

// ============================================================================
// TYPES
// ============================================================================

export interface TaskItem {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "error";
  blockedBy?: string[];
}

export interface TaskListIndicatorProps {
  /** Task items to display */
  items: TaskItem[];
  /** Maximum items to show before collapsing (default: 10) */
  maxVisible?: number;
  /** When true, show full content without truncation (ctrl+t toggle) */
  expanded?: boolean;
  /** Whether to show the tree connector (╰) on the first item (default: true) */
  showConnector?: boolean;
  /** Override max content chars before truncation (default: MAX_CONTENT_LENGTH) */
  maxContentLength?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const TASK_STATUS_ICONS: Record<TaskItem["status"], string> = {
  pending: TASK.pending,
  in_progress: TASK.active,
  completed: TASK.completed,
  error: TASK.error,
};

/** Max content chars before truncation */
export const MAX_CONTENT_LENGTH = 60;

/** @deprecated Use truncateText from utils/format.ts directly */
export const truncate = truncateText;

/** Map task status to semantic color key */
export function getStatusColorKey(status: TaskItem["status"]): "muted" | "accent" | "success" | "error" {
  switch (status) {
    case "pending": return "muted";
    case "in_progress": return "accent";
    case "completed": return "success";
    case "error": return "error";
    default: return "muted";
  }
}

/** Normalize unknown runtime status values to a render-safe status. */
export function getRenderableTaskStatus(status: unknown): TaskItem["status"] {
  return normalizeTaskStatus(status);
}

/** Short status label for error tasks. */
function getStatusLabel(status: TaskItem["status"]): string | null {
  switch (status) {
    case "error": return "FAILED";
    default: return null;
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TaskListIndicator({
  items,
  maxVisible = 10,
  expanded = false,
  showConnector = true,
  maxContentLength,
}: TaskListIndicatorProps): React.ReactNode {
  const themeColors = useThemeColors();
  const { isDark } = useTheme();
  const palette = getCatppuccinPalette(isDark);

  if (items.length === 0) {
    return null;
  }

  const visibleItems = items.slice(0, maxVisible);
  const overflowCount = items.length - maxVisible;

  return (
    <box flexDirection="column">
      {visibleItems.map((item, i) => {
        const status = getRenderableTaskStatus(item.status);
        const colorKey = getStatusColorKey(status);
        const color = themeColors[colorKey];
        const icon = TASK_STATUS_ICONS[status];
        const isActive = status === "in_progress";
        const isCompleted = status === "completed";
        const isError = status === "error";
        const isLast = i === visibleItems.length - 1 && overflowCount === 0;

        // Left rail character
        const rail = isLast ? TASK.trackEnd : TASK.trackDot;

        // Dim completed task text for visual hierarchy
        const textColor = isCompleted ? themeColors.dim : isError ? palette.red : color;
        const contentColor = isCompleted ? themeColors.dim : themeColors.foreground;
        const statusLabel = getStatusLabel(status);

        // Content truncation accounting for suffix overhead (e.g. " [FAILED]")
        const labelOverhead = statusLabel ? statusLabel.length + 3 : 0;
        const effectiveMax = (maxContentLength ?? MAX_CONTENT_LENGTH) - labelOverhead;
        const displayContent = expanded ? item.content : truncateText(item.content, effectiveMax);

        const hasBlockers = item.blockedBy && item.blockedBy.length > 0;
        const blockersSuffix = hasBlockers
          ? ` › blocked by ${item.blockedBy!.map(id => id.startsWith("#") ? id : `#${id}`).join(", ")}`
          : "";

        return isActive ? (
          // Active tasks use a row layout so the AnimatedBlinkIndicator
          // lives in its own <text> node — OpenTUI re-renders it reliably
          // when setInterval triggers a state change.
          <box key={item.id ?? i} flexDirection="row">
            <text wrapMode="none">
              <span style={{ fg: themeColors.dim }}>{showConnector && i === 0 ? `${CONNECTOR.subStatus} ` : `${rail} `}</span>
            </text>
            <text><AnimatedBlinkIndicator color={color} speed={500} /></text>
            <text wrapMode="none">
              <span style={{ fg: contentColor }}>{` ${displayContent}`}</span>
            </text>
          </box>
        ) : (
          <text key={item.id ?? i} wrapMode="none">
            {/* Left rail */}
            <span style={{ fg: themeColors.dim }}>{showConnector && i === 0 ? `${CONNECTOR.subStatus} ` : `${rail} `}</span>
            {/* Status icon */}
            <span style={{ fg: textColor }}>{icon}</span>
            {/* Content */}
            <span style={{ fg: contentColor }}>{` ${displayContent}`}</span>
            {/* Status label for active/error */}
            {statusLabel && (
              <span style={{ fg: textColor, }}>{` [${statusLabel}]`}</span>
            )}
            {/* Blocked-by info inline */}
            {hasBlockers && (
              <span style={{ fg: themeColors.muted }}>{blockersSuffix}</span>
            )}
          </text>
        );
      })}
      {overflowCount > 0 && (
        <text>
          <span style={{ fg: themeColors.dim }}>
            {"   "}
            {`… +${overflowCount} more`}
          </span>
        </text>
      )}
    </box>
  );
}

export default TaskListIndicator;
