import type { TaskItem } from "./task-list-indicator.tsx";

function normalizeTaskId(id: string | undefined): string | null {
  const raw = typeof id === "string" ? id.trim() : "";
  if (!raw) return null;

  const withoutHashes = raw.replace(/^#+/, "").trim();
  if (!withoutHashes) return null;

  return `#${withoutHashes}`;
}

/**
 * Sort tasks so dependencies appear before dependent tasks.
 *
 * Tasks with invalid dependency metadata (missing/duplicate IDs, unknown blockers,
 * or cycles) are appended at the end in their original relative order.
 */
export function sortTasksTopologically(tasks: TaskItem[]): TaskItem[] {
  if (tasks.length <= 1) return [...tasks];

  const normalizedIds = tasks.map((task) => normalizeTaskId(task.id));
  const idCounts = new Map<string, number>();
  for (const id of normalizedIds) {
    if (!id) continue;
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const unresolved = Array.from({ length: tasks.length }, () => false);

  for (let i = 0; i < tasks.length; i++) {
    const id = normalizedIds[i];
    if (!id || (idCounts.get(id) ?? 0) > 1) {
      unresolved[i] = true;
    }
  }

  const idToIndex = new Map<string, number>();
  for (let i = 0; i < tasks.length; i++) {
    if (unresolved[i]) continue;
    const id = normalizedIds[i];
    if (!id) continue;
    idToIndex.set(id, i);
  }

  const blockersByIndex = new Map<number, string[]>();
  for (let i = 0; i < tasks.length; i++) {
    if (unresolved[i]) continue;
    const task = tasks[i];
    if (!task) continue;

    const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : [];
    const normalizedBlockers = Array.from(
      new Set(
        blockedBy
          .map((blockerId) => normalizeTaskId(blockerId))
          .filter((id): id is string => id !== null),
      ),
    );

    if (normalizedBlockers.some((blockerId) => !idToIndex.has(blockerId))) {
      unresolved[i] = true;
      continue;
    }

    blockersByIndex.set(i, normalizedBlockers);
  }

  const candidates: number[] = [];
  for (let i = 0; i < tasks.length; i++) {
    if (!unresolved[i]) candidates.push(i);
  }

  if (candidates.length === 0) return [...tasks];

  const indegree = new Map<number, number>();
  const edges = new Map<number, number[]>();

  for (const index of candidates) {
    const blockers = blockersByIndex.get(index) ?? [];
    indegree.set(index, blockers.length);

    for (const blockerId of blockers) {
      const blockerIndex = idToIndex.get(blockerId);
      if (blockerIndex === undefined) continue;

      const dependents = edges.get(blockerIndex);
      if (dependents) {
        dependents.push(index);
      } else {
        edges.set(blockerIndex, [index]);
      }
    }
  }

  const queue = candidates.filter((index) => (indegree.get(index) ?? 0) === 0);
  const sorted: number[] = [];

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    if (index === undefined) continue;
    sorted.push(index);

    const dependents = edges.get(index) ?? [];
    for (const dependentIndex of dependents) {
      const nextIndegree = (indegree.get(dependentIndex) ?? 0) - 1;
      indegree.set(dependentIndex, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(dependentIndex);
      }
    }
  }

  const sortedSet = new Set(sorted);
  const unresolvedTail = tasks.filter((_, index) => !sortedSet.has(index));
  const sortedTasks = sorted.flatMap((index) => {
    const task = tasks[index];
    return task ? [task] : [];
  });

  return [...sortedTasks, ...unresolvedTail];
}

/**
 * Filter tasks to get only those that are ready to execute.
 *
 * A task is "ready" if:
 * - Its status is "pending"
 * - All of its blockedBy dependencies have status "completed"
 *
 * Returns tasks in their original order. Use sortTasksTopologically first
 * if you need them in dependency order.
 */
export function getReadyTasks(tasks: TaskItem[]): TaskItem[] {
  // Build a map from normalized task IDs to their status
  const statusByNormalizedId = new Map<string, TaskItem["status"]>();
  
  for (const task of tasks) {
    const normalizedId = normalizeTaskId(task.id);
    if (normalizedId) {
      statusByNormalizedId.set(normalizedId, task.status);
    }
  }

  // Filter tasks to find ready ones
  const readyTasks: TaskItem[] = [];

  for (const task of tasks) {
    // Must be pending
    if (task.status !== "pending") {
      continue;
    }

    // Get normalized blockers
    const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : [];
    const normalizedBlockers = blockedBy
      .map((blockerId) => normalizeTaskId(blockerId))
      .filter((id): id is string => id !== null);

    // Check if all blockers are completed
    const allBlockersCompleted = normalizedBlockers.every((blockerId) => {
      const status = statusByNormalizedId.get(blockerId);
      return status === "completed";
    });

    // If there are no blockers or all blockers are completed, task is ready
    if (normalizedBlockers.length === 0 || allBlockersCompleted) {
      readyTasks.push(task);
    }
  }

  return readyTasks;
}
