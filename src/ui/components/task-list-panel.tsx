/**
 * TaskListPanel & TaskListBox Components
 *
 * TaskListBox: Reusable presentational component for rendering a task list
 * with an industrial-dashboard aesthetic — bordered container, progress header,
 * visual progress bar, numbered task rows, and status-aware styling.
 *
 * TaskListPanel: Persistent, file-driven wrapper that reads from tasks.json
 * via file watcher during workflow execution, feeding data to TaskListBox.
 *
 * Reference: specs/ralph-task-list-ui.md
 */

import React, { useState, useEffect } from "react";
import { useTerminalDimensions } from "@opentui/react";

import { watchTasksJson } from "../commands/workflow-commands.ts";
import { MISC, TASK as TASK_ICONS } from "../constants/icons.ts";
import { useThemeColors, useTheme, getCatppuccinPalette } from "../theme.tsx";
import { TaskListIndicator, type TaskItem } from "./task-list-indicator.tsx";
import { sortTasksTopologically } from "./task-order.ts";
import { normalizeTaskItem } from "../utils/task-status.ts";
import { shouldAutoClearTaskPanel } from "../utils/task-list-lifecycle.ts";
import { SPACING } from "../constants/spacing.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface TaskListBoxProps {
  /** Task items to display */
  items: TaskItem[];
  /** Whether to show full task content without truncation */
  expanded?: boolean;
  /** Header label override (default: "Task Progress") */
  headerTitle?: string;
}

export interface TaskListPanelProps {
  /** Workflow session directory path */
  sessionDir: string;
  /** Whether to show full task content without truncation */
  expanded?: boolean;
}

// ============================================================================
// PROGRESS BAR
// ============================================================================

/**
 * Build a textual progress bar using heavy-rule and dashed characters.
 * Example: "━━━━━━━━╌╌╌╌╌╌" with filled portion in accent, empty in dim.
 */
function buildProgressSegments(
  completed: number,
  total: number,
  barWidth: number,
): { filled: string; empty: string } {
  const ratio = total > 0 ? completed / total : 0;
  const filledLen = Math.round(ratio * barWidth);
  const emptyLen = barWidth - filledLen;
  return {
    filled: TASK_ICONS.barFilled.repeat(filledLen),
    empty: TASK_ICONS.barEmpty.repeat(emptyLen),
  };
}

// ============================================================================
// TASK LIST BOX (Shared presentational component)
// ============================================================================

export function TaskListBox({
  items,
  expanded = false,
  headerTitle = "Task Progress",
}: TaskListBoxProps): React.ReactNode {
  const themeColors = useThemeColors();
  const { isDark } = useTheme();
  const palette = getCatppuccinPalette(isDark);
  const { width: terminalWidth } = useTerminalDimensions();

  if (items.length === 0) return null;

  const completed = items.filter(t => t.status === "completed").length;
  const inProgress = items.filter(t => t.status === "in_progress").length;
  const errored = items.filter(t => t.status === "error").length;
  const total = items.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Effective width accounts for the parent INDENT padding on each side.
  const effectiveWidth = terminalWidth;

  // Calculate max content length for task descriptions based on container width.
  // Overhead: parentPad(4) + border(2) + innerPad(2) + rail(1) + space(1) + icon(1) + space(1)
  // Total: ~12 chars
  const maxContentLength = Math.max(20, effectiveWidth - 12);

  // Progress bar width: effective width minus box overhead
  // parentPad(4) + border(2) + innerPad(2) = 8
  const innerWidth = Math.max(20, effectiveWidth - 8);
  const headerLabel = `${TASK_ICONS.active} ${headerTitle} ${MISC.separator} ${completed}/${total} ${MISC.separator} ${pct}%`;
  const barWidth = Math.max(10, innerWidth - 2);

  const { filled, empty } = buildProgressSegments(completed, total, barWidth);

  // Status summary line (only shown when there are active/error items)
  const summaryParts: string[] = [];
  if (inProgress > 0) summaryParts.push(`${inProgress} running`);
  if (errored > 0) summaryParts.push(`${errored} failed`);
  const pending = total - completed - inProgress - errored;
  if (pending > 0) summaryParts.push(`${pending} pending`);
  const summaryLine = summaryParts.join(` ${MISC.separator} `);

  // Max visible items before scrolling kicks in
  const scrollThreshold = 15;

  const taskList = (
    <TaskListIndicator items={items} expanded={expanded} maxVisible={Infinity} showConnector={false} maxContentLength={maxContentLength} />
  );

  return (
    <box flexDirection="column" border borderStyle="rounded" borderColor={themeColors.dim} paddingLeft={SPACING.CONTAINER_PAD} paddingRight={SPACING.CONTAINER_PAD}>
      {/* Header */}
      <text wrapMode="none" attributes={1}>
        <span style={{ fg: palette.teal }}>{headerLabel}</span>
      </text>

      {/* Progress bar */}
      <text wrapMode="none">
        <span style={{ fg: themeColors.success }}>{filled}</span>
        <span style={{ fg: themeColors.dim }}>{empty}</span>
      </text>

      {/* Status summary */}
      {summaryLine.length > 0 && (
        <text wrapMode="none">
          <span style={{ fg: themeColors.muted }}>{summaryLine}</span>
        </text>
      )}

      {/* Task list: use scrollbox only when items exceed threshold */}
      {items.length > scrollThreshold ? (
        <scrollbox maxHeight={scrollThreshold}>
          {taskList}
        </scrollbox>
      ) : (
        taskList
      )}
    </box>
  );
}

// ============================================================================
// TASK LIST PANEL (File-driven wrapper for workflows)
// ============================================================================

export function TaskListPanel({
  sessionDir,
  expanded = false,
}: TaskListPanelProps): React.ReactNode {
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    // Start file watcher for live updates
    const cleanup = watchTasksJson(sessionDir, (items) => {
      setTasks(sortTasksTopologically(items.map(toTaskItem)));
    });

    return cleanup;
  }, [sessionDir]);

  if (tasks.length === 0 || shouldAutoClearTaskPanel(tasks)) return null;

  return (
    <box flexDirection="column" paddingLeft={SPACING.INDENT} paddingRight={SPACING.INDENT} marginTop={SPACING.ELEMENT} flexShrink={0}>
      <TaskListBox items={tasks} expanded={expanded} />
    </box>
  );
}

/** Convert persisted disk payload to a normalized TaskItem for TaskListIndicator */
function toTaskItem(t: unknown): TaskItem {
  return normalizeTaskItem(t);
}

export default TaskListPanel;
