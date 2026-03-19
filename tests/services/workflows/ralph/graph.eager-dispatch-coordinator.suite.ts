import { describe, expect, test } from "bun:test";
import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/contracts/runtime.ts";
import type { TaskItem } from "@/services/workflows/ralph/prompts.ts";
import { EagerDispatchCoordinator } from "@/services/workflows/ralph/graph/eager-dispatch.ts";

function createResult(
  agentId: string,
  success = true,
  output = `Completed ${agentId}`,
): SubagentStreamResult {
  return {
    agentId,
    success,
    output,
    error: success ? undefined : `Failed ${agentId}`,
    toolUses: 1,
    durationMs: 10,
  };
}

function createAbortResult(
  agentId: string,
  error = 'Sub-agent "worker" was cancelled',
): SubagentStreamResult {
  return {
    agentId,
    success: false,
    output: "",
    error,
    toolUses: 1,
    durationMs: 10,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface DebugEventEntry {
  phase: string;
  data: Record<string, unknown>;
}

function taskIdsFromDebugEvent(event: DebugEventEntry): string[] {
  return Array.isArray(event.data.taskIds)
    ? event.data.taskIds.filter((taskId): taskId is string => typeof taskId === "string")
    : [];
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("EagerDispatchCoordinator", () => {
  test("dispatches all independent tasks in a single batch", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
      { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
      { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: [] },
    ];

    const batches: string[][] = [];
    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (
        agents,
        _abortSignal,
        onAgentComplete,
      ) => {
        batches.push(agents.map((agent) => agent.agentId));
        return Promise.all(
          agents.map(async (agent) => {
            const result = createResult(agent.agentId);
            onAgentComplete?.(result);
            return result;
          }),
        );
      },
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
    });

    const result = await coordinator.execute();

    expect(batches).toEqual([["worker-#1", "worker-#2", "worker-#3"]]);
    expect(Array.from(result.dispatchedTaskIndices.values())).toEqual([0, 1, 2]);
    expect(
      Array.from(result.taskStatuses.values()),
    ).toEqual(["completed", "completed", "completed"]);
  });

  test("dispatches newly unblocked tasks before the original batch finishes", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
      { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
      { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: ["#1"] },
    ];

    const batches: string[][] = [];
    const pendingResults = new Map<
      string,
      ReturnType<typeof createDeferred<SubagentStreamResult>>
    >();
    const dispatchSnapshots: Array<{ taskId: string | undefined; completedTaskIds: string[] }> = [];

    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (
        agents: SubagentSpawnOptions[],
        _abortSignal,
        onAgentComplete,
      ) => {
        batches.push(agents.map((agent) => agent.agentId));
        return Promise.all(
          agents.map((agent) => {
            const deferred = createDeferred<SubagentStreamResult>();
            pendingResults.set(agent.agentId, deferred);
            return deferred.promise.then((result) => {
              onAgentComplete?.(result);
              return result;
            });
          }),
        );
      },
      buildSpawnConfig: (task, _taskIndex, tasksSnapshot) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
        tools: tasksSnapshot
          .filter((candidate) => candidate.status === "completed")
          .map((candidate) => candidate.id ?? "?"),
      }),
      onTaskDispatched: (task, _taskIndex, _config, tasksSnapshot) => {
        dispatchSnapshots.push({
          taskId: task.id,
          completedTaskIds: tasksSnapshot
            .filter((candidate) => candidate.status === "completed")
            .map((candidate) => candidate.id ?? "?"),
        });
      },
    });

    const execution = coordinator.execute();
    await flushMicrotasks();

    expect(batches).toEqual([["worker-#1", "worker-#2"]]);

    pendingResults.get("worker-#1")?.resolve(createResult("worker-#1"));
    await flushMicrotasks();

    expect(batches).toEqual([
      ["worker-#1", "worker-#2"],
      ["worker-#3"],
    ]);
    expect(dispatchSnapshots.find((entry) => entry.taskId === "#3")?.completedTaskIds).toEqual(["#1"]);

    pendingResults.get("worker-#3")?.resolve(createResult("worker-#3"));
    pendingResults.get("worker-#2")?.resolve(createResult("worker-#2"));

    const result = await execution;

    expect(Array.from(result.resultsByTaskIndex.values()).map((entry) => entry.agentId).sort()).toEqual([
      "worker-#1",
      "worker-#2",
      "worker-#3",
    ]);
    expect(
      Array.from(result.taskStatuses.values()),
    ).toEqual(["completed", "completed", "completed"]);
  });

  test("stops dispatching newly ready tasks after the ready-wave budget is exhausted", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
      { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: ["#1"] },
      { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: ["#2"] },
    ];

    const batches: string[][] = [];
    const pendingResults = new Map<
      string,
      ReturnType<typeof createDeferred<SubagentStreamResult>>
    >();

    const coordinator = new EagerDispatchCoordinator(tasks, {
      maxReadyDispatchWaves: 1,
      spawnSubagentParallel: async (
        agents: SubagentSpawnOptions[],
        _abortSignal,
        onAgentComplete,
      ) => {
        batches.push(agents.map((agent) => agent.agentId));
        return Promise.all(
          agents.map((agent) => {
            const deferred = createDeferred<SubagentStreamResult>();
            pendingResults.set(agent.agentId, deferred);
            return deferred.promise.then((result) => {
              onAgentComplete?.(result);
              return result;
            });
          }),
        );
      },
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
    });

    const execution = coordinator.execute();
    await flushMicrotasks();

    pendingResults.get("worker-#1")?.resolve(createResult("worker-#1"));
    const result = await execution;

    expect(batches).toEqual([["worker-#1"]]);
    expect(result.readyDispatchWaveCount).toBe(1);
    expect(Array.from(result.taskStatuses.values())).toEqual([
      "completed",
      "pending",
      "pending",
    ]);
  });

  test("records wave debug logs and task timings across eager dispatch waves", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
      { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
      { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: ["#1"] },
    ];

    const pendingResults = new Map<
      string,
      ReturnType<typeof createDeferred<SubagentStreamResult>>
    >();
    const debugEvents: DebugEventEntry[] = [];
    let tick = 100;

    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (
        agents: SubagentSpawnOptions[],
        _abortSignal,
        onAgentComplete,
      ) => Promise.all(
        agents.map((agent) => {
          const deferred = createDeferred<SubagentStreamResult>();
          pendingResults.set(agent.agentId, deferred);
          return deferred.promise.then((result) => {
            onAgentComplete?.(result);
            return result;
          });
        }),
      ),
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
      now: () => {
        tick += 10;
        return tick;
      },
      debugLog: (phase, data) => {
        debugEvents.push({ phase, data });
      },
    });

    const execution = coordinator.execute();
    await flushMicrotasks();

    pendingResults.get("worker-#1")?.resolve(createResult("worker-#1"));
    await flushMicrotasks();

    pendingResults.get("worker-#3")?.resolve(createResult("worker-#3"));
    pendingResults.get("worker-#2")?.resolve(createResult("worker-#2"));

    const result = await execution;

    expect(result.instrumentation.waveCount).toBe(2);
    expect(result.instrumentation.waves.map((wave) => wave.taskIds)).toEqual([
      ["#1", "#2"],
      ["#3"],
    ]);
    expect(result.instrumentation.waves.every((wave) => (wave.durationMs ?? 0) > 0)).toBe(true);

    const task1Timing = result.instrumentation.taskTimings.get(0);
    expect(task1Timing?.taskId).toBe("#1");
    expect(task1Timing?.finalStatus).toBe("completed");
    expect(task1Timing?.attempts).toHaveLength(1);
    expect(task1Timing?.attempts[0]?.waveNumber).toBe(1);
    expect(task1Timing?.attempts[0]?.outcome).toBe("completed");
    expect((task1Timing?.attempts[0]?.coordinatorDurationMs ?? 0) > 0).toBe(true);

    const task3Timing = result.instrumentation.taskTimings.get(2);
    expect(task3Timing?.taskId).toBe("#3");
    expect(task3Timing?.attempts).toHaveLength(1);
    expect(task3Timing?.attempts[0]?.waveNumber).toBe(2);
    expect(task3Timing?.attempts[0]?.outcome).toBe("completed");

    const waveStartEvents = debugEvents.filter((event) =>
      event.phase === "ralph_eager_dispatch_wave_started"
    );
    const waveCompletedEvents = debugEvents.filter((event) =>
      event.phase === "ralph_eager_dispatch_wave_completed"
    );
    expect(waveStartEvents.map(taskIdsFromDebugEvent)).toEqual([
      ["#1", "#2"],
      ["#3"],
    ]);
    expect(waveCompletedEvents.map(taskIdsFromDebugEvent)).toEqual([
      ["#3"],
      ["#1", "#2"],
    ]);
    expect(
      waveCompletedEvents.every((event) =>
        typeof event.data.durationMs === "number" && (event.data.durationMs as number) > 0
      ),
    ).toBe(true);
  });

  test("does not dispatch tasks whose dependencies fail", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
      { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: ["#1"] },
    ];

    const batches: string[][] = [];
    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (agents, _abortSignal, onAgentComplete) => {
        batches.push(agents.map((agent) => agent.agentId));
        const result = createResult(agents[0]!.agentId, false, "");
        onAgentComplete?.(result);
        return [result];
      },
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
      maxTaskRetries: 0,
    });

    const result = await coordinator.execute();

    expect(batches).toEqual([["worker-#1"]]);
    expect(result.dispatchedTaskIndices.has(0)).toBe(true);
    expect(result.dispatchedTaskIndices.has(1)).toBe(false);
    expect(result.taskStatuses.get(0)).toBe("error");
    expect(result.taskStatuses.get(1)).toBe("pending");
    expect(result.resultsByTaskIndex.has(1)).toBe(false);
  });

  test("retries failed tasks once without double-dispatching duplicate completions", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
    ];

    const batches: string[][] = [];
    const retryAttempts: number[] = [];
    let attempts = 0;

    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (
        agents,
        _abortSignal,
        onAgentComplete,
      ) => {
        batches.push(agents.map((agent) => agent.agentId));
        attempts++;
        const result = attempts === 1
          ? createResult(agents[0]!.agentId, false, "")
          : createResult(agents[0]!.agentId);
        onAgentComplete?.(result);
        return [result];
      },
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
      onTaskRetry: (_task, _taskIndex, attempt) => {
        retryAttempts.push(attempt);
      },
      maxTaskRetries: 1,
    });

    const result = await coordinator.execute();

    expect(batches).toEqual([["worker-#1"], ["worker-#1"]]);
    expect(retryAttempts).toEqual([1]);
    expect(result.resultsByTaskIndex.get(0)?.success).toBe(true);
    expect(result.taskStatuses.get(0)).toBe("completed");
  });

  test("records retry attempt timing before redispatching a task", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
    ];

    const debugEvents: DebugEventEntry[] = [];
    let attempts = 0;
    let tick = 0;

    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (
        agents,
        _abortSignal,
        onAgentComplete,
      ) => {
        attempts++;
        const result = attempts === 1
          ? createResult(agents[0]!.agentId, false, "")
          : createResult(agents[0]!.agentId);
        onAgentComplete?.(result);
        return [result];
      },
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
      maxTaskRetries: 1,
      now: () => {
        tick += 7;
        return tick;
      },
      debugLog: (phase, data) => {
        debugEvents.push({ phase, data });
      },
    });

    const result = await coordinator.execute();

    const taskTiming = result.instrumentation.taskTimings.get(0);
    expect(taskTiming?.attempts).toHaveLength(2);
    expect(taskTiming?.attempts.map((attempt) => attempt.waveNumber)).toEqual([1, 2]);
    expect(taskTiming?.attempts.map((attempt) => attempt.outcome)).toEqual([
      "retry",
      "completed",
    ]);
    expect(taskTiming?.finalStatus).toBe("completed");

    const retryEvents = debugEvents.filter((event) =>
      event.phase === "ralph_eager_dispatch_task_retry"
    );
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]?.data.taskId).toBe("#1");
    expect(retryEvents[0]?.data.outcome).toBe("retry");
  });

  test("aborts remaining in-flight work when a task exhausts retries", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
      { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
    ];

    const batches: string[][] = [];
    const workflowAbortErrors: string[] = [];
    const task2Deferred = createDeferred<SubagentStreamResult>();
    let task1Attempts = 0;

    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (
        agents: SubagentSpawnOptions[],
        _abortSignal,
        onAgentComplete,
      ) => {
        batches.push(agents.map((agent) => agent.agentId));
        return Promise.all(
          agents.map((agent) => {
            if (agent.agentId === "worker-#1") {
              task1Attempts++;
              const result = createResult(agent.agentId, false, "");
              onAgentComplete?.(result);
              return result;
            }

            return task2Deferred.promise.then((result) => {
              onAgentComplete?.(result);
              return result;
            });
          }),
        );
      },
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
      onWorkflowAbort: (_task, _taskIndex, error) => {
        workflowAbortErrors.push(error);
      },
      maxTaskRetries: 1,
    });

    const execution = coordinator.execute();
    await flushMicrotasks();

    task2Deferred.resolve(createAbortResult("worker-#2"));
    const result = await execution;

    expect(task1Attempts).toBe(2);
    expect(batches).toEqual([
      ["worker-#1", "worker-#2"],
      ["worker-#1"],
    ]);
    expect(workflowAbortErrors).toEqual(["Failed worker-#1"]);
    expect(result.taskStatuses.get(0)).toBe("error");
    expect(result.taskStatuses.get(1)).toBe("error");
    expect(result.resultsByTaskIndex.get(1)?.success).toBe(false);
  });

  test("does not retry tasks after external abort", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
    ];

    const batches: string[][] = [];
    const retryAttempts: number[] = [];
    const deferred = createDeferred<SubagentStreamResult>();
    const abortController = new AbortController();

    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (
        agents,
        _abortSignal,
        onAgentComplete,
      ) => {
        batches.push(agents.map((agent) => agent.agentId));
        return Promise.all(
          agents.map((_agent) =>
            deferred.promise.then((result) => {
              onAgentComplete?.(result);
              return result;
            })),
        );
      },
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
      onTaskRetry: (_task, _taskIndex, attempt) => {
        retryAttempts.push(attempt);
      },
      abortSignal: abortController.signal,
      maxTaskRetries: 2,
    });

    const execution = coordinator.execute();
    await flushMicrotasks();

    abortController.abort("User cancelled workflow");
    deferred.resolve(createAbortResult("worker-#1"));

    const result = await execution;

    expect(batches).toEqual([["worker-#1"]]);
    expect(retryAttempts).toEqual([]);
    expect(result.taskStatuses.get(0)).toBe("error");
    expect(result.resultsByTaskIndex.get(0)?.success).toBe(false);
  });

  test("returns empty results when no tasks are initially ready", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: ["#2"] },
      { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: ["#1"] },
    ];

    const spawnCalls: SubagentSpawnOptions[][] = [];
    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async (agents) => {
        spawnCalls.push(agents);
        return [];
      },
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
    });

    const result = await coordinator.execute();

    expect(spawnCalls).toEqual([]);
    expect(Array.from(result.dispatchedTaskIndices)).toEqual([]);
    expect(Array.from(result.resultsByTaskIndex.entries())).toEqual([]);
    expect(
      Array.from(result.taskStatuses.entries()),
    ).toEqual([
      [0, "pending"],
      [1, "pending"],
    ]);
  });

  test("fails when a dispatched task never produces a final completion result", async () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
    ];

    const coordinator = new EagerDispatchCoordinator(tasks, {
      spawnSubagentParallel: async () => [],
      buildSpawnConfig: (task) => ({
        agentId: `worker-${task.id}`,
        agentName: "worker",
        task: task.description,
      }),
    });

    await expect(coordinator.execute()).rejects.toThrow(
      "Eager dispatch reconciliation invariant failed: tasks still active after completion [#1]",
    );
  });
});
