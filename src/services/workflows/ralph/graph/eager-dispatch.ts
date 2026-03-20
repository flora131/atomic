import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/contracts/runtime.ts";
import { runtimeParityDebug } from "@/services/workflows/runtime-parity-observability.ts";
import type { TaskItem } from "@/services/workflows/ralph/prompts.ts";
import { getReadyTasks } from "./task-helpers.ts";

export interface EagerDispatchConfig {
  spawnSubagentParallel: (
    agents: SubagentSpawnOptions[],
    abortSignal?: AbortSignal,
    onAgentComplete?: (result: SubagentStreamResult) => void,
  ) => Promise<SubagentStreamResult[]>;
  buildSpawnConfig: (
    task: TaskItem,
    taskIndex: number,
    tasksSnapshot: TaskItem[],
  ) => SubagentSpawnOptions;
  onTaskDispatched?: (
    task: TaskItem,
    taskIndex: number,
    spawnConfig: SubagentSpawnOptions,
    tasksSnapshot: TaskItem[],
  ) => void;
  onTaskCompleted?: (
    task: TaskItem,
    taskIndex: number,
    result: SubagentStreamResult,
    tasksSnapshot: TaskItem[],
  ) => void;
  onTaskRetry?: (
    task: TaskItem,
    taskIndex: number,
    attempt: number,
    error: string,
    tasksSnapshot: TaskItem[],
  ) => void;
  onWorkflowAbort?: (
    task: TaskItem,
    taskIndex: number,
    error: string,
    tasksSnapshot: TaskItem[],
  ) => void;
  abortSignal?: AbortSignal;
  maxTaskRetries?: number;
  maxReadyDispatchWaves?: number;
  now?: () => number;
  debugLog?: (phase: string, data: Record<string, unknown>) => void;
}

export interface EagerDispatchWaveTiming {
  waveNumber: number;
  taskIndices: number[];
  taskIds: string[];
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

export interface EagerDispatchTaskAttemptTiming {
  attempt: number;
  waveNumber: number;
  agentId: string;
  dispatchedAt: number;
  completedAt?: number;
  coordinatorDurationMs?: number;
  resultDurationMs?: number;
  outcome?: "completed" | "error" | "retry";
}

export interface EagerDispatchTaskTiming {
  taskIndex: number;
  taskId: string;
  firstDispatchedAt: number;
  finalCompletedAt?: number;
  totalCoordinatorDurationMs?: number;
  finalStatus?: FinalTaskStatus;
  attempts: EagerDispatchTaskAttemptTiming[];
}

export interface EagerDispatchInstrumentation {
  waveCount: number;
  waves: EagerDispatchWaveTiming[];
  taskTimings: Map<number, EagerDispatchTaskTiming>;
}

export interface EagerDispatchResult {
  dispatchedTaskIndices: Set<number>;
  resultsByTaskIndex: Map<number, SubagentStreamResult>;
  taskStatuses: Map<number, TaskItem["status"]>;
  readyDispatchWaveCount: number;
  instrumentation: EagerDispatchInstrumentation;
}

interface ReadyTaskEntry {
  taskIndex: number;
}

type FinalTaskStatus = "completed" | "error";
type TaskAttemptOutcome = "completed" | "error" | "retry";

interface PendingWaveState {
  batchId: string;
  timing: EagerDispatchWaveTiming;
  pendingAgentIds: Set<string>;
}

const DEFAULT_MAX_TASK_RETRIES = 3;
const STALLED_ERROR_MARKER = "[stalled]";

export class EagerDispatchCoordinator {
  private readonly taskStatuses = new Map<number, TaskItem["status"]>();
  private readonly resultsByTaskIndex = new Map<number, SubagentStreamResult>();
  private readonly dispatchedTaskIndices = new Set<number>();
  private readonly activeTaskIndices = new Set<number>();
  private readonly activeAgentIdByTaskIndex = new Map<number, string>();
  private readonly taskRetryCounts = new Map<number, number>();
  private readonly pendingBatches = new Map<string, Promise<void>>();
  private readonly abortController = new AbortController();
  private readonly taskTimings = new Map<number, EagerDispatchTaskTiming>();
  private readonly waveTimings: EagerDispatchWaveTiming[] = [];
  private readonly pendingWaveStates = new Map<string, PendingWaveState>();
  private readonly maxTaskRetries: number;
  private readonly maxReadyDispatchWaves: number | null;
  private readonly now: () => number;
  private readonly debugLog: (phase: string, data: Record<string, unknown>) => void;
  private aborted = false;
  private waveCount = 0;
  private readyDispatchWaveCount = 0;

