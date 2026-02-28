import { sortTasksTopologically } from "../components/task-order.ts";

/**
 * Task status normalization helpers.
 *
 * Task lists can be loaded from model output and persisted JSON, so runtime
 * normalization is required before rendering to avoid undefined icon/color lookups.
 */

export const TASK_STATUS_VALUES = [
  "pending",
  "in_progress",
  "completed",
  "error",
] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

const TASK_STATUS_ALIASES: Record<string, TaskStatus> = {
  pending: "pending",
  todo: "pending",
  open: "pending",
  not_started: "pending",
  in_progress: "in_progress",
  inprogress: "in_progress",
  doing: "in_progress",
  running: "in_progress",
  active: "in_progress",
  completed: "completed",
  complete: "completed",
  done: "completed",
  success: "completed",
  succeeded: "completed",
  error: "error",
  failed: "error",
  failure: "error",
};

export interface NormalizedTaskItem {
  id?: string;
  content: string;
  status: TaskStatus;
  blockedBy?: string[];
}

export interface NormalizedTodoItem extends NormalizedTaskItem {
  activeForm: string;
}

function normalizeStatusToken(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeToolNameToken(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? input as Record<string, unknown>
    : {};
}

function normalizeId(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = String(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBlockedBy(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item) => item !== null && item !== undefined)
    .map((item) => String(item))
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStableTaskContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDependencyTaskId(id: string | undefined): string | undefined {
  if (typeof id !== "string") return undefined;
  const normalized = id.trim().toLowerCase().replace(/^#/, "");
  return normalized.length > 0 ? normalized : undefined;
}

function getStableTaskKey(task: { id?: string; content: string }): string {
  const normalizedId = task.id?.trim().toLowerCase();
  if (normalizedId) {
    return `id:${normalizedId}`;
  }

  const normalizedContent = normalizeStableTaskContent(task.content);
  if (normalizedContent.length > 0) {
    return `content:${normalizedContent}`;
  }

  return "";
}

function stabilizeByPreviousOrder<T extends NormalizedTaskItem>(
  tasks: readonly T[],
  previous: readonly NormalizedTaskItem[],
): T[] {
  if (tasks.length <= 1 || previous.length === 0) {
    return [...tasks];
  }

  const previousRank = new Map<string, number>();
  for (let index = 0; index < previous.length; index++) {
    const task = previous[index];
    if (!task) continue;
    const key = getStableTaskKey(task);
    if (!key || previousRank.has(key)) continue;
    previousRank.set(key, index);
  }

  if (previousRank.size === 0) {
    return [...tasks];
  }

  return [...tasks].sort((left, right) => {
    const leftRank = previousRank.get(getStableTaskKey(left));
    const rightRank = previousRank.get(getStableTaskKey(right));

    if (leftRank === undefined && rightRank === undefined) return 0;
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  });
}

export function isTaskStatus(status: unknown): status is TaskStatus {
  if (typeof status !== "string") {
    return false;
  }
  const normalized = normalizeStatusToken(status);
  return normalized in TASK_STATUS_ALIASES;
}

export function normalizeTaskStatus(status: unknown): TaskStatus {
  if (typeof status !== "string") {
    return "pending";
  }

  const normalized = normalizeStatusToken(status);
  return TASK_STATUS_ALIASES[normalized] ?? "pending";
}

export function isTodoWriteToolName(name: unknown): boolean {
  if (typeof name !== "string") {
    return false;
  }
  return normalizeToolNameToken(name) === "todowrite";
}

export function normalizeTaskItem(input: unknown): NormalizedTaskItem {
  const record = asRecord(input);
  return {
    id: normalizeId(record.id),
    content: String(record.content ?? ""),
    status: normalizeTaskStatus(record.status),
    blockedBy: normalizeBlockedBy(record.blockedBy),
  };
}

export function normalizeTodoItem(input: unknown): NormalizedTodoItem {
  const normalized = normalizeTaskItem(input);
  const record = asRecord(input);

  return {
    ...normalized,
    activeForm: String(record.activeForm ?? ""),
  };
}

export function normalizeTaskItems(input: unknown): NormalizedTaskItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((item) => normalizeTaskItem(item));
}

export function normalizeTodoItems(input: unknown): NormalizedTodoItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((item) => normalizeTodoItem(item));
}

/**
 * Merge task metadata from previous state into newly normalized tasks.
 *
 * When an agent calls TodoWrite to update task progress it often omits the
 * optional `blockedBy` field, causing dependency info to be lost. This
 * function restores `blockedBy` (and missing `id` values) from `previous`
 * when the update omits them.
 *
 * Tasks are matched by normalized ID first, then by normalized content.
 */
export function mergeBlockedBy<T extends NormalizedTaskItem>(
  updated: T[],
  previous: readonly NormalizedTaskItem[],
): T[] {
  if (previous.length === 0) return updated;

  // Build a lookup from normalized ID → blockedBy from the previous state
  const prevBlockedById = new Map<string, string[]>();
  const prevByContent = new Map<string, NormalizedTaskItem>();
  for (const task of previous) {
    const id = normalizeDependencyTaskId(task.id);
    if (id && task.blockedBy) {
      prevBlockedById.set(id, task.blockedBy);
    }

    const contentKey = task.content.trim().toLowerCase().replace(/\s+/g, " ");
    if (contentKey.length > 0 && !prevByContent.has(contentKey)) {
      prevByContent.set(contentKey, task);
    }
  }

  if (prevBlockedById.size === 0 && prevByContent.size === 0) return updated;

  return updated.map((task) => {
    const hasExplicitId =
      typeof task.id === "string" && task.id.trim().length > 0;
    const contentKey = task.content.trim().toLowerCase().replace(/\s+/g, " ");
    const prevByMatchingContent = contentKey.length > 0
      ? prevByContent.get(contentKey)
      : undefined;

    const restoredId = hasExplicitId ? task.id : prevByMatchingContent?.id;
    const normalizedId = normalizeDependencyTaskId(restoredId);

    const restoredBlockedBy = task.blockedBy
      ?? (normalizedId ? prevBlockedById.get(normalizedId) : undefined)
      ?? (!hasExplicitId ? prevByMatchingContent?.blockedBy : undefined);

    if (restoredId === task.id && restoredBlockedBy === task.blockedBy) {
      return task;
    }

    return {
      ...task,
      id: restoredId,
      blockedBy: restoredBlockedBy,
    };
  });
}

/**
 * Normalize a TodoWrite payload, restore missing dependency metadata, and
 * apply a stable dependency-aware order for rendering.
 */
export function reconcileTodoWriteItems(
  incomingTodos: unknown,
  previous: readonly NormalizedTodoItem[] = [],
): NormalizedTodoItem[] {
  const normalized = normalizeTodoItems(incomingTodos);
  const merged = mergeBlockedBy(normalized, previous);
  const stabilized = stabilizeByPreviousOrder(merged, previous);
  return sortTasksTopologically(stabilized);
}
