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
