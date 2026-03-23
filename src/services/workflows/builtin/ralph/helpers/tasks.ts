import { z } from "zod";
import {
  normalizeWorkflowRuntimeTaskStatus,
  type WorkflowRuntimeTask,
} from "@/services/workflows/runtime-contracts.ts";
import type { TaskItem } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";

/**
 * Normalize a raw task object from LLM output, supporting both the current
 * schema (description/summary) and the legacy schema (content/activeForm).
 */
function normalizeRawTaskRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {};
  const record = raw as Record<string, unknown>;
  return {
    ...record,
    description: record.description ?? record.content,
    summary: record.summary ?? record.activeForm,
  };
}

const taskItemSchema = z.object({
  id: z.union([z.number(), z.string()]).optional().transform((val) => {
    if (val === null || val === undefined) return undefined;
    return String(val);
  }),
  description: z.string().catch("Untitled task"),
  status: z.string().catch("pending"),
  summary: z.string().catch("Working on task"),
  blockedBy: z.array(
    z.union([z.number(), z.string()]).transform((val) => String(val)),
  ).optional().catch([]),
});

function extractJsonArray(text: string): unknown | null {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  const match = trimmed.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch { /* continue */ }
  }

  // Last resort: extract individual JSON objects when the array is malformed
  const objectMatches = [...trimmed.matchAll(/\{[^{}]*\}/g)];
  if (objectMatches.length > 0) {
    const recovered: unknown[] = [];
    for (const objMatch of objectMatches) {
      try {
        recovered.push(JSON.parse(objMatch[0]));
      } catch { /* skip malformed objects */ }
    }
    if (recovered.length > 0) return recovered;
  }

  return null;
}

export function parseTasks(content: string): TaskItem[] {
  const parsed = extractJsonArray(content);
  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  const tasks: TaskItem[] = [];
  for (const [index, item] of parsed.entries()) {
    const normalized = normalizeRawTaskRecord(item);
    const result = taskItemSchema.safeParse(normalized);
    if (result.success) {
      const task = result.data;
      tasks.push({
        id: task.id ?? String(index + 1),
        description: task.description,
        status: task.status,
        summary: task.summary,
        blockedBy: task.blockedBy,
      });
    }
  }

  return tasks;
}

/**
 * Normalize a task ID for consistent comparison.
 * Strips all leading '#' characters and lowercases.
 */
function normalizeId(id: string | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim().toLowerCase().replace(/^#+/, "").trim();
  return trimmed || null;
}

/**
 * Get normalized dependency IDs for a task.
 */
function normalizeDeps(blockedBy: string[] | undefined): string[] {
  return (blockedBy ?? [])
    .map((d) => normalizeId(d))
    .filter((d): d is string => d !== null);
}

/**
 * Compute the set of task IDs that are transitively blocked by errored tasks.
 *
 * Uses BFS from errored tasks through the forward dependency graph.
 * A task is error-propagated if it directly has "error" status, or any of
 * its transitive blockers has "error" status.
 */
function computeErrorPropagatedIds(
  tasks: TaskItem[],
  statusById: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  // Build forward dependency map: blocker → its dependents
  const dependentMap = new Map<string, string[]>();
  for (const task of tasks) {
    const taskId = normalizeId(task.id);
    if (!taskId) continue;
    for (const dep of normalizeDeps(task.blockedBy)) {
      let list = dependentMap.get(dep);
      if (!list) {
        list = [];
        dependentMap.set(dep, list);
      }
      list.push(taskId);
    }
  }

  // Seed BFS with directly errored tasks
  const propagated = new Set<string>();
  const queue: string[] = [];
  for (const [id, status] of statusById) {
    if (status === "error") {
      propagated.add(id);
      queue.push(id);
    }
  }

  // BFS: propagate error to all transitive dependents
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    for (const dependent of dependentMap.get(id) ?? []) {
      if (!propagated.has(dependent)) {
        propagated.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return propagated;
}

/**
 * Filter tasks to get only those that are ready to execute.
 *
 * A task is "ready" if:
 * 1. Its status is "pending"
 * 2. It is NOT transitively blocked by any errored task
 * 3. ALL of its blockedBy dependencies have status "completed"
 *
 * Error propagation: if task A has "error" status, all tasks that
 * transitively depend on A (directly or through intermediate tasks)
 * are excluded from the ready set — even if intermediate dependencies
 * have inconsistent statuses (e.g., "completed" despite an errored blocker).
 */
export function getReadyTasks(tasks: TaskItem[]): TaskItem[] {
  // Build normalized ID → status map
  const statusById = new Map<string, string>();
  for (const task of tasks) {
    const id = normalizeId(task.id);
    if (id) {
      statusById.set(id, task.status);
    }
  }

  // Compute transitive error propagation set
  const errorPropagated = computeErrorPropagatedIds(tasks, statusById);

  return tasks.filter((task) => {
    if (task.status !== "pending") return false;

    // Exclude tasks transitively blocked by errored dependencies
    const taskId = normalizeId(task.id);
    if (taskId && errorPropagated.has(taskId)) return false;

    // All blockers must be completed
    const deps = normalizeDeps(task.blockedBy);
    return deps.every((d) => statusById.get(d) === "completed");
  });
}

/**
 * Check whether any tasks are actionable (in-progress or ready to execute).
 */
export function hasActionableTasks(tasks: TaskItem[]): boolean {
  if (tasks.some((t) => t.status === "in_progress")) return true;
  return getReadyTasks(tasks).length > 0;
}

export function stripPriorityPrefix(title: string): string {
  return title.replace(/^\s*\[(?:P\d|p\d)\]\s*/u, "").trim();
}

export function toRuntimeTask(task: TaskItem, fallbackId: string): WorkflowRuntimeTask {
  return {
    id: task.id ?? fallbackId,
    title: task.description,
    status: normalizeWorkflowRuntimeTaskStatus(task.status),
    blockedBy: task.blockedBy,
    identity: task.identity,
    taskResult: task.taskResult,
  };
}

export function applyRuntimeTask(task: TaskItem, runtimeTask: WorkflowRuntimeTask): TaskItem {
  const taskResult = runtimeTask.taskResult ?? task.taskResult;
  return {
    ...task,
    id: runtimeTask.id,
    status: runtimeTask.status,
    blockedBy: runtimeTask.blockedBy,
    identity: runtimeTask.identity,
    ...(taskResult ? { taskResult } : {}),
  };
}

export function buildReviewFixTasks(findings: ReadonlyArray<{
  title?: string;
  body?: string;
}>): TaskItem[] {
  if (findings.length === 0) {
    return [{
      id: "#review-fix-1",
      description: "Address review feedback",
      status: "pending",
      summary: "Addressing review feedback",
      blockedBy: [],
    }];
  }

  return findings.map((finding, index) => {
    const fallback = `Address review finding ${index + 1}`;
    const normalizedTitle = typeof finding.title === "string"
      ? stripPriorityPrefix(finding.title)
      : "";
    const description = normalizedTitle.length > 0 ? normalizedTitle : fallback;

    return {
      id: `#review-fix-${index + 1}`,
      description,
      status: "pending",
      summary: `Addressing ${description}`,
      blockedBy: [],
    } satisfies TaskItem;
  });
}
