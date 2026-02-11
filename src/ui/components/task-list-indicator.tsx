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

import React, { useState, useEffect } from "react";

import { useThemeColors } from "../theme.tsx";

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
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const TASK_STATUS_ICONS: Record<TaskItem["status"], string> = {
  pending: "○",
  in_progress: "●",
  completed: "●",
  error: "✕",
};

/** Max content chars before truncation (prefix takes ~5 chars: "⎿  ● ") */
export const MAX_CONTENT_LENGTH = 60;

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

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
// ANIMATED STATUS INDICATOR
// ============================================================================

/**
 * Animated blinking indicator for in-progress task state.
 * Alternates between ● and · to simulate a blink, matching ToolResult behavior.
 */
function AnimatedStatusIndicator({
  color,
  speed = 500,
}: {
  color: string;
  speed?: number;
}): React.ReactNode {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, speed);
    return () => clearInterval(interval);
  }, [speed]);

  return (
    <span style={{ fg: color }}>
      {visible ? "●" : "·"}
    </span>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TaskListIndicator({
  items,
  maxVisible = 10,
  expanded = false,
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
          <text key={i}>
            <span style={{ fg: themeColors.muted }}>{i === 0 ? "⎿  " : "   "}</span>
            {isActive ? (
              <AnimatedStatusIndicator color={color} speed={500} />
            ) : (
              <span style={{ fg: color }}>{icon}</span>
            )}
            <span style={{ fg: color }}>{" "}{expanded ? item.content : truncate(item.content, MAX_CONTENT_LENGTH)}</span>
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
