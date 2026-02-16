/**
 * TaskListPanel Component
 *
 * Persistent, file-driven task list panel pinned below the scrollbox
 * during /ralph workflow execution. Reads from tasks.json via file watcher.
 *
 * Features an industrial-dashboard aesthetic with a visual progress bar,
 * numbered task rows, and status-aware styling.
 *
 * Reference: specs/ralph-task-list-ui.md
 */

import React, { useState, useEffect } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useTerminalDimensions } from "@opentui/react";

import { watchTasksJson } from "../commands/workflow-commands.ts";
import { MISC, TASK as TASK_ICONS } from "../constants/icons.ts";
import { useThemeColors, useTheme, getCatppuccinPalette } from "../theme.tsx";
import { TaskListIndicator, type TaskItem } from "./task-list-indicator.tsx";
import { sortTasksTopologically } from "./task-order.ts";
import { normalizeTaskItem, normalizeTaskItems } from "../utils/task-status.ts";
import { SPACING } from "../constants/spacing.ts";

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
// MAIN COMPONENT
// ============================================================================

export function TaskListPanel({
  sessionDir,
  sessionId,
  expanded = false,
}: TaskListPanelProps): React.ReactNode {
  const themeColors = useThemeColors();
  const { isDark } = useTheme();
  const palette = getCatppuccinPalette(isDark);
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
  const inProgress = tasks.filter(t => t.status === "in_progress").length;
  const errored = tasks.filter(t => t.status === "error").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Calculate max content length for task descriptions based on container width.
  // Overhead: paddingLeft(2) + paddingRight(2) + borderLeft(1) + borderRight(1)
  //         + innerPaddingLeft(1) + innerPaddingRight(1) + rail(1) + space(1) + icon(1) + space(1) + idx(2) + space(1)
  // Total: ~15 chars
  const maxContentLength = Math.max(20, terminalWidth - 15);

  // Progress bar width: inner container width minus label overhead
  // Container: terminalWidth - paddingLeft(2) - paddingRight(2) - border(2) - innerPadding(2) = tw - 8
  const innerWidth = Math.max(20, terminalWidth - 8);
  // Header label: "▸ Task Progress · 3/4 · 75% " ≈ 30 chars
  const headerLabel = `${TASK_ICONS.active} Task Progress ${MISC.separator} ${completed}/${total} ${MISC.separator} ${pct}%`;
  const barWidth = Math.max(10, innerWidth - 2);

  const { filled, empty } = buildProgressSegments(completed, total, barWidth);

  // Status summary line (only shown when there are active/error items)
  const summaryParts: string[] = [];
  if (inProgress > 0) summaryParts.push(`${inProgress} running`);
  if (errored > 0) summaryParts.push(`${errored} failed`);
  const pending = total - completed - inProgress - errored;
  if (pending > 0) summaryParts.push(`${pending} pending`);
  const summaryLine = summaryParts.join(` ${MISC.separator} `);

  return (
    <box flexDirection="column" paddingLeft={SPACING.INDENT} paddingRight={SPACING.INDENT} marginTop={SPACING.ELEMENT} flexShrink={0}>
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

        {/* Session ID */}
        {sessionId && (
          <text wrapMode="none">
            <span style={{ fg: themeColors.dim }}>{`session ${sessionId}`}</span>
          </text>
        )}

        {/* Task list */}
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
