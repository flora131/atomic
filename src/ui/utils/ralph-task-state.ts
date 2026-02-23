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

export interface TaskIdValidationResult {
  valid: boolean;
  matchedIds: string[];
  unknownIds: string[];
  knownIds: string[];
  errorMessage?: string;
}

export function normalizeRalphTaskId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function extractLeadingTaskId(content: string): string | undefined {
  const normalized = content.trim().toLowerCase();
  const match = normalized.match(
    /^(?:[-*]\s+)?(?:\[(?: |x)\]\s+)?(?:[✓✔☑●○◉]\s+)?#?(\d+)\b/i,
  );
  return match ? `#${match[1]}` : undefined;
}

export function validateRalphTaskIds<T extends { id?: string; content?: string }>(
  todos: readonly T[],
  knownTaskIds: ReadonlySet<string>,
): TaskIdValidationResult {
  if (todos.length === 0) {
    const knownIds = Array.from(knownTaskIds).map(normalizeRalphTaskId);
    return {
      valid: false,
      matchedIds: [],
      unknownIds: [],
      knownIds,
      errorMessage: "TodoWrite payload is empty.",
    };
  }

  const normalizedKnownIds = new Set(
    Array.from(knownTaskIds)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map(normalizeRalphTaskId),
  );

  const matchedIds: string[] = [];
  const unknownIds: string[] = [];

  for (const todo of todos) {
    const rawId = todo.id;
    if (typeof rawId === "string" && rawId.trim().length > 0) {
      const normalizedId = normalizeRalphTaskId(rawId);
      if (normalizedKnownIds.has(normalizedId)) {
        matchedIds.push(normalizedId);
      } else {
        unknownIds.push(rawId);
      }
      continue;
    }

    const content = typeof todo.content === "string" ? todo.content : "";
    const extractedId = extractLeadingTaskId(content);
    if (extractedId && normalizedKnownIds.has(extractedId)) {
      matchedIds.push(extractedId);
      continue;
    }

    unknownIds.push(rawId ?? "(no id)");
  }

  const knownIds = Array.from(normalizedKnownIds);
  if (unknownIds.length > 0) {
    return {
      valid: false,
      matchedIds,
      unknownIds,
      knownIds,
      errorMessage:
        `TodoWrite rejected: ${unknownIds.length} item(s) have unknown task IDs: ` +
        `[${unknownIds.join(", ")}]. Valid ralph task IDs are: [${knownIds.join(", ")}]. ` +
        "Please retry using only valid task IDs.",
    };
  }

  return {
    valid: true,
    matchedIds,
    unknownIds: [],
    knownIds,
  };
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
      : task,
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
