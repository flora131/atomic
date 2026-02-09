/**
 * TaskListIndicator Component
 *
 * Renders a task/todo list with status indicators and tree-style connectors,
 * displayed inline under the LoadingIndicator during agent streaming.
 *
 * Reference: Issue #168
 */

import React from "react";

// ============================================================================
// TYPES
// ============================================================================

export interface TaskItem {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  blockedBy?: string[];
}

export interface TaskListIndicatorProps {
  /** Task items to display */
  items: TaskItem[];
  /** Maximum items to show before collapsing (default: 10) */
  maxVisible?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_ICONS: Record<TaskItem["status"], string> = {
  pending: "◻",
  in_progress: "◉",
  completed: "◼",
};

const STATUS_COLORS: Record<TaskItem["status"], string> = {
  pending: "#E0E0E0",
  in_progress: "#D4A5A5",
  completed: "#8AB89A",
};

const OVERFLOW_COLOR = "#9A9AAC";
/** Max content chars before truncation (prefix takes ~5 chars: "└  □ ") */
const MAX_CONTENT_LENGTH = 60;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TaskListIndicator({
  items,
  maxVisible = 10,
}: TaskListIndicatorProps): React.ReactNode {
  if (items.length === 0) {
    return null;
  }

  const visibleItems = items.slice(0, maxVisible);
  const overflowCount = items.length - maxVisible;

  return (
    <box flexDirection="column">
      {visibleItems.map((item, i) => {
        const color = STATUS_COLORS[item.status];
        const icon = STATUS_ICONS[item.status];
        return (
          <text key={i}>
            <span style={{ fg: "#949494" }}>{i === 0 ? "⎿  " : "   "}</span>
            <span style={{ fg: color }}>{icon} </span>
            <span style={{ fg: color }}>{truncate(item.content, MAX_CONTENT_LENGTH)}</span>
            {item.blockedBy && item.blockedBy.length > 0 && (
              <span style={{ fg: OVERFLOW_COLOR }}>{` › blocked by ${item.blockedBy.map(id => id.startsWith("#") ? id : `#${id}`).join(", ")}`}</span>
            )}
          </text>
        );
      })}
      {overflowCount > 0 && (
        <text>
          <span style={{ fg: OVERFLOW_COLOR }}>
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
