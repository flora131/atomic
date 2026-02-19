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

function normalizeRalphTaskId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

function normalizeTaskContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * True when any incoming todo item belongs to the current ralph task set.
 * ID matching is format-tolerant (`#1` and `1` are treated as equivalent).
 */
export function hasRalphTaskIdOverlap<T extends { id?: string }>(
  todos: readonly T[],
  knownTaskIds: ReadonlySet<string>,
  previousTasks: readonly { content: string }[] = [],
): boolean {
  if (todos.length === 0) return false;

  const normalizedKnownIds = new Set(
    Array.from(knownTaskIds)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map(normalizeRalphTaskId),
  );

  const previousContentKeys = new Set(
    previousTasks
      .map((task) => normalizeTaskContent(task.content))
      .filter((content) => content.length > 0),
  );

  let hasAnchoredMatch = false;

  for (const todo of todos) {
    const rawId = todo.id;
    if (typeof rawId === "string" && rawId.trim().length > 0) {
      const normalizedId = normalizeRalphTaskId(rawId);
      if (normalizedKnownIds.size > 0 && !normalizedKnownIds.has(normalizedId)) {
        return false;
      }
      hasAnchoredMatch = true;
      continue;
    }

    if (previousContentKeys.size === 0) {
      continue;
    }

    const maybeContent = (todo as { content?: unknown }).content;
    const contentKey = typeof maybeContent === "string"
      ? normalizeTaskContent(maybeContent)
      : "";

    if (contentKey.length === 0 || !previousContentKeys.has(contentKey)) {
      return false;
    }
    hasAnchoredMatch = true;
  }

  return hasAnchoredMatch;
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