  constructor(
    private readonly tasks: readonly TaskItem[],
    private readonly config: EagerDispatchConfig,
  ) {
    this.maxTaskRetries = config.maxTaskRetries ?? DEFAULT_MAX_TASK_RETRIES;
    this.maxReadyDispatchWaves = typeof config.maxReadyDispatchWaves === "number"
      ? Math.max(0, Math.floor(config.maxReadyDispatchWaves))
      : null;
    this.now = config.now ?? Date.now;
    this.debugLog = config.debugLog ?? runtimeParityDebug;

    for (const [taskIndex, task] of tasks.entries()) {
      this.taskStatuses.set(taskIndex, task.status);
    }

    if (config.abortSignal?.aborted) {
      this.abortAllInFlight(config.abortSignal.reason);
      return;
    }

    config.abortSignal?.addEventListener(
      "abort",
      () => {
        this.abortAllInFlight(config.abortSignal?.reason);
      },
      { once: true },
    );
  }

  async execute(): Promise<EagerDispatchResult> {
    this.dispatchReadyTasks();
    await this.awaitAllPending();
    this.assertAllDispatchedTasksFinalized();

    return {
      dispatchedTaskIndices: new Set(this.dispatchedTaskIndices),
      resultsByTaskIndex: new Map(this.resultsByTaskIndex),
      taskStatuses: new Map(this.taskStatuses),
      readyDispatchWaveCount: this.readyDispatchWaveCount,
      instrumentation: this.buildInstrumentation(),
    };
  }

  private dispatchReadyTasks(): void {
    if (this.aborted) {
      return;
    }

    if (
      this.maxReadyDispatchWaves !== null
      && this.readyDispatchWaveCount >= this.maxReadyDispatchWaves
    ) {
      return;
    }

    const readyTaskIndices = this.getReadyTaskEntries().map(({ taskIndex }) => taskIndex);
    if (readyTaskIndices.length === 0) {
      return;
    }

    this.readyDispatchWaveCount += 1;
    this.dispatchTaskIndices(readyTaskIndices);
  }

  private dispatchTaskIndices(taskIndices: readonly number[]): void {
    if (this.aborted || taskIndices.length === 0) {
      return;
    }

    const nextTaskIndices = [...new Set(taskIndices)].filter((taskIndex) => {
      const task = this.tasks[taskIndex];
      if (!task || this.activeTaskIndices.has(taskIndex)) {
        return false;
      }

      const status = this.taskStatuses.get(taskIndex) ?? task.status;
      return status === "pending" || status === "in_progress";
    });

    if (nextTaskIndices.length === 0) {
      return;
    }

    for (const taskIndex of nextTaskIndices) {
      this.dispatchedTaskIndices.add(taskIndex);
      this.activeTaskIndices.add(taskIndex);
      this.taskStatuses.set(taskIndex, "in_progress");
    }

    const tasksSnapshot = this.buildTasksSnapshot();
    const batchTaskIndexByAgentId = new Map<string, number>();
    const batchId = crypto.randomUUID();
    const waveNumber = ++this.waveCount;
    const spawnConfigs = nextTaskIndices.map((taskIndex) => {
      const task = tasksSnapshot[taskIndex] ?? this.tasks[taskIndex];
      if (!task) {
        throw new Error(`Missing task snapshot for eager dispatch index ${taskIndex}`);
      }

      const spawnConfig = this.config.buildSpawnConfig(
        task,
        taskIndex,
        tasksSnapshot,
      );
      this.activeAgentIdByTaskIndex.set(taskIndex, spawnConfig.agentId);
      batchTaskIndexByAgentId.set(spawnConfig.agentId, taskIndex);
      this.recordTaskDispatchTiming(taskIndex, task, waveNumber, spawnConfig.agentId);
      this.config.onTaskDispatched?.(task, taskIndex, spawnConfig, tasksSnapshot);
      return spawnConfig;
    });

    const _pendingWaveState = this.startWave(batchId, waveNumber, nextTaskIndices, tasksSnapshot, spawnConfigs);
    const handledAgentIds = new Set<string>();
    const processBatchResult = (result: SubagentStreamResult) => {
      if (handledAgentIds.has(result.agentId)) {
        return;
      }
      handledAgentIds.add(result.agentId);

      const taskIndex = batchTaskIndexByAgentId.get(result.agentId);
      if (taskIndex === undefined) {
        this.completeWaveAgent(batchId, result.agentId);
        return;
      }

      this.handleAgentComplete(taskIndex, result);
      this.completeWaveAgent(batchId, result.agentId);
    };

    const batchPromise = this.config.spawnSubagentParallel(
      spawnConfigs,
      this.abortController.signal,
      processBatchResult,
    ).then((results) => {
      for (const result of results) {
        processBatchResult(result);
      }
    }).catch((error) => {
      const errorMessage = this.toErrorMessage(error);
        for (const agent of spawnConfigs) {
          processBatchResult({
            agentId: agent.agentId,
            success: false,
            output: "",
          error: errorMessage,
          toolUses: 0,
          durationMs: 0,
        });
      }
    }).finally(() => {
      this.pendingBatches.delete(batchId);
    });

    this.pendingBatches.set(batchId, batchPromise);
  }

