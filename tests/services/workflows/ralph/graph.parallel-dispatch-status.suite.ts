import { describe, expect, test } from "bun:test";
import { executeGraph } from "@/services/workflows/graph/compiled.ts";
import { createRalphWorkflow } from "@/services/workflows/ralph/graph.ts";
import { createRalphState } from "@/services/workflows/ralph/state.ts";
import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";
import { TaskIdentityService } from "@/services/workflows/task-identity-service.ts";
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
  test("calls notifyTaskStatusChange with per-task in_progress updates before spawning", async () => {
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
        overall_explanation: "Done",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const statusChangeCalls: Array<{
      taskIds: string[];
      newStatus: string;
      tasks: Array<{ id: string; title: string; status: string }>;
    }> = [];

    const { spawnSubagent, spawnSubagentParallel } = createMockSpawnFunctions(mockResponses);

    const workflow = createRalphWorkflow();
    const workflowWithMocks = {
      ...workflow,
      config: {
        ...workflow.config,
        runtime: {
          spawnSubagent,
          spawnSubagentParallel,
          taskIdentity: new TaskIdentityService(),
          subagentRegistry: createMockRegistry(),
          notifyTaskStatusChange: (
            taskIds: string[],
            newStatus: string,
            tasks: Array<{ id: string; title: string; status: string }>,
          ) => {
            statusChangeCalls.push({ taskIds, newStatus, tasks });
          },
        },
      },
    };

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-status-change", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflowWithMocks, {
      initialState,
      executionId: "test-status-change",
    });

    expect(result.status).toBe("completed");

    const inProgressCalls = statusChangeCalls.filter((call) => call.newStatus === "in_progress");
    expect(inProgressCalls).toHaveLength(2);

    expect(inProgressCalls.map((call) => call.taskIds[0]).sort()).toEqual(["#1", "#2"]);
    expect(inProgressCalls.every((call) => call.tasks.length === 1)).toBe(true);

    const firstTaskIdentity = (inProgressCalls[0]?.tasks[0] as any)?.identity;
    expect(firstTaskIdentity?.providerBindings?.subagent_id?.length ?? 0).toBeGreaterThan(0);
  });

  test("emits per-task status changes during eager dispatch waves", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-wave",
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
      agentId: "reviewer-wave",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Done",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const pendingResults = new Map<
      string,
      ReturnType<typeof createDeferred<SubagentStreamResult>>
    >();
    const workerWaves: string[][] = [];
    const statusChangeCalls: Array<{
      taskIds: string[];
      newStatus: string;
      tasks: Array<{ id: string; title: string; status: string }>;
    }> = [];

    const { spawnSubagent } = createMockSpawnFunctions(mockResponses);
    const spawnSubagentParallel = async (
      agents: SubagentSpawnOptions[],
      _abortSignal?: AbortSignal,
      onAgentComplete?: (result: SubagentStreamResult) => void,
    ): Promise<SubagentStreamResult[]> => {
      workerWaves.push(agents.map((agent) => agent.agentId));
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
    };

    const workflow = createRalphWorkflow();
    const workflowWithMocks = {
      ...workflow,
      config: {
        ...workflow.config,
        runtime: {
          spawnSubagent,
          spawnSubagentParallel,
          taskIdentity: new TaskIdentityService(),
          subagentRegistry: createMockRegistry(),
          notifyTaskStatusChange: (
            taskIds: string[],
            newStatus: string,
            tasks: Array<{ id: string; title: string; status: string }>,
          ) => {
            statusChangeCalls.push({ taskIds, newStatus, tasks });
          },
        },
      },
    };

    const execution = executeGraph(workflowWithMocks, {
      initialState: {
        ...createRalphState("test-status-change-waves", { yoloPrompt: "test prompt" }),
        maxIterations: 10,
        ralphSessionDir: "/tmp/test-session",
      },
      executionId: "test-status-change-waves",
    });

    await waitFor(() => workerWaves.length === 1);
    expect(workerWaves).toEqual([["worker-#1", "worker-#2"]]);

    pendingResults.get("worker-#1")?.resolve({
      agentId: "worker-#1",
      success: true,
      output: "Completed Task 1",
      toolUses: 1,
      durationMs: 10,
    });

    await waitFor(() => workerWaves.length === 2);
    expect(workerWaves).toEqual([
      ["worker-#1", "worker-#2"],
      ["worker-#3"],
    ]);

    pendingResults.get("worker-#3")?.resolve({
      agentId: "worker-#3",
      success: true,
      output: "Completed Task 3",
      toolUses: 1,
      durationMs: 10,
    });
    pendingResults.get("worker-#2")?.resolve({
      agentId: "worker-#2",
      success: true,
      output: "Completed Task 2",
      toolUses: 1,
      durationMs: 10,
    });

    const result = await execution;
    expect(result.status).toBe("completed");

    const inProgressCalls = statusChangeCalls.filter((call) => call.newStatus === "in_progress");
    expect(inProgressCalls.map((call) => call.taskIds[0])).toEqual(["#1", "#2", "#3"]);
    expect(inProgressCalls.every((call) => call.tasks.length === 1)).toBe(true);

    const task1CompletedIndex = statusChangeCalls.findIndex((call) =>
      call.newStatus === "completed" && call.taskIds[0] === "#1"
    );
    const task3InProgressIndex = statusChangeCalls.findIndex((call) =>
      call.newStatus === "in_progress" && call.taskIds[0] === "#3"
    );

    expect(task1CompletedIndex).toBeGreaterThan(-1);
    expect(task3InProgressIndex).toBeGreaterThan(task1CompletedIndex);

    const task3InProgressCall = inProgressCalls.find((call) => call.taskIds[0] === "#3");
    expect(task3InProgressCall?.tasks[0]).toMatchObject({
      id: "#3",
      title: "Task 3",
      status: "in_progress",
    });

    const task3Identity = (task3InProgressCall?.tasks[0] as any)?.identity;
    expect(task3Identity?.providerBindings?.subagent_id?.length ?? 0).toBeGreaterThan(0);
  });

  test("attaches task result envelope with canonical identity metadata", async () => {
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

    mockResponses.set("worker", (opts) => ({
      agentId: opts.agentId,
      success: true,
      output: "Completed Task 1",
      toolUses: 1,
      durationMs: 10,
    }));

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
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
        ...createRalphState("test-task-result-envelope", { yoloPrompt: "test prompt" }),
        maxIterations: 10,
        ralphSessionDir: "/tmp/test-session",
      },
      executionId: "test-task-result-envelope",
    });

    expect(result.status).toBe("completed");
    const task = result.state.tasks.find((entry: any) => entry.id === "#1");
    expect(task?.taskResult).toMatchObject({
      task_id: "#1",
      tool_name: "task",
      status: "completed",
      metadata: {
        sessionId: "test-task-result-envelope",
      },
      output_text: "Completed Task 1",
    });
    expect(task?.taskResult?.metadata?.providerBindings?.subagent_id).toBe("worker-#1");
    expect(task?.taskResult?.envelope_text).toContain("<task_result>");
  });

  test("preserves later-wave task identity binding in the final reconciled result", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-late-wave",
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
      agentId: "reviewer-late-wave",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Done",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const pendingResults = new Map<
      string,
      ReturnType<typeof createDeferred<SubagentStreamResult>>
    >();
    const { spawnSubagent } = createMockSpawnFunctions(mockResponses);
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
          taskIdentity: new TaskIdentityService(),
          subagentRegistry: createMockRegistry(),
        },
      },
    };

    const execution = executeGraph(workflowWithMocks, {
      initialState: {
        ...createRalphState("test-late-wave-task-result", { yoloPrompt: "test prompt" }),
        maxIterations: 10,
        ralphSessionDir: "/tmp/test-session",
      },
      executionId: "test-late-wave-task-result",
    });

    await waitFor(() => pendingResults.has("worker-#1") && pendingResults.has("worker-#2"));

    pendingResults.get("worker-#1")?.resolve({
      agentId: "worker-#1",
      success: true,
      output: "Completed Task 1",
      toolUses: 1,
      durationMs: 10,
    });

    await waitFor(() => pendingResults.has("worker-#3"));

    pendingResults.get("worker-#3")?.resolve({
      agentId: "worker-#3",
      success: true,
      output: "Completed Task 3",
      toolUses: 1,
      durationMs: 10,
    });
    pendingResults.get("worker-#2")?.resolve({
      agentId: "worker-#2",
      success: true,
      output: "Completed Task 2",
      toolUses: 1,
      durationMs: 10,
    });

    const result = await execution;
    expect(result.status).toBe("completed");

    const task = result.state.tasks.find((entry: any) => entry.id === "#3");
    expect(task?.identity?.canonicalId).toBe("#3");
    expect(task?.identity?.providerBindings?.subagent_id).toEqual(["worker-#3"]);
    expect(task?.taskResult).toMatchObject({
      task_id: "#3",
      tool_name: "task",
      status: "completed",
      output_text: "Completed Task 3",
      metadata: {
        sessionId: "test-late-wave-task-result",
        providerBindings: {
          subagent_id: "worker-#3",
        },
      },
    });
  });

  test("worker prompt includes completed task context from earlier eager-dispatch waves", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", description: "Task 1", status: "pending", summary: "Doing 1", blockedBy: [] },
        { id: "#2", description: "Task 2", status: "pending", summary: "Doing 2", blockedBy: ["#1"] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    const workerPrompts: string[] = [];
    mockResponses.set("worker", (opts) => {
      workerPrompts.push(opts.task);
      return {
        agentId: opts.agentId,
        success: true,
        output: "Completed",
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
        overall_explanation: "Done",
      }),
      toolUses: 1,
      durationMs: 10,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-progress-context", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-progress-context",
    });

    expect(result.status).toBe("completed");
    expect(workerPrompts).toHaveLength(2);
    expect(workerPrompts[1]).toContain("#1");
    expect(workerPrompts[1]).toContain("Task 1");
    expect(workerPrompts[1]).toContain("Completed");
  });
});
