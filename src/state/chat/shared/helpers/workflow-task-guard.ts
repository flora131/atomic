/**
 * Generic TodoWrite filtering guard.
 *
 * Determines whether an incoming set of todo items belongs to the active
 * workflow's task list.  This replaces the former Ralph-specific
 * `isRalphTaskUpdate` callback with a workflow-agnostic pure function
 * that any workflow conductor can use.
 *
 * NOTE (2026-03-30): The Ralph workflow now uses the SQLite-backed `task_list`
 * tool, which is session-scoped and does not need this guard. However, this
 * guard is still required for:
 *   1. Non-Ralph workflows that still use TodoWrite for task management.
 *   2. The `finalizeTaskItemsOnInterrupt` callback in `use-app-orchestration.ts`,
 *      which uses it to decide whether interrupted tasks should be saved.
 * Do NOT remove this guard until all TodoWrite usage is eliminated.
 */

import { hasWorkflowTaskIdOverlap } from "@/state/chat/shared/helpers/workflow-task-state.ts";

/**
 * Returns `true` when `todos` are recognized as an update to the current
 * workflow task set identified by `activeWorkflowTaskIds`.
 *
 * The check is format-tolerant (`#1` and `1` are treated as equivalent) and
 * falls back to description-based matching when incoming items lack explicit
 * IDs — provided `previousTasks` are supplied for anchoring.
 *
 * @param todos           - Incoming todo items (e.g. from a TodoWrite tool call).
 * @param activeWorkflowTaskIds - The task IDs owned by the running workflow.
 * @param previousTasks   - Optional prior task state for description-based matching.
 */
export function isWorkflowTaskUpdate<T extends { id?: string; description?: string }>(
  todos: readonly T[],
  activeWorkflowTaskIds: ReadonlySet<string>,
  previousTasks: readonly { description: string }[] = [],
): boolean {
  return hasWorkflowTaskIdOverlap(todos, activeWorkflowTaskIds, previousTasks);
}