  private getReadyTaskEntries(): ReadyTaskEntry[] {
    const tasksSnapshot = this.buildTasksSnapshot();
    const readyTasks = new Set(getReadyTasks(tasksSnapshot));
    const readyEntries: ReadyTaskEntry[] = [];

    for (const [taskIndex, task] of tasksSnapshot.entries()) {
      if (!readyTasks.has(task) || this.activeTaskIndices.has(taskIndex)) {
        continue;
      }
      readyEntries.push({ taskIndex });
    }

    return readyEntries;
  }

  private buildTasksSnapshot(): TaskItem[] {
    return this.tasks.map((task, taskIndex) => ({
      ...task,
      status: this.taskStatuses.get(taskIndex) ?? task.status,
    }));
  }

  private handleAgentComplete(taskIndex: number, result: SubagentStreamResult): void {
    if (!this.activeTaskIndices.has(taskIndex)) {
      return;
    }

    this.activeTaskIndices.delete(taskIndex);
    this.activeAgentIdByTaskIndex.delete(taskIndex);

    const errorMessage = this.toErrorMessage(result.error ?? "Unknown error");
    if (!result.success) {
      if (this.shouldAbortWithoutRetry(result)) {
        this.finalizeTask(taskIndex, result, "error");
        if (!this.aborted) {
          this.abortAllInFlight(errorMessage);
        }
        return;
      }

      const retryCount = this.taskRetryCounts.get(taskIndex) ?? 0;
      if (!this.aborted && retryCount < this.maxTaskRetries) {
        const nextAttempt = retryCount + 1;
        this.taskRetryCounts.set(taskIndex, nextAttempt);
        this.completeTaskAttempt(taskIndex, result, "retry");

        const tasksSnapshot = this.buildTasksSnapshot();
        const task = tasksSnapshot[taskIndex];
        if (task) {
          this.config.onTaskRetry?.(task, taskIndex, nextAttempt, errorMessage, tasksSnapshot);
          this.logTaskAttempt(taskIndex, "ralph_eager_dispatch_task_retry", {
            attempt: nextAttempt,
            error: errorMessage,
            taskId: task.id ?? this.taskIdFor(taskIndex),
          });
        }

        this.dispatchTaskIndices([taskIndex]);
        return;
      }

      this.finalizeTask(taskIndex, result, "error");
      if (!this.aborted) {
        const tasksSnapshot = this.buildTasksSnapshot();
        const task = tasksSnapshot[taskIndex];
        if (task) {
          this.config.onWorkflowAbort?.(task, taskIndex, errorMessage, tasksSnapshot);
        }
        this.abortAllInFlight(errorMessage);
      }
      return;
    }

    this.finalizeTask(taskIndex, result, "completed");

    if (!this.aborted) {
      this.dispatchReadyTasks();
    }
  }

  private finalizeTask(
    taskIndex: number,
    result: SubagentStreamResult,
    status: FinalTaskStatus,
  ): void {
    this.taskStatuses.set(taskIndex, status);
    const finalizedResult = status === "completed"
      ? result
      : {
        ...result,
        success: false,
        error: this.toErrorMessage(
          result.error
            ?? (this.abortController.signal.aborted
              ? this.abortController.signal.reason
              : "Task did not complete successfully"),
        ),
      };

    this.completeTaskAttempt(taskIndex, finalizedResult, status);
    this.resultsByTaskIndex.set(taskIndex, finalizedResult);

    const tasksSnapshot = this.buildTasksSnapshot();
    const task = tasksSnapshot[taskIndex];
    if (!task) {
      return;
    }

    this.logTaskAttempt(taskIndex, "ralph_eager_dispatch_task_finalized", {
      success: finalizedResult.success,
      taskId: task.id ?? this.taskIdFor(taskIndex),
      taskIndex,
    });
    this.config.onTaskCompleted?.(task, taskIndex, finalizedResult, tasksSnapshot);
  }

