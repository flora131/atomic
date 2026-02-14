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

import { STATUS, CONNECTOR } from "../constants/icons.ts";
import { useThemeColors } from "../theme.tsx";
import { truncateText } from "../utils/format.ts";
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
  pending: STATUS.pending,
  in_progress: STATUS.active,
  completed: STATUS.active,
  error: STATUS.error,
};

/** Max content chars before truncation (prefix takes ~5 chars: "⎿  ● ") */
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

  if (items.length === 0) {
    return null;
  }

  const visibleItems = items.slice(0, maxVisible);
  const overflowCount = items.length - maxVisible;

  return (
    <box flexDirection="column">
      {visibleItems.map((item, i) => {
        const color = themeColors[getStatusColorKey(item.status)];
        const icon = TASK_STATUS_ICONS[item.status];
        const isActive = item.status === "in_progress";
        return (
          <text key={item.id ?? i} wrapMode="none">
            <span style={{ fg: themeColors.muted }}>{showConnector && i === 0 ? `${CONNECTOR.subStatus}  ` : "   "}</span>
            {isActive ? (
              <AnimatedBlinkIndicator color={color} speed={500} />
            ) : (
              <span style={{ fg: color }}>{icon}</span>
            )}
            <span style={{ fg: color }}>{" "}{expanded ? item.content : truncateText(item.content, maxContentLength ?? MAX_CONTENT_LENGTH)}</span>
            {item.blockedBy && item.blockedBy.length > 0 && (
              <span style={{ fg: themeColors.muted }}>{` › blocked by ${item.blockedBy.map(id => id.startsWith("#") ? id : `#${id}`).join(", ")}`}</span>
            )}
          </text>
        );
      })}
      {overflowCount > 0 && (
        <text>
          <span style={{ fg: themeColors.muted }}>
            {"   ... +"}
            {overflowCount}
            {" more tasks"}
          </span>
        </text>
      )}
    </box>
  );
}

export default TaskListIndicator;
