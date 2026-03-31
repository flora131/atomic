import { sortTasksTopologically } from "@/components/task-order.ts";
import type { WorkflowRuntimeTaskIdentity, WorkflowRuntimeTaskResultEnvelope } from "@/services/workflows/runtime-contracts.ts";

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
  description: string;
  status: TaskStatus;
  blockedBy?: string[];
  identity?: WorkflowRuntimeTaskIdentity;
  taskResult?: WorkflowRuntimeTaskResultEnvelope;
}

export interface NormalizedTodoItem extends NormalizedTaskItem {
  summary: string;
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

function normalizeTaskIdentity(value: unknown): NormalizedTaskItem["identity"] {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const canonicalId = typeof record.canonicalId === "string" && record.canonicalId.length > 0
    ? record.canonicalId
    : undefined;

  let providerBindings: Record<string, string[]> | undefined;
  if (typeof record.providerBindings === "object" && record.providerBindings !== null) {
    providerBindings = {};
    for (const [provider, ids] of Object.entries(record.providerBindings as Record<string, unknown>)) {
      if (!Array.isArray(ids) || provider.length === 0) {
        continue;
      }

      const normalizedIds = Array.from(new Set(
        ids
          .filter((id) => id !== null && id !== undefined)
          .map((id) => String(id))
          .filter((id) => id.length > 0),
      ));

      if (normalizedIds.length > 0) {
        providerBindings[provider] = normalizedIds;
      }
    }

    if (Object.keys(providerBindings).length === 0) {
      providerBindings = undefined;
    }
  }

  if (!canonicalId && !providerBindings) {
    return undefined;
  }

  return {
    canonicalId,
    providerBindings,
  };
}

function normalizeTaskResultEnvelope(value: unknown): WorkflowRuntimeTaskResultEnvelope | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const taskId = typeof record.task_id === "string" && record.task_id.length > 0
    ? record.task_id
    : undefined;
  if (!taskId) {
    return undefined;
  }

  const toolName = typeof record.tool_name === "string" && record.tool_name.length > 0
    ? record.tool_name
    : "task";
  const title = typeof record.title === "string" ? record.title : "";
  const outputText = typeof record.output_text === "string" ? record.output_text : "";
  const status: WorkflowRuntimeTaskResultEnvelope["status"] = record.status === "error" ? "error" : "completed";

  let metadata: WorkflowRuntimeTaskResultEnvelope["metadata"];
  if (typeof record.metadata === "object" && record.metadata !== null) {
    const metadataRecord = record.metadata as Record<string, unknown>;
    const sessionId = typeof metadataRecord.sessionId === "string" && metadataRecord.sessionId.length > 0
      ? metadataRecord.sessionId
      : undefined;

    let providerBindings: Record<string, string> | undefined;
    if (typeof metadataRecord.providerBindings === "object" && metadataRecord.providerBindings !== null) {
      providerBindings = {};
      for (const [provider, providerId] of Object.entries(metadataRecord.providerBindings as Record<string, unknown>)) {
        const normalizedProvider = provider.trim();
        const normalizedProviderId = typeof providerId === "string" ? providerId.trim() : String(providerId ?? "").trim();
        if (normalizedProvider.length === 0 || normalizedProviderId.length === 0) {
          continue;
        }
        providerBindings[normalizedProvider] = normalizedProviderId;
      }
      if (Object.keys(providerBindings).length === 0) {
        providerBindings = undefined;
      }
    }

    if (sessionId || providerBindings) {
      metadata = {
        ...(sessionId ? { sessionId } : {}),
        ...(providerBindings ? { providerBindings } : {}),
      };
    }
  }

  const outputStructured = typeof record.output_structured === "object"
    && record.output_structured !== null
    && !Array.isArray(record.output_structured)
    ? record.output_structured as Record<string, unknown>
    : undefined;

  return {
    task_id: taskId,
    tool_name: toolName,
    title,
    ...(metadata ? { metadata } : {}),
    status,
    output_text: outputText,
    ...(outputStructured ? { output_structured: outputStructured } : {}),
    ...(typeof record.error === "string" && record.error.length > 0 ? { error: record.error } : {}),
    ...(typeof record.envelope_text === "string" && record.envelope_text.length > 0
      ? { envelope_text: record.envelope_text }
      : {}),
  };
}

function normalizeStableTaskDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDependencyTaskId(id: string | undefined): string | undefined {
  if (typeof id !== "string") return undefined;
  const normalized = id.trim().toLowerCase().replace(/^#/, "");
  return normalized.length > 0 ? normalized : undefined;
}

function getStableTaskKey(task: { id?: string; description: string }): string {
  const normalizedId = task.id?.trim().toLowerCase();
  if (normalizedId) {
    return `id:${normalizedId}`;
  }

  const normalizedDescription = normalizeStableTaskDescription(task.description);
  if (normalizedDescription.length > 0) {
    return `description:${normalizedDescription}`;
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
  const identity = normalizeTaskIdentity(record.identity);
  const taskResult = normalizeTaskResultEnvelope(record.taskResult ?? record.task_result);
  return {
    id: normalizeId(record.id),
    description: String(record.description ?? record.content ?? ""),
    status: normalizeTaskStatus(record.status),
    blockedBy: normalizeBlockedBy(record.blockedBy),
    ...(identity ? { identity } : {}),
    ...(taskResult ? { taskResult } : {}),
  };
}

export function normalizeTodoItem(input: unknown): NormalizedTodoItem {
  const normalized = normalizeTaskItem(input);
  const record = asRecord(input);

  return {
    ...normalized,
    summary: String(record.summary ?? record.activeForm ?? ""),
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
  const prevByDescription = new Map<string, NormalizedTaskItem>();
  for (const task of previous) {
    const id = normalizeDependencyTaskId(task.id);
    if (id && task.blockedBy) {
      prevBlockedById.set(id, task.blockedBy);
    }

    const descriptionKey = task.description.trim().toLowerCase().replace(/\s+/g, " ");
    if (descriptionKey.length > 0 && !prevByDescription.has(descriptionKey)) {
      prevByDescription.set(descriptionKey, task);
    }
  }

  if (prevBlockedById.size === 0 && prevByDescription.size === 0) return updated;

  return updated.map((task) => {
    const hasExplicitId =
      typeof task.id === "string" && task.id.trim().length > 0;
    const descriptionKey = task.description.trim().toLowerCase().replace(/\s+/g, " ");
    const prevByMatchingDescription = descriptionKey.length > 0
      ? prevByDescription.get(descriptionKey)
      : undefined;

    const restoredId = hasExplicitId ? task.id : prevByMatchingDescription?.id;
    const normalizedId = normalizeDependencyTaskId(restoredId);

    const restoredBlockedBy = task.blockedBy
      ?? (normalizedId ? prevBlockedById.get(normalizedId) : undefined)
      ?? (!hasExplicitId ? prevByMatchingDescription?.blockedBy : undefined);

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
 *
 * NOTE (2026-03-30): Only used by the TodoWrite code path in
 * `use-tool-events.ts`. The Ralph workflow now uses the `task_list` tool,
 * which handles normalization and persistence internally. This function is
 * retained for non-Ralph contexts that still use TodoWrite.
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
