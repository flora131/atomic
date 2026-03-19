import type { SubagentStreamResult } from "@/services/workflows/graph/contracts/runtime.ts";
import {
  normalizeWorkflowRuntimeTaskStatus,
  type WorkflowRuntimeTask,
} from "@/services/workflows/runtime-contracts.ts";
import { buildWorkerAssignment, type TaskItem } from "@/services/workflows/ralph/prompts.ts";
import { buildTaskResultEnvelope } from "@/services/workflows/task-result-envelope.ts";
import type { RalphRuntimeDependencies } from "@/services/workflows/ralph/types.ts";
import { EagerDispatchCoordinator } from "./eager-dispatch.ts";
import {
  applyRuntimeTask,
  toRuntimeTask,
} from "./task-helpers.ts";

interface WorkerDispatchAdapterConfig {
  tasks: readonly TaskItem[];
  executionId: string;
  iteration: number;
  maxReadyDispatchWaves?: number;
  runtime: Pick<
    RalphRuntimeDependencies,
    "spawnSubagentParallel" | "taskIdentity" | "notifyTaskStatusChange"
  >;
  abortSignal?: AbortSignal;
}

interface WorkerDispatchAdapter {
  coordinator: EagerDispatchCoordinator;
  fallbackTaskId: (taskIndex: number) => string;
  bindWorkerIdentity: (task: TaskItem, taskIndex: number) => TaskItem;
  reconcileDispatchedTask: (
    task: TaskItem,
    taskIndex: number,
    status: TaskItem["status"],
    result: SubagentStreamResult | undefined,
    sessionId: string,
  ) => TaskItem;
}

export function createWorkerDispatchAdapter(
  config: WorkerDispatchAdapterConfig,
): WorkerDispatchAdapter {
  const { tasks, executionId, iteration, maxReadyDispatchWaves, runtime, abortSignal } = config;
  const { spawnSubagentParallel, taskIdentity, notifyTaskStatusChange } = runtime;

  const fallbackTaskId = (taskIndex: number): string =>
    `${executionId}-${iteration}-${taskIndex}`;

  const workerAgentIds = new Map<number, string>();
  const agentIdCounts = new Map<string, number>();
  for (const [taskIndex, task] of tasks.entries()) {
    const baseAgentId = `worker-${task.id ?? fallbackTaskId(taskIndex)}`;
    const nextCount = (agentIdCounts.get(baseAgentId) ?? 0) + 1;
    agentIdCounts.set(baseAgentId, nextCount);
    workerAgentIds.set(
      taskIndex,
      nextCount === 1 ? baseAgentId : `${baseAgentId}-${nextCount}`,
    );
  }

  const bindWorkerIdentity = (
    task: TaskItem,
    taskIndex: number,
  ): TaskItem => {
    const runtimeTask = toRuntimeTask(task, fallbackTaskId(taskIndex));
    const workerAgentId = workerAgentIds.get(taskIndex);
    if (!taskIdentity || !workerAgentId) {
      return applyRuntimeTask(task, runtimeTask);
    }

    const boundTask = taskIdentity.bindProviderId(
      runtimeTask,
      "subagent_id",
      workerAgentId,
    );
    return applyRuntimeTask(task, boundTask);
  };

  const buildBoundRuntimeTask = (
    task: TaskItem,
    taskIndex: number,
  ): {
    boundTask: TaskItem;
    runtimeTask: WorkflowRuntimeTask;
  } => {
    const boundTask = bindWorkerIdentity(task, taskIndex);
    return {
      boundTask,
      runtimeTask: toRuntimeTask(boundTask, fallbackTaskId(taskIndex)),
    };
  };

  const buildStatusChangeTask = (
    task: TaskItem,
    taskIndex: number,
  ): WorkflowRuntimeTask => {
    const { boundTask, runtimeTask } = buildBoundRuntimeTask(task, taskIndex);
    return {
      id: runtimeTask.id,
      title: boundTask.description,
      status: normalizeWorkflowRuntimeTaskStatus(boundTask.status),
      blockedBy: boundTask.blockedBy,
      identity: runtimeTask.identity,
    };
  };

  const reconcileDispatchedTask = (
    task: TaskItem,
    taskIndex: number,
    status: TaskItem["status"],
    result: SubagentStreamResult | undefined,
    sessionId: string,
  ): TaskItem => {
    const normalizedStatus = normalizeWorkflowRuntimeTaskStatus(status);
    if (normalizedStatus !== "completed" && normalizedStatus !== "error") {
      throw new Error(
        `Worker dispatch reconciliation invariant failed: task ${task.id ?? fallbackTaskId(taskIndex)} ended with non-terminal status ${normalizedStatus}`,
      );
    }

    if (!result) {
      throw new Error(
        `Worker dispatch reconciliation invariant failed: missing result for task ${task.id ?? fallbackTaskId(taskIndex)}`,
      );
    }

    const { boundTask, runtimeTask } = buildBoundRuntimeTask(
      { ...task, status: normalizedStatus },
      taskIndex,
    );
    const finalizedResult = normalizedStatus === "completed" || !result.success
      ? result
      : {
        ...result,
        success: false,
        error: result.error ?? "Task did not complete successfully.",
      };
    const taskResult = buildTaskResultEnvelope({
      task: runtimeTask,
      result: finalizedResult,
      sessionId,
    });

    return applyRuntimeTask(boundTask, {
      ...runtimeTask,
      status: normalizedStatus,
      taskResult,
    });
  };

  const coordinator = new EagerDispatchCoordinator(tasks, {
    spawnSubagentParallel,
    buildSpawnConfig: (task, taskIndex, tasksSnapshot) => ({
      agentId: workerAgentIds.get(taskIndex) ?? `worker-${fallbackTaskId(taskIndex)}`,
      agentName: "worker",
      task: buildWorkerAssignment(task, tasksSnapshot),
    }),
    onTaskDispatched: (task, taskIndex) => {
      notifyTaskStatusChange?.(
        task.id ? [task.id] : [],
        "in_progress",
        [buildStatusChangeTask(task, taskIndex)],
      );
    },
    onTaskCompleted: (task, taskIndex, result) => {
      notifyTaskStatusChange?.(
        task.id ? [task.id] : [],
        result.success ? "completed" : "error",
        [buildStatusChangeTask(task, taskIndex)],
      );
    },
    abortSignal,
    maxReadyDispatchWaves,
  });

  return {
    coordinator,
    fallbackTaskId,
    bindWorkerIdentity,
    reconcileDispatchedTask,
  };
}
