/**
 * TaskListPanel Component
 *
 * Persistent, file-driven task list panel pinned below the scrollbox
 * during /ralph workflow execution. Reads from tasks.json via file watcher.
 *
 * Reference: specs/ralph-task-list-ui.md
 */

import React, { useState, useEffect } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useTerminalDimensions } from "@opentui/react";

import { watchTasksJson } from "../commands/workflow-commands.ts";
import { MISC } from "../constants/icons.ts";
import { useThemeColors } from "../theme.tsx";
import { TaskListIndicator, type TaskItem } from "./task-list-indicator.tsx";
import { sortTasksTopologically } from "./task-order.ts";
import { normalizeTaskItem, normalizeTaskItems } from "../utils/task-status.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface TaskListPanelProps {
  /** Workflow session directory path */
  sessionDir: string;
  /** Workflow session ID (displayed for resume capability) */
  sessionId?: string | null;
  /** Whether to show full task content without truncation */
  expanded?: boolean;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TaskListPanel({
  sessionDir,
  sessionId,
  expanded = false,
}: TaskListPanelProps): React.ReactNode {
  const themeColors = useThemeColors();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const { width: terminalWidth } = useTerminalDimensions();

  useEffect(() => {
    // Initial load: read tasks.json synchronously on mount to avoid flash
    const tasksPath = join(sessionDir, "tasks.json");
    if (existsSync(tasksPath)) {
      try {
        const content = readFileSync(tasksPath, "utf-8");
        setTasks(sortTasksTopologically(normalizeTaskItems(JSON.parse(content))));
      } catch { /* ignore parse errors */ }
    }

    // Start file watcher for live updates
    const cleanup = watchTasksJson(sessionDir, (items) => {
      setTasks(sortTasksTopologically(items.map(toTaskItem)));
    });

    return cleanup;
  }, [sessionDir]);

  if (tasks.length === 0) return null;

  const completed = tasks.filter(t => t.status === "completed").length;
  const total = tasks.length;

  // Calculate max content length for task descriptions based on container width.
  // Overhead: paddingLeft(2) + paddingRight(2) + borderLeft(1) + borderRight(1)
  //         + innerPaddingLeft(1) + innerPaddingRight(1) + iconPrefix("   ● " = 5)
  // Total: 13 chars
  const maxContentLength = Math.max(20, terminalWidth - 13);

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} marginTop={1} flexShrink={0}>
      <box flexDirection="column" border borderStyle="rounded" borderColor={themeColors.muted} paddingLeft={1} paddingRight={1}>
        <text style={{ fg: themeColors.accent }} attributes={1}>
          {`Task Progress ${MISC.separator} ${completed}/${total} tasks`}
        </text>
        {sessionId && (
          <text style={{ fg: themeColors.muted }}>
            {`Session: ${sessionId}`}
          </text>
        )}
        <scrollbox maxHeight={15}>
          <TaskListIndicator items={tasks} expanded={expanded} maxVisible={Infinity} showConnector={false} maxContentLength={maxContentLength} />
        </scrollbox>
      </box>
    </box>
  );
}

/** Convert persisted disk payload to a normalized TaskItem for TaskListIndicator */
function toTaskItem(t: unknown): TaskItem {
  return normalizeTaskItem(t);
}

export default TaskListPanel;
