import type { WorkflowRuntimeTask } from "@/services/workflows/runtime-contracts.ts";
import type { TaskItem } from "@/services/workflows/ralph/prompts.ts";

export function parseTasks(content: string): TaskItem[] {
  const trimmed = content.trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        /* ignore */
      }
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  return parsed as TaskItem[];
}

export function getReadyTasks(tasks: TaskItem[]): TaskItem[] {
  const completedIds = new Set(
    tasks
      .filter((t) => t.status === "completed" || t.status === "complete" || t.status === "done")
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
    title: task.content,
    status: task.status,
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
      content: "Address review feedback",
      status: "pending",
      activeForm: "Addressing review feedback",
      blockedBy: [],
    }];
  }

  return findings.map((finding, index) => {
    const fallback = `Address review finding ${index + 1}`;
    const normalizedTitle = typeof finding.title === "string"
      ? stripPriorityPrefix(finding.title)
      : "";
    const content = normalizedTitle.length > 0 ? normalizedTitle : fallback;

    return {
      id: `#review-fix-${index + 1}`,
      content,
      status: "pending",
      activeForm: `Addressing ${content}`,
      blockedBy: [],
    } satisfies TaskItem;
  });
}