  private abortAllInFlight(reason?: unknown): void {
    if (!this.aborted) {
      this.aborted = true;
      this.abortController.abort(reason);
    }

    const inFlightTaskIndices = [...this.activeTaskIndices];
    if (inFlightTaskIndices.length > 0) {
      this.debugLog("ralph_eager_dispatch_abort", {
        reason: this.toErrorMessage(reason ?? "Workflow aborted"),
        taskIds: inFlightTaskIndices.map((taskIndex) => this.taskIdFor(taskIndex)),
        activeTaskCount: inFlightTaskIndices.length,
      });
    }
    for (const taskIndex of inFlightTaskIndices) {
      const agentId = this.activeAgentIdByTaskIndex.get(taskIndex);
      this.activeTaskIndices.delete(taskIndex);
      this.activeAgentIdByTaskIndex.delete(taskIndex);

      this.finalizeTask(taskIndex, {
        agentId: agentId ?? `aborted-task-${taskIndex}`,
        success: false,
        output: "",
        error: this.toErrorMessage(reason ?? "Workflow aborted"),
        toolUses: 0,
        durationMs: 0,
      }, "error");
    }
  }

  private startWave(
    batchId: string,
    waveNumber: number,
    taskIndices: readonly number[],
    tasksSnapshot: readonly TaskItem[],
    spawnConfigs: readonly SubagentSpawnOptions[],
  ): PendingWaveState {
    const timing: EagerDispatchWaveTiming = {
      waveNumber,
      taskIndices: [...taskIndices],
      taskIds: taskIndices.map((taskIndex) => tasksSnapshot[taskIndex]?.id ?? this.taskIdFor(taskIndex)),
      startedAt: this.now(),
    };
    const pendingWaveState: PendingWaveState = {
      batchId,
      timing,
      pendingAgentIds: new Set(spawnConfigs.map((spawnConfig) => spawnConfig.agentId)),
    };
    this.waveTimings.push(timing);
    this.pendingWaveStates.set(batchId, pendingWaveState);
    this.debugLog("ralph_eager_dispatch_wave_started", {
      batchId,
      waveNumber,
      taskIds: timing.taskIds,
      taskCount: timing.taskIds.length,
      activeTaskCount: this.activeTaskIndices.size,
    });
    return pendingWaveState;
  }

  private completeWaveAgent(batchId: string, agentId: string): void {
    const pendingWaveState = this.pendingWaveStates.get(batchId);
    if (!pendingWaveState) {
      return;
    }

    pendingWaveState.pendingAgentIds.delete(agentId);
    if (pendingWaveState.pendingAgentIds.size > 0) {
      return;
    }

    pendingWaveState.timing.completedAt = this.now();
    pendingWaveState.timing.durationMs = this.normalizeDurationMs(
      pendingWaveState.timing.completedAt - pendingWaveState.timing.startedAt,
    );
    this.pendingWaveStates.delete(batchId);
    this.debugLog("ralph_eager_dispatch_wave_completed", {
      batchId: pendingWaveState.batchId,
      waveNumber: pendingWaveState.timing.waveNumber,
      taskIds: pendingWaveState.timing.taskIds,
      taskCount: pendingWaveState.timing.taskIds.length,
      durationMs: pendingWaveState.timing.durationMs,
      statuses: pendingWaveState.timing.taskIndices.map((taskIndex) => ({
        taskId: this.taskIdFor(taskIndex),
        status: this.taskStatuses.get(taskIndex) ?? this.tasks[taskIndex]?.status ?? "unknown",
      })),
    });
  }

  private recordTaskDispatchTiming(
    taskIndex: number,
    task: TaskItem,
    waveNumber: number,
    agentId: string,
  ): void {
    const dispatchedAt = this.now();
    const taskTiming = this.taskTimings.get(taskIndex) ?? {
      taskIndex,
      taskId: task.id ?? this.taskIdFor(taskIndex),
      firstDispatchedAt: dispatchedAt,
      attempts: [],
    };
    taskTiming.attempts.push({
      attempt: taskTiming.attempts.length + 1,
      waveNumber,
      agentId,
      dispatchedAt,
    });
    this.taskTimings.set(taskIndex, taskTiming);
  }

