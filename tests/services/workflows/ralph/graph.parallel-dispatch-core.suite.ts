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

    mockResponses.set("worker", (opts) => {
      const secondDuplicate = opts.agentId.endsWith("-2");
      return {
        agentId: opts.agentId,
        success: !secondDuplicate,
        output: secondDuplicate ? "duplicate failed" : "ok",
        error: secondDuplicate ? "duplicate failure" : undefined,
        toolUses: 1,
        durationMs: 10,
      };
    });

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
      "error",
      "completed",
    ]);
  });

  test("increments iteration by 1 per batch, not per task", async () => {
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
});
