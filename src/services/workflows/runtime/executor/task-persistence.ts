import type { NormalizedTodoItem, TaskStatus } from "@/state/parts/helpers/task-status.ts";
import type { WorkflowRuntimeTask } from "@/services/workflows/runtime-contracts.ts";
import {
  incrementRuntimeParityCounter,
  observeRuntimeParityHistogram,
  runtimeParityDebug,
} from "@/services/workflows/runtime-parity-observability.ts";
import { pipelineError } from "@/services/events/pipeline-logger.ts";

export function createWorkflowTaskPersistence(args: {
  sessionId: string;
  workflowRunId: number;
  workflowName: string;
  saveTasksToSession?: (
    tasks: NormalizedTodoItem[],
    sessionId: string,
  ) => Promise<void>;
  toRuntimeTasks: (tasks: unknown) => WorkflowRuntimeTask[];
  persistTaskStatusEvents: boolean;
}): {
  saveTasks: (tasks: NormalizedTodoItem[]) => void;
  flush: () => Promise<void>;
  /** Direct callback for task status change events (replaces bus subscription). */
  handleTaskStatusChange: (taskIds: string[], newStatus: string, tasks: WorkflowRuntimeTask[]) => void;
} {
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSaveTasks: NormalizedTodoItem[] | null = null;
  let latestWorkflowTasks: NormalizedTodoItem[] = [];

  const normalizeTaskKey = (taskId?: string): string | null => {
    if (typeof taskId !== "string") return null;
    const normalized = taskId.trim().toLowerCase().replace(/^#/, "");
    return normalized.length > 0 ? normalized : null;
  };

  const saveTasks = (tasks: NormalizedTodoItem[]): void => {
    if (!args.saveTasksToSession) {
      latestWorkflowTasks = tasks;
      return;
    }

    latestWorkflowTasks = tasks;
    pendingSaveTasks = tasks;
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
    }
    saveDebounceTimer = setTimeout(async () => {
      if (pendingSaveTasks) {
        try {
          await args.saveTasksToSession!(pendingSaveTasks, args.sessionId);
        } catch (error) {
          pipelineError("Workflow", "task_save_error", {
            sessionId: args.sessionId,
          });
          console.error("[workflow] Failed to save tasks:", error);
        }
        pendingSaveTasks = null;
      }
      saveDebounceTimer = null;
    }, 100);
  };

  const mergeNormalizedTasks = (
    previousTasks: readonly NormalizedTodoItem[],
    incomingTasks: readonly NormalizedTodoItem[],
  ): NormalizedTodoItem[] => {
    if (previousTasks.length === 0) {
      return [...incomingTasks];
    }

    const incomingByKey = new Map<string, NormalizedTodoItem>();
    const incomingWithoutKey: NormalizedTodoItem[] = [];
    for (const task of incomingTasks) {
      const key = normalizeTaskKey(task.id);
      if (!key) {
        incomingWithoutKey.push(task);
        continue;
      }
      incomingByKey.set(key, task);
    }

    const merged: NormalizedTodoItem[] = [];
    const seenKeys = new Set<string>();
    for (const previousTask of previousTasks) {
      const key = normalizeTaskKey(previousTask.id);
      if (!key) {
        merged.push(previousTask);
        continue;
      }

      const incomingTask = incomingByKey.get(key);
      if (!incomingTask) {
        merged.push(previousTask);
        continue;
      }

      merged.push({
        ...previousTask,
        ...incomingTask,
        blockedBy: incomingTask.blockedBy ?? previousTask.blockedBy,
        identity: incomingTask.identity ?? previousTask.identity,
        taskResult: incomingTask.taskResult ?? previousTask.taskResult,
      });
      seenKeys.add(key);
    }

    for (const task of incomingTasks) {
      const key = normalizeTaskKey(task.id);
      if (key) {
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
      }
      merged.push(task);
    }

    return merged;
  };

  const flush = async (): Promise<void> => {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    if (!pendingSaveTasks || !args.saveTasksToSession) {
      return;
    }
    try {
      await args.saveTasksToSession(pendingSaveTasks, args.sessionId);
    } catch (error) {
      pipelineError("Workflow", "task_flush_error", {
        sessionId: args.sessionId,
      });
      console.error("[workflow] Failed to flush pending task save:", error);
    } finally {
      pendingSaveTasks = null;
    }
  };

  const handleTaskStatusChange = (taskIds: string[], _newStatus: string, tasks: WorkflowRuntimeTask[]): void => {
    if (!args.saveTasksToSession || !args.persistTaskStatusEvents) {
      return;
    }

    incrementRuntimeParityCounter(
      "workflow.runtime.parity.status_snapshot_total",
      {
        phase: "received",
        workflow: args.workflowName,
      },
    );
    runtimeParityDebug("status_snapshot_received", {
      sessionId: args.sessionId,
      workflowRunId: args.workflowRunId,
      workflow: args.workflowName,
      taskIds,
      taskCount: tasks.length,
    });

    const runtimeTasks = args.toRuntimeTasks(tasks);
    for (const runtimeTask of runtimeTasks) {
      const canonicalId = runtimeTask.identity?.canonicalId;
      if (!canonicalId || canonicalId.trim().length === 0) {
        incrementRuntimeParityCounter(
          "workflow.runtime.parity.status_snapshot_failures_total",
          {
            reason: "missing_canonical_id",
            workflow: args.workflowName,
          },
        );
        throw new Error(
          `workflow.task.statusChange invariant failed: task ${runtimeTask.id} missing canonical identity`,
        );
      }

      if (
        runtimeTask.taskResult &&
        runtimeTask.taskResult.task_id !== canonicalId
      ) {
        incrementRuntimeParityCounter(
          "workflow.runtime.parity.status_snapshot_failures_total",
          {
            reason: "task_result_identity_mismatch",
            workflow: args.workflowName,
          },
        );
        throw new Error(
          `workflow.task.statusChange invariant failed: taskResult.task_id ${runtimeTask.taskResult.task_id} does not match canonical task identity ${canonicalId}`,
        );
      }
    }

    observeRuntimeParityHistogram(
      "workflow.runtime.parity.status_snapshot_task_count",
      runtimeTasks.length,
      { workflow: args.workflowName },
    );

    const previousById = new Map<string, NormalizedTodoItem>();
    for (const task of latestWorkflowTasks) {
      const key = normalizeTaskKey(task.id);
      if (!key || previousById.has(key)) continue;
      previousById.set(key, task);
    }

    const normalized: NormalizedTodoItem[] = runtimeTasks.map((task) => {
      const taskKey = normalizeTaskKey(task.id);
      return {
        id: task.id,
        description: task.title,
        status: task.status as TaskStatus,
        summary: task.title,
        blockedBy:
          task.blockedBy ??
          (taskKey ? previousById.get(taskKey)?.blockedBy : undefined),
        identity: task.identity,
        taskResult: task.taskResult,
      };
    });

    const mergedTasks = mergeNormalizedTasks(latestWorkflowTasks, normalized);

    incrementRuntimeParityCounter(
      "workflow.runtime.parity.status_snapshot_total",
      {
        phase: "persisted",
        workflow: args.workflowName,
      },
    );
    saveTasks(mergedTasks);
  };

  return {
    saveTasks,
    flush,
    handleTaskStatusChange,
  };
}