  private completeTaskAttempt(
    taskIndex: number,
    result: Pick<SubagentStreamResult, "durationMs">,
    outcome: TaskAttemptOutcome,
  ): void {
    const taskTiming = this.taskTimings.get(taskIndex);
    const attempt = taskTiming?.attempts.findLast((entry) => entry.completedAt === undefined);
    if (!taskTiming || !attempt) {
      return;
    }

    const completedAt = this.now();
    attempt.completedAt = completedAt;
    attempt.coordinatorDurationMs = this.normalizeDurationMs(completedAt - attempt.dispatchedAt);
    attempt.resultDurationMs = this.normalizeDurationMs(result.durationMs);
    attempt.outcome = outcome;

    if (outcome === "retry") {
      return;
    }

    taskTiming.finalCompletedAt = completedAt;
    taskTiming.totalCoordinatorDurationMs = this.normalizeDurationMs(
      completedAt - taskTiming.firstDispatchedAt,
    );
    taskTiming.finalStatus = outcome;
  }

  private logTaskAttempt(
    taskIndex: number,
    phase: string,
    extraData: Record<string, unknown>,
  ): void {
    const taskTiming = this.taskTimings.get(taskIndex);
    const attempt = taskTiming?.attempts.at(-1);
    if (!taskTiming || !attempt) {
      return;
    }

    this.debugLog(phase, {
      taskId: taskTiming.taskId,
      taskIndex,
      attempt: attempt.attempt,
      waveNumber: attempt.waveNumber,
      agentId: attempt.agentId,
      dispatchedAt: attempt.dispatchedAt,
      completedAt: attempt.completedAt,
      coordinatorDurationMs: attempt.coordinatorDurationMs,
      resultDurationMs: attempt.resultDurationMs,
      outcome: attempt.outcome,
      totalCoordinatorDurationMs: taskTiming.totalCoordinatorDurationMs,
      finalStatus: taskTiming.finalStatus,
      ...extraData,
    });
  }

  private buildInstrumentation(): EagerDispatchInstrumentation {
    return {
      waveCount: this.waveCount,
      waves: this.waveTimings.map((timing) => ({
        ...timing,
        taskIndices: [...timing.taskIndices],
        taskIds: [...timing.taskIds],
      })),
      taskTimings: new Map(
        [...this.taskTimings.entries()].map(([taskIndex, taskTiming]) => [
          taskIndex,
          {
            ...taskTiming,
            attempts: taskTiming.attempts.map((attempt) => ({ ...attempt })),
          },
        ]),
      ),
    };
  }

  private taskIdFor(taskIndex: number): string {
    return this.tasks[taskIndex]?.id ?? `task-${taskIndex}`;
  }

  private normalizeDurationMs(value: number): number {
    return Math.max(0, Math.floor(value));
  }

  private shouldAbortWithoutRetry(result: SubagentStreamResult): boolean {
    if (this.aborted || this.abortController.signal.aborted) {
      return true;
    }

    const error = result.error?.toLowerCase() ?? "";
    return error.includes("cancelled")
      || error.includes("aborted")
      || error.includes(STALLED_ERROR_MARKER);
  }

  private toErrorMessage(error: unknown): string {
    if (typeof error === "string" && error.trim().length > 0) {
      return error;
    }
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return "Unknown error";
  }

  private async awaitAllPending(): Promise<void> {
    while (this.pendingBatches.size > 0) {
      await Promise.allSettled(this.pendingBatches.values());
    }
  }

  private assertAllDispatchedTasksFinalized(): void {
    if (this.activeTaskIndices.size > 0) {
      const activeTaskIds = [...this.activeTaskIndices].map((taskIndex) =>
        this.tasks[taskIndex]?.id ?? `task-${taskIndex}`
      );
      throw new Error(
        `Eager dispatch reconciliation invariant failed: tasks still active after completion [${activeTaskIds.join(", ")}]`,
      );
    }

    for (const taskIndex of this.dispatchedTaskIndices) {
      const task = this.tasks[taskIndex];
      const taskId = task?.id ?? `task-${taskIndex}`;
      const status = this.taskStatuses.get(taskIndex) ?? task?.status;
      if (status !== "completed" && status !== "error") {
        throw new Error(
          `Eager dispatch reconciliation invariant failed: task ${taskId} ended with non-terminal status ${status ?? "unknown"}`,
        );
      }

      if (!this.resultsByTaskIndex.has(taskIndex)) {
        throw new Error(
          `Eager dispatch reconciliation invariant failed: missing final result for task ${taskId}`,
        );
      }
    }
  }
}
