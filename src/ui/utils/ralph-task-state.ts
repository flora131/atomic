/**
 * Ralph task-state helpers used by interrupt/resume and message snapshots.
 */

export type RalphTaskStatus = "pending" | "in_progress" | "completed" | "error";

export interface RalphTaskStateItem {
  id?: string;
  content: string;
  status: RalphTaskStatus;
  blockedBy?: string[];
}

/**
 * Convert interrupted in-progress work back to pending so it stays unchecked/retryable.
 */
export function normalizeInterruptedTasks<T extends RalphTaskStateItem>(
  tasks: readonly T[],
): T[] {
  return tasks.map((task) =>
    task.status === "in_progress"
      ? ({ ...task, status: "pending" } as T)
      : task
  );
}

/**
 * Capture task items for message snapshots without mutating semantic status.
 */
export function snapshotTaskItems(
  tasks: readonly RalphTaskStateItem[],
): RalphTaskStateItem[] | undefined {
  if (tasks.length === 0) return undefined;
  return tasks.map((task) => ({
    id: task.id,
    content: task.content,
    status: task.status,
    blockedBy: task.blockedBy,
  }));
}
