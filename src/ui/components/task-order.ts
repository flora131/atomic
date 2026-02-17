import type { TaskItem } from "./task-list-indicator.tsx";

function normalizeTaskId(id: string | undefined): string | null {
  const raw = typeof id === "string" ? id.trim() : "";
  if (!raw) return null;

  const withoutHashes = raw.replace(/^#+/, "").trim();
  if (!withoutHashes) return null;

  return `#${withoutHashes}`;
}

/**
 * Result type for deadlock detection.
 */
export type DeadlockDiagnostic =
  | { type: "none" }
  | { type: "cycle"; cycle: string[] }
  | { type: "error_dependency"; taskId: string; errorDependencies: string[] };

/**
 * Detect deadlocks in task dependencies.
 *
 * Returns:
 * - { type: "cycle", cycle: [...] } if there's a dependency cycle
 * - { type: "error_dependency", taskId, errorDependencies } if a pending task depends on errored tasks
 * - { type: "none" } if no deadlock is detected
 *
 * Priority: cycles are checked first, then error dependencies.
 */
export function detectDeadlock(tasks: TaskItem[]): DeadlockDiagnostic {
  if (tasks.length === 0) return { type: "none" };

  // Build normalized ID map and status map
  const normalizedIds = tasks.map((task) => normalizeTaskId(task.id));
  const idCounts = new Map<string, number>();
  for (const id of normalizedIds) {
    if (!id) continue;
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  // Mark tasks with invalid IDs (missing or duplicate)
  const valid = Array.from({ length: tasks.length }, () => false);
  for (let i = 0; i < tasks.length; i++) {
    const id = normalizedIds[i];
    if (id && (idCounts.get(id) ?? 0) === 1) {
      valid[i] = true;
    }
  }

  // Build ID to index mapping for valid tasks
  const idToIndex = new Map<string, number>();
  const statusByNormalizedId = new Map<string, TaskItem["status"]>();
  for (let i = 0; i < tasks.length; i++) {
    if (!valid[i]) continue;
    const id = normalizedIds[i];
    if (!id) continue;
    const task = tasks[i];
    if (!task) continue;
    idToIndex.set(id, i);
    statusByNormalizedId.set(id, task.status);
  }

  // Build adjacency list for valid tasks only
  const adjList = new Map<number, number[]>();
  const blockersByTaskIndex = new Map<number, string[]>();

  for (let i = 0; i < tasks.length; i++) {
    if (!valid[i]) continue;
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

    blockersByTaskIndex.set(i, normalizedBlockers);

    // Only add edges for blockers that exist in the valid task set
    const validBlockers = normalizedBlockers.filter((blockerId) =>
      idToIndex.has(blockerId),
    );
    
    for (const blockerId of validBlockers) {
      const blockerIndex = idToIndex.get(blockerId);
      if (blockerIndex === undefined) continue;

      // Add edge from dependent task to blocker (reversed for cycle detection)
      if (!adjList.has(i)) {
        adjList.set(i, []);
      }
      adjList.get(i)?.push(blockerIndex);
    }
  }

  // Detect cycles using DFS
  const visited = new Set<number>();
  const recursionStack = new Set<number>();
  const parent = new Map<number, number>();

  function dfsCycle(node: number): string[] | null {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = adjList.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        parent.set(neighbor, node);
        const cycle = dfsCycle(neighbor);
        if (cycle) return cycle;
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle, reconstruct it
        const cycle: number[] = [neighbor];
        let current = node;
        while (current !== neighbor) {
          cycle.push(current);
          const p = parent.get(current);
          if (p === undefined) break;
          current = p;
        }
        cycle.reverse();
        
        // Convert indices to task IDs
        return cycle
          .map((idx) => normalizedIds[idx])
          .filter((id): id is string => id !== null);
      }
    }

    recursionStack.delete(node);
    return null;
  }

  // Check all valid tasks for cycles
  for (let i = 0; i < tasks.length; i++) {
    if (!valid[i]) continue;
    if (visited.has(i)) continue;
    
    const cycle = dfsCycle(i);
    if (cycle && cycle.length > 0) {
      return { type: "cycle", cycle };
    }
  }

  // Check for error dependencies (pending tasks that depend on error tasks)
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (!task || task.status !== "pending") continue;

    const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : [];
    const normalizedBlockers = blockedBy
      .map((blockerId) => normalizeTaskId(blockerId))
      .filter((id): id is string => id !== null);

    const errorDependencies = normalizedBlockers.filter((blockerId) => {
      const status = statusByNormalizedId.get(blockerId);
      return status === "error";
    });

    if (errorDependencies.length > 0) {
      const taskId = normalizeTaskId(task.id);
      if (taskId) {
        return {
          type: "error_dependency",
          taskId,
          errorDependencies,
        };
      }
    }
  }

  return { type: "none" };
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
