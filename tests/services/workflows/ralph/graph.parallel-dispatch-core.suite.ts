import { describe, expect, test } from "bun:test";
import { executeGraph } from "@/services/workflows/graph/compiled.ts";
import { createRalphWorkflow } from "@/services/workflows/ralph/graph.ts";
import { createRalphState } from "@/services/workflows/ralph/state.ts";
import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";
import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/types.ts";
import {
  createMockRegistry,
  createMockSpawnFunctions,
  createWorkflowWithMockBridge,
} from "./graph.fixtures.ts";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(
  predicate: () => boolean,
  attempts = 50,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) {
      return;
    }
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for test condition");
}

describe("createRalphWorkflow - Parallel Worker Dispatch", () => {
  test("dispatches all independent tasks in a single spawnSubagentParallel call", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
        { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
        { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    mockResponses.set("worker", (opts) => ({
      agentId: opts.agentId,
      success: true,
      output: `Completed ${opts.agentId}`,
      toolUses: 1,
      durationMs: 10,
    }));

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "All good",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const parallelCalls: SubagentSpawnOptions[][] = [];
    const { spawnSubagent, spawnSubagentParallel } = createMockSpawnFunctions(mockResponses);

    const trackingSpawnParallel = async (agents: SubagentSpawnOptions[]): Promise<SubagentStreamResult[]> => {
      parallelCalls.push([...agents]);
      return spawnSubagentParallel(agents);
    };

    const workflow = createRalphWorkflow();
    const workflowWithMocks = {
      ...workflow,
      config: {
        ...workflow.config,
        runtime: {
          spawnSubagent,
          spawnSubagentParallel: trackingSpawnParallel,
          subagentRegistry: createMockRegistry(),
        },
      },
    };

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-parallel-1", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflowWithMocks, {
      initialState,
      executionId: "test-parallel-1",
    });

    expect(result.status).toBe("completed");
    expect(result.state.tasks).toHaveLength(3);
    expect(result.state.tasks.every((task: any) => task.status === "completed")).toBe(true);

    const workerBatches = parallelCalls.filter(
      (batch) => batch.some((agent) => agent.agentName === "worker"),
    );
    expect(workerBatches).toHaveLength(1);
    expect(workerBatches[0]).toHaveLength(3);
    expect(workerBatches[0]!.map((agent) => agent.agentId).sort()).toEqual([
      "worker-#1",
      "worker-#2",
      "worker-#3",
    ]);
  });

  test("does not dispatch extra eager waves for flat DAG tasks that finish out of order", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-flat-dag",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
        { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
        { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-flat-dag",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Flat DAG completed in one wave",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const { spawnSubagent } = createMockSpawnFunctions(mockResponses);
    const workerBatches: string[][] = [];
    const pendingWorkerResults = new Map<
      string,
      ReturnType<typeof createDeferred<SubagentStreamResult>>
    >();

    const workflow = createRalphWorkflow();
    const workflowWithMocks = {
      ...workflow,
      config: {
        ...workflow.config,
        runtime: {
          spawnSubagent,
          spawnSubagentParallel: async (
            agents: SubagentSpawnOptions[],
            _abortSignal?: AbortSignal,
            onAgentComplete?: (result: SubagentStreamResult) => void,
          ) => {
            workerBatches.push(agents.map((agent) => agent.agentId));
            return Promise.all(
              agents.map((agent) => {
                const deferred = createDeferred<SubagentStreamResult>();
                pendingWorkerResults.set(agent.agentId, deferred);
                return deferred.promise.then((result) => {
                  onAgentComplete?.(result);
                  return result;
                });
              }),
            );
          },
          subagentRegistry: createMockRegistry(),
        },
      },
    };

    const execution = executeGraph(workflowWithMocks, {
      initialState: {
        ...createRalphState("test-flat-dag-regression", { yoloPrompt: "test prompt" }),
        maxIterations: 10,
        ralphSessionDir: "/tmp/test-session",
      },
      executionId: "test-flat-dag-regression",
    });

    await waitFor(() => workerBatches.length === 1);
    expect(workerBatches).toEqual([["worker-#1", "worker-#2", "worker-#3"]]);

    pendingWorkerResults.get("worker-#2")?.resolve({
      agentId: "worker-#2",
      success: true,
      output: "Completed #2",
      toolUses: 1,
      durationMs: 10,
    });
    await flushMicrotasks();
    expect(workerBatches).toHaveLength(1);

    pendingWorkerResults.get("worker-#3")?.resolve({
      agentId: "worker-#3",
      success: true,
      output: "Completed #3",
      toolUses: 1,
      durationMs: 10,
    });
    await flushMicrotasks();
    expect(workerBatches).toHaveLength(1);

    pendingWorkerResults.get("worker-#1")?.resolve({
      agentId: "worker-#1",
      success: true,
      output: "Completed #1",
      toolUses: 1,
      durationMs: 10,
    });

    const result = await execution;

    expect(result.status).toBe("completed");
    expect(workerBatches).toEqual([["worker-#1", "worker-#2", "worker-#3"]]);
    expect(result.state.tasks.map((task: any) => task.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(result.state.iteration).toBe(1);
  });

  test("returns error when spawnSubagentParallel is not available", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    const { spawnSubagent } = createMockSpawnFunctions(mockResponses);

    const workflow = createRalphWorkflow();
    const workflowWithMocks = {
      ...workflow,
      config: {
        ...workflow.config,
        runtime: {
          spawnSubagent,
          subagentRegistry: createMockRegistry(),
        },
      },
    };

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-no-parallel", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflowWithMocks, {
      initialState,
      executionId: "test-no-parallel",
    });

    expect(result.status).toBe("failed");
    const errorMessages = result.snapshot.errors.map((entry: any) => {
      const error = entry.error;
      return typeof error === "string" ? error : error?.message ?? "";
    });
    expect(errorMessages.some((message: string) =>
      message.includes("RalphWorkflowContext requires spawnSubagentParallel in runtime config"),
    )).toBe(true);
  });

  test("maps results independently — failed tasks get error, successful get completed", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
        { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
        { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    mockResponses.set("worker", (opts) => {
      const isTask2 = opts.agentId === "worker-#2";
      return {
        agentId: opts.agentId,
        success: !isTask2,
        output: isTask2 ? "Failed" : "Completed",
        error: isTask2 ? "Task 2 failed" : undefined,
        toolUses: 1,
        durationMs: 10,
      };
    });

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Mixed results",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-mixed-results", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-mixed-results",
      maxSteps: 50,
    });

    expect(result.status).toBe("completed");
    const task1 = result.state.tasks.find((task: any) => task.id === "#1");
    const task2 = result.state.tasks.find((task: any) => task.id === "#2");
    const task3 = result.state.tasks.find((task: any) => task.id === "#3");
    expect(task1?.status).toBe("completed");
    expect(task2?.status).toBe("error");
    expect(task3?.status).toBe("completed");
  });

  test("retries worker failures and preserves the final successful result", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-retry",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    const workerAttempts = new Map<string, number>();
    mockResponses.set("worker", (opts) => {
      const attempt = (workerAttempts.get(opts.agentId) ?? 0) + 1;
      workerAttempts.set(opts.agentId, attempt);
      const success = attempt > 1;
      return {
        agentId: opts.agentId,
        success,
        output: success ? "Completed after retry" : "",
        error: success ? undefined : "Failed first attempt",
        toolUses: 1,
        durationMs: 10,
      };
    });

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-retry",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Done",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);
    const result = await executeGraph(workflow, {
      initialState: {
        ...createRalphState("test-worker-retry", { yoloPrompt: "test prompt" }),
        maxIterations: 10,
        ralphSessionDir: "/tmp/test-session",
      },
      executionId: "test-worker-retry",
    });

    expect(result.status).toBe("completed");
    expect(workerAttempts.get("worker-#1")).toBe(2);
    const task = result.state.tasks.find((entry: any) => entry.id === "#1");
    expect(task?.status).toBe("completed");
    expect(task?.taskResult?.status).toBe("completed");
    expect(task?.taskResult?.output_text).toBe("Completed after retry");
  });

  test("assigns unique worker agent IDs when task IDs are duplicated", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-dup",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task A", status: "pending", summary: "Doing A", blockedBy: [] },
        { id: "#1", description: "Task B", status: "pending", summary: "Doing B", blockedBy: [] },
        { id: "#2", description: "Task C", status: "pending", summary: "Doing C", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    mockResponses.set("worker", (opts) => ({
      agentId: opts.agentId,
      success: true,
      output: "ok",
      toolUses: 1,
      durationMs: 10,
    }));

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-dup",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "All good",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const workerBatchAgentIds: string[] = [];
    const { spawnSubagent, spawnSubagentParallel } = createMockSpawnFunctions(mockResponses);
    const trackingSpawnParallel = async (agents: SubagentSpawnOptions[]) => {
      if (agents.some((agent) => agent.agentName === "worker")) {
        workerBatchAgentIds.push(...agents.map((agent) => agent.agentId));
      }
      return spawnSubagentParallel(agents);
    };

    const workflow = createRalphWorkflow();
    const workflowWithMocks = {
      ...workflow,
      config: {
        ...workflow.config,
        runtime: {
          spawnSubagent,
          spawnSubagentParallel: trackingSpawnParallel,
          subagentRegistry: createMockRegistry(),
        },
      },
    };

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-duplicate-task-ids", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflowWithMocks, {
      initialState,
      executionId: "test-duplicate-task-ids",
    });

    expect(result.status).toBe("completed");
    expect(workerBatchAgentIds.sort()).toEqual([
      "worker-#1",
      "worker-#1-2",
      "worker-#2",
    ]);
    expect(result.state.tasks.map((task: any) => task.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
  });

  test("keeps iteration at one when all tasks dispatch in a single ready wave", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
        { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
        { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: [] },
        { id: "#4", description: "Task 4", status: "pending", summary: "Doing 4", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    mockResponses.set("worker", (opts) => ({
      agentId: opts.agentId,
      success: true,
      output: "Completed",
      toolUses: 1,
      durationMs: 10,
    }));

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "All done",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-iteration-count", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-iteration-count",
    });

    expect(result.status).toBe("completed");
    expect(result.state.tasks).toHaveLength(4);
    expect(result.state.tasks.every((task: any) => task.status === "completed")).toBe(true);
    expect(result.state.iteration).toBe(1);
  });

  test("dispatches newly unblocked tasks before unrelated ready tasks finish in the same worker-node execution", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-eager",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
        { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: [] },
        { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: ["#1"] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-eager",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "All good",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const { spawnSubagent } = createMockSpawnFunctions(mockResponses);
    const workerWaves: string[][] = [];
    const pendingWorkerResults = new Map<
      string,
      ReturnType<typeof createDeferred<SubagentStreamResult>>
    >();

    const workflow = createRalphWorkflow();
    const workflowWithMocks = {
      ...workflow,
      config: {
        ...workflow.config,
        runtime: {
          spawnSubagent,
          spawnSubagentParallel: async (
            agents: SubagentSpawnOptions[],
            _abortSignal?: AbortSignal,
            onAgentComplete?: (result: SubagentStreamResult) => void,
          ) => {
            workerWaves.push(agents.map((agent) => agent.agentId));
            return Promise.all(
              agents.map((agent) => {
                const deferred = createDeferred<SubagentStreamResult>();
                pendingWorkerResults.set(agent.agentId, deferred);
                return deferred.promise.then((result) => {
                  onAgentComplete?.(result);
                  return result;
                });
              }),
            );
          },
          subagentRegistry: createMockRegistry(),
        },
      },
    };

    const execution = executeGraph(workflowWithMocks, {
      initialState: {
        ...createRalphState("test-eager-dispatch", { yoloPrompt: "test prompt" }),
        maxIterations: 10,
        ralphSessionDir: "/tmp/test-session",
      },
      executionId: "test-eager-dispatch",
    });

    await waitFor(() => workerWaves.length === 1);
    expect(workerWaves).toEqual([["worker-#1", "worker-#2"]]);

    pendingWorkerResults.get("worker-#1")?.resolve({
      agentId: "worker-#1",
      success: true,
      output: "Completed #1",
      toolUses: 1,
      durationMs: 10,
    });

    await waitFor(() => workerWaves.length === 2);
    expect(workerWaves).toEqual([
      ["worker-#1", "worker-#2"],
      ["worker-#3"],
    ]);

    pendingWorkerResults.get("worker-#3")?.resolve({
      agentId: "worker-#3",
      success: true,
      output: "Completed #3",
      toolUses: 1,
      durationMs: 10,
    });
    pendingWorkerResults.get("worker-#2")?.resolve({
      agentId: "worker-#2",
      success: true,
      output: "Completed #2",
      toolUses: 1,
      durationMs: 10,
    });

    const result = await execution;

    expect(result.status).toBe("completed");
    expect(result.state.tasks.map((task: any) => task.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(result.state.iteration).toBe(2);
  });
});
