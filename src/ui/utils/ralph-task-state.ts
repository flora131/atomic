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

export interface RalphTaskSnapshotMessage {
  role: string;
  taskItems?: RalphTaskStateItem[];
}

function normalizeRalphTaskId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

function stripLeadingTaskPrefixes(content: string): string {
  const prefixPattern = /^(?:(?:[-*]\s+)|(?:\[(?: |x)\]\s+)|(?:[✓✔☑●○◉]\s+)|(?:#?\d+(?:[.):-])?\s+))/i;
  let current = content;
  while (true) {
    const next = current.replace(prefixPattern, "");
    if (next === current) break;
    current = next;
  }
  return current.trim();
}

function extractLeadingTaskId(content: string): string | undefined {
  const normalized = content.trim().toLowerCase();
  const match = normalized.match(
    /^(?:[-*]\s+)?(?:\[(?: |x)\]\s+)?(?:[✓✔☑●○◉]\s+)?#?(\d+)\b/i,
  );
  return match?.[1];
}

function normalizeTaskContent(content: string): string {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  return stripLeadingTaskPrefixes(normalized);
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

    const maybeContent = (todo as { content?: unknown }).content;
    const content = typeof maybeContent === "string" ? maybeContent : "";
    const extractedId = extractLeadingTaskId(content);
    if (extractedId) {
      if (normalizedKnownIds.size > 0 && !normalizedKnownIds.has(extractedId)) {
        return false;
      }
      hasAnchoredMatch = true;
      continue;
    }

    if (previousContentKeys.size === 0) {
      continue;
    }

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

function hasInProgressTasks(tasks: readonly RalphTaskStateItem[]): boolean {
  return tasks.some((task) => task.status === "in_progress");
}

/**
 * Prefer the more terminal task set when lifecycle cleanup races with file-watch updates.
 *
 * If one source still reports in_progress tasks while the other does not, prefer the
 * source without in_progress so stale last-item snapshots do not survive cleanup.
 */
export function preferTerminalTaskItems<T extends RalphTaskStateItem>(
  inMemoryTasks: readonly T[],
  diskTasks: readonly T[],
): T[] {
  const memoryHasInProgress = hasInProgressTasks(inMemoryTasks);
  const diskHasInProgress = hasInProgressTasks(diskTasks);

  if (memoryHasInProgress !== diskHasInProgress) {
    return memoryHasInProgress ? [...diskTasks] : [...inMemoryTasks];
  }

  if (diskTasks.length > 0) {
    return [...diskTasks];
  }

  return [...inMemoryTasks];
}

/**
 * Apply a terminal task snapshot to the latest assistant message so stale
 * in_progress rows do not remain visible after workflow cleanup.
 */
export function applyTaskSnapshotToLatestAssistantMessage<
  TMessage extends RalphTaskSnapshotMessage,
  TTask extends RalphTaskStateItem,
>(
  messages: readonly TMessage[],
  tasks: readonly TTask[],
): TMessage[] {
  const snapshot = snapshotTaskItems(tasks);
  if (!snapshot) return [...messages];

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;

    const nextMessages = [...messages];
    nextMessages[index] = {
      ...message,
      taskItems: snapshot,
    } as TMessage;
    return nextMessages;
  }

  return [...messages];
}
