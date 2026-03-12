import { z } from "zod";
import {
  normalizeWorkflowRuntimeTaskStatus,
  type WorkflowRuntimeTask,
} from "@/services/workflows/runtime-contracts.ts";
import type { TaskItem } from "@/services/workflows/ralph/prompts.ts";

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

export function getReadyTasks(tasks: TaskItem[]): TaskItem[] {
  const completedIds = new Set(
    tasks
      .filter((t) => t.status === "completed")
      .map((t) => t.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => id.trim().toLowerCase().replace(/^#/, ""))
  );

  return tasks.filter((task) => {
    if (task.status !== "pending") return false;
    const deps = (task.blockedBy ?? [])
      .map((d) => d.trim().toLowerCase().replace(/^#/, ""))
      .filter((d) => d.length > 0);
    return deps.every((d) => completedIds.has(d));
  });
}

export function hasActionableTasks(tasks: TaskItem[]): boolean {
  return tasks.some((task) => {
    if (task.status === "in_progress") return true;
    if (task.status !== "pending") return false;
    return getReadyTasks([...tasks]).some((t) => t.id === task.id);
  });
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
