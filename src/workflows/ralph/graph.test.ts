/**
 * Integration tests for createRalphWorkflow()
 *
 * These tests verify the 3-phase flow of the Ralph workflow with mocked spawn functions:
 * Phase 1: Planner subagent → parse-tasks tool (decompose prompt into task list)
 * Phase 2: Worker loop (select ready tasks → worker subagent, repeats until all done)
 * Phase 3: Reviewer subagent → conditional fixer subagent
 */

import { describe, expect, test } from "bun:test";
import { executeGraph, streamGraph } from "../graph/compiled.ts";
import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "../graph/types.ts";
import { createRalphWorkflow } from "./graph.ts";
import { createRalphState } from "./state.ts";
import type { RalphWorkflowState } from "./state.ts";

// ============================================================================
// MOCK SPAWN FUNCTIONS
// ============================================================================

/**
 * Mock spawn functions for testing.
 * Maps agent names to response handlers.
 */
function createMockSpawnFunctions(
  responses: Map<
    string,
    (opts: SubagentSpawnOptions) => SubagentStreamResult | Promise<SubagentStreamResult>
  >
) {
  async function spawnSubagent(agent: SubagentSpawnOptions): Promise<SubagentStreamResult> {
    const handler = responses.get(agent.agentName);
    if (!handler) {
      return {
        agentId: agent.agentId,
        success: false,
        output: "",
        error: `No handler for agent: ${agent.agentName}`,
        toolUses: 0,
        durationMs: 0,
      };
    }
    return await handler(agent);
  }

  async function spawnSubagentParallel(
    agents: SubagentSpawnOptions[]
  ): Promise<SubagentStreamResult[]> {
    return Promise.all(agents.map((a) => spawnSubagent(a)));
  }

  return { spawnSubagent, spawnSubagentParallel };
}

/**
 * Mock SubagentRegistry that returns a dummy entry for any requested agent.
 */
function createMockRegistry() {
  return {
    get(name: string) {
      return {
        name,
        info: {
          name,
          description: `Mock agent: ${name}`,
          source: "project" as const,
          filePath: `/mock/${name}.md`,
        },
        source: "project" as const,
      };
    },
    getAll() {
      return [];
    },
  };
}

/**
 * Helper to create a workflow with mock spawn functions and registry injected.
 */
function createWorkflowWithMockBridge(
  responses: Map<
    string,
    (opts: SubagentSpawnOptions) => SubagentStreamResult | Promise<SubagentStreamResult>
  >
) {
  const baseWorkflow = createRalphWorkflow();
  const { spawnSubagent, spawnSubagentParallel } = createMockSpawnFunctions(responses);
  return {
    ...baseWorkflow,
    config: {
      ...baseWorkflow.config,
      runtime: {
        spawnSubagent,
        spawnSubagentParallel,
        subagentRegistry: createMockRegistry(),
      },
    },
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("createRalphWorkflow - Basic Compilation", () => {
  test("compiles without error", () => {
    const workflow = createRalphWorkflow();

    expect(workflow).toBeDefined();
    expect(workflow.nodes.size).toBeGreaterThan(0);
    expect(workflow.startNode).toBe("planner");
    expect(workflow.nodes.has("planner")).toBe(true);
    expect(workflow.nodes.has("parse-tasks")).toBe(true);
    expect(workflow.nodes.has("select-ready-tasks")).toBe(true);
    expect(workflow.nodes.has("worker")).toBe(true);
    expect(workflow.nodes.has("reviewer")).toBe(true);
    expect(workflow.nodes.has("fixer")).toBe(true);
  });
});

describe("createRalphWorkflow - 3-Phase Flow", () => {
  test("executes 3-phase flow with simple tasks", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns JSON task list with 2 independent tasks
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        {
          id: "#1",
          content: "Task 1",
          status: "pending",
          activeForm: "Doing task 1",
          blockedBy: [],
        },
        {
          id: "#2",
          content: "Task 2",
          status: "pending",
          activeForm: "Doing task 2",
          blockedBy: [],
        },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker completes tasks (will be called twice, once for each task)
    let workerCallCount = 0;
    mockResponses.set("worker", () => {
      workerCallCount++;
      return {
        agentId: `worker-${workerCallCount}`,
        success: true,
        output: `Completed task ${workerCallCount}`,
        toolUses: 2,
        durationMs: 50,
      };
    });

    // Phase 3: Reviewer returns "patch is correct"
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "All tasks completed successfully",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    // Create compiled workflow with mock bridge
    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-1", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-1",
    });

    expect(result.status).toBe("completed");
    expect(result.state.tasks).toHaveLength(2);
    expect(result.state.tasks[0]?.status).toBe("completed");
    expect(result.state.tasks[1]?.status).toBe("completed");
    expect(result.state.reviewResult).toBeDefined();
    expect(result.state.reviewResult?.overall_correctness).toBe(
      "patch is correct"
    );
    expect(result.state.fixesApplied).toBe(false);
    // Worker is called once per task — each iteration dispatches ready[0]
    // and only marks that single dispatched task as completed
    expect(workerCallCount).toBe(2);
  });

  test("handles task dependencies in worker loop", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns tasks where #2 is blocked by #1
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        {
          id: "#1",
          content: "Task 1",
          status: "pending",
          activeForm: "Doing task 1",
          blockedBy: [],
        },
        {
          id: "#2",
          content: "Task 2",
          status: "pending",
          activeForm: "Doing task 2",
          blockedBy: ["#1"],
        },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker completes tasks
    const executionOrder: string[] = [];
    mockResponses.set("worker", (opts) => {
      // Parse task from the worker assignment prompt
      const taskMatch = opts.task.match(/\*\*Task ID:\*\* (#\d+)/);
      const taskId = taskMatch?.[1] ?? "unknown";
      executionOrder.push(taskId);

      return {
        agentId: `worker-${taskId}`,
        success: true,
        output: `Completed ${taskId}`,
        toolUses: 2,
        durationMs: 50,
      };
    });

    // Phase 3: Reviewer
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Dependencies respected",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-2", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-2",
    });

    expect(result.status).toBe("completed");
    expect(result.state.tasks).toHaveLength(2);
    expect(result.state.tasks[0]?.status).toBe("completed");
    expect(result.state.tasks[1]?.status).toBe("completed");

    // Verify execution order: #1 must complete before #2
    expect(executionOrder).toEqual(["#1", "#2"]);
  });

  test("triggers fixer when review has findings", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        {
          id: "#1",
          content: "Task 1",
          status: "pending",
          activeForm: "Doing task 1",
          blockedBy: [],
        },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker
    mockResponses.set("worker", () => ({
      agentId: "worker-1",
      success: true,
      output: "Completed task 1",
      toolUses: 2,
      durationMs: 50,
    }));

    // Phase 3: Reviewer returns findings with "patch is incorrect"
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [
          {
            title: "[P0] Critical bug found",
            body: "Logic error in implementation",
            confidence_score: 0.95,
            priority: 0,
          },
        ],
        overall_correctness: "patch is incorrect",
        overall_explanation: "Critical issues found",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    // Fixer should be triggered
    let fixerCalled = false;
    mockResponses.set("debugger", () => {
      fixerCalled = true;
      return {
        agentId: "fixer-1",
        success: true,
        output: "Applied fixes",
        toolUses: 3,
        durationMs: 100,
      };
    });

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-3", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-3",
    });

    expect(result.status).toBe("completed");
    expect(result.state.reviewResult?.overall_correctness).toBe(
      "patch is incorrect"
    );
    expect(result.state.reviewResult?.findings).toHaveLength(1);
    expect(fixerCalled).toBe(true);
    expect(result.state.fixesApplied).toBe(true);
  });

  test("skips fixer when review is clean", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        {
          id: "#1",
          content: "Task 1",
          status: "pending",
          activeForm: "Doing task 1",
          blockedBy: [],
        },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker
    mockResponses.set("worker", () => ({
      agentId: "worker-1",
      success: true,
      output: "Completed task 1",
      toolUses: 2,
      durationMs: 50,
    }));

    // Phase 3: Reviewer returns "patch is correct"
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "No issues found",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    // Fixer should NOT be triggered
    let fixerCalled = false;
    mockResponses.set("debugger", () => {
      fixerCalled = true;
      return {
        agentId: "fixer-1",
        success: true,
        output: "Applied fixes",
        toolUses: 3,
        durationMs: 100,
      };
    });

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-4", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-4",
    });

    expect(result.status).toBe("completed");
    expect(result.state.reviewResult?.overall_correctness).toBe(
      "patch is correct"
    );
    expect(fixerCalled).toBe(false);
    expect(result.state.fixesApplied).toBe(false);
  });
});

describe("createRalphWorkflow - Worker Loop", () => {
  test("exits loop when no actionable tasks remain", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns tasks where #2 depends on #1, but #1 will error
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        {
          id: "#1",
          content: "Task 1",
          status: "pending",
          activeForm: "Doing task 1",
          blockedBy: [],
        },
        {
          id: "#2",
          content: "Task 2",
          status: "pending",
          activeForm: "Doing task 2",
          blockedBy: ["#1"],
        },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker fails for task #1
    let workerCallCount = 0;
    mockResponses.set("worker", () => {
      workerCallCount++;
      return {
        agentId: `worker-${workerCallCount}`,
        success: false,
        output: "Failed to complete task",
        error: "Task 1 failed",
        toolUses: 1,
        durationMs: 20,
      };
    });

    // Phase 3: Reviewer
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Some tasks incomplete",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-5", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-5",
      maxSteps: 50,
    });

    // Worker failure sets task #1 to "error", making #2 stuck (dependency on errored #1).
    // Loop exits because hasActionableTasks returns false. Workflow completes (not fails).
    expect(result.status).toBe("completed");
    expect(workerCallCount).toBe(1);
    // Task #1 should be "error", #2 should still be "pending" (blocked)
    const task1 = result.state.tasks.find((t: any) => t.id === "#1");
    const task2 = result.state.tasks.find((t: any) => t.id === "#2");
    expect(task1?.status).toBe("error");
    expect(task2?.status).toBe("pending");
  });

  test("respects maxIterations limit", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns 5 chained tasks (each blocked by previous)
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing 1", blockedBy: [] },
        { id: "#2", content: "Task 2", status: "pending", activeForm: "Doing 2", blockedBy: ["#1"] },
        { id: "#3", content: "Task 3", status: "pending", activeForm: "Doing 3", blockedBy: ["#2"] },
        { id: "#4", content: "Task 4", status: "pending", activeForm: "Doing 4", blockedBy: ["#3"] },
        { id: "#5", content: "Task 5", status: "pending", activeForm: "Doing 5", blockedBy: ["#4"] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker always succeeds but processes one task per iteration
    let workerCallCount = 0;
    mockResponses.set("worker", () => {
      workerCallCount++;
      return {
        agentId: `worker-${workerCallCount}`,
        success: true,
        output: `Completed task ${workerCallCount}`,
        toolUses: 1,
        durationMs: 10,
      };
    });

    // Phase 3: Reviewer
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "Iteration limit reached",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-6", { yoloPrompt: "test prompt" }),
      maxIterations: 3, // Only allow 3 iterations out of 5 needed
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-6",
      maxSteps: 50,
    });

    // Loop exits after 3 iterations due to maxIterations limit
    expect(result.status).toBe("completed");
    expect(workerCallCount).toBe(3);
    // 3 tasks completed, 2 still pending
    const completed = result.state.tasks.filter((t: any) => t.status === "completed");
    const pending = result.state.tasks.filter((t: any) => t.status === "pending");
    expect(completed).toHaveLength(3);
    expect(pending).toHaveLength(2);
  });
});

describe("createRalphWorkflow - Edge Cases", () => {
  test("handles empty task list from planner", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns empty array
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: "[]",
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker should not be called
    let workerCalled = false;
    mockResponses.set("worker", () => {
      workerCalled = true;
      return {
        agentId: "worker-1",
        success: true,
        output: "Should not be called",
        toolUses: 0,
        durationMs: 10,
      };
    });

    // Phase 3: Reviewer
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "No tasks to review",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-7", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-7",
    });

    expect(result.status).toBe("completed");
    expect(result.state.tasks).toHaveLength(0);
    // Worker node exits early when no tasks are ready (no spawnSubagent call)
    expect(workerCalled).toBe(false);
  });

  test("filters out low-priority P3 findings", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        {
          id: "#1",
          content: "Task 1",
          status: "pending",
          activeForm: "Doing task 1",
          blockedBy: [],
        },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker
    mockResponses.set("worker", () => ({
      agentId: "worker-1",
      success: true,
      output: "Completed task 1",
      toolUses: 2,
      durationMs: 50,
    }));

    // Phase 3: Reviewer returns only P3 findings
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [
          {
            title: "[P3] Minor style issue",
            body: "Consider using const instead of let",
            confidence_score: 0.8,
            priority: 3,
          },
        ],
        overall_correctness: "patch is correct",
        overall_explanation: "Only minor style issues",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    // Fixer should NOT be triggered (P3 filtered out)
    let fixerCalled = false;
    mockResponses.set("debugger", () => {
      fixerCalled = true;
      return {
        agentId: "fixer-1",
        success: true,
        output: "Applied fixes",
        toolUses: 3,
        durationMs: 100,
      };
    });

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-8", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-8",
    });

    expect(result.status).toBe("completed");
    // P3 findings should be filtered out by parseReviewResult
    expect(result.state.reviewResult?.findings).toHaveLength(0);
    expect(fixerCalled).toBe(false);
  });
});

// ============================================================================
// PARALLEL DISPATCH TESTS
// ============================================================================

describe("createRalphWorkflow - Parallel Worker Dispatch", () => {
  test("dispatches all independent tasks in a single spawnSubagentParallel call", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns 3 independent tasks (no dependencies)
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing 1", blockedBy: [] },
        { id: "#2", content: "Task 2", status: "pending", activeForm: "Doing 2", blockedBy: [] },
        { id: "#3", content: "Task 3", status: "pending", activeForm: "Doing 3", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker succeeds for all
    mockResponses.set("worker", (opts) => ({
      agentId: opts.agentId,
      success: true,
      output: `Completed ${opts.agentId}`,
      toolUses: 1,
      durationMs: 10,
    }));

    // Phase 3: Reviewer
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

    // Track spawnSubagentParallel calls to verify batching
    const parallelCalls: SubagentSpawnOptions[][] = [];
    const { spawnSubagent, spawnSubagentParallel } = createMockSpawnFunctions(mockResponses);

    const trackingSpawnParallel = async (
      agents: SubagentSpawnOptions[],
      abortSignal?: AbortSignal
    ): Promise<SubagentStreamResult[]> => {
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
    expect(result.state.tasks.every((t: any) => t.status === "completed")).toBe(true);

    // All 3 independent tasks dispatched in one spawnSubagentParallel call (1 batch for workers)
    const workerBatches = parallelCalls.filter(
      (batch) => batch.some((a) => a.agentName === "worker")
    );
    expect(workerBatches).toHaveLength(1);
    expect(workerBatches[0]).toHaveLength(3);
    expect(workerBatches[0]!.map((a) => a.agentId).sort()).toEqual([
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

    // Phase 1: Planner returns a task
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing 1", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    const { spawnSubagent } = createMockSpawnFunctions(mockResponses);

    // Deliberately omit spawnSubagentParallel from runtime
    const workflow = createRalphWorkflow();
    const workflowWithMocks = {
      ...workflow,
      config: {
        ...workflow.config,
        runtime: {
          spawnSubagent,
          // spawnSubagentParallel intentionally NOT provided
          subagentRegistry: createMockRegistry(),
        },
      },
    };

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-no-parallel", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    // executeGraph catches errors and returns status "error"
    const result = await executeGraph(workflowWithMocks, {
      initialState,
      executionId: "test-no-parallel",
    });

    expect(result.status).toBe("failed");
    // Error is in the snapshot's errors array
    const errorMessages = result.snapshot.errors.map((e: any) => {
      const err = e.error;
      return typeof err === "string" ? err : err?.message ?? "";
    });
    expect(errorMessages.some((m: string) => m.includes("spawnSubagentParallel not available in runtime config"))).toBe(true);
  });

  test("maps results independently — failed tasks get error, successful get completed", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns 3 independent tasks
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing 1", blockedBy: [] },
        { id: "#2", content: "Task 2", status: "pending", activeForm: "Doing 2", blockedBy: [] },
        { id: "#3", content: "Task 3", status: "pending", activeForm: "Doing 3", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker — #1 succeeds, #2 fails, #3 succeeds
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

    // Phase 3: Reviewer
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
    const task1 = result.state.tasks.find((t: any) => t.id === "#1");
    const task2 = result.state.tasks.find((t: any) => t.id === "#2");
    const task3 = result.state.tasks.find((t: any) => t.id === "#3");
    expect(task1?.status).toBe("completed");
    expect(task2?.status).toBe("error");
    expect(task3?.status).toBe("completed");
  });

  test("increments iteration by 1 per batch, not per task", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns 4 independent tasks
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing 1", blockedBy: [] },
        { id: "#2", content: "Task 2", status: "pending", activeForm: "Doing 2", blockedBy: [] },
        { id: "#3", content: "Task 3", status: "pending", activeForm: "Doing 3", blockedBy: [] },
        { id: "#4", content: "Task 4", status: "pending", activeForm: "Doing 4", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker succeeds
    mockResponses.set("worker", (opts) => ({
      agentId: opts.agentId,
      success: true,
      output: `Completed`,
      toolUses: 1,
      durationMs: 10,
    }));

    // Phase 3: Reviewer
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
    expect(result.state.tasks.every((t: any) => t.status === "completed")).toBe(true);
    // All 4 independent tasks dispatched in 1 batch → 1 iteration
    expect(result.state.iteration).toBe(1);
  });

  test("calls notifyTaskStatusChange with in_progress before spawning", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns 2 independent tasks
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing 1", blockedBy: [] },
        { id: "#2", content: "Task 2", status: "pending", activeForm: "Doing 2", blockedBy: [] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker succeeds
    mockResponses.set("worker", (opts) => ({
      agentId: opts.agentId,
      success: true,
      output: "Completed",
      toolUses: 1,
      durationMs: 10,
    }));

    // Phase 3: Reviewer
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

    // Track notifyTaskStatusChange calls
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
          subagentRegistry: createMockRegistry(),
          notifyTaskStatusChange: (
            taskIds: string[],
            newStatus: string,
            tasks: Array<{ id: string; title: string; status: string }>
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

    // notifyTaskStatusChange should have been called at least once with "in_progress"
    const inProgressCalls = statusChangeCalls.filter((c) => c.newStatus === "in_progress");
    expect(inProgressCalls.length).toBeGreaterThanOrEqual(1);

    // The first in_progress call should include both task IDs
    const firstCall = inProgressCalls[0]!;
    expect(firstCall.taskIds.sort()).toEqual(["#1", "#2"]);
    expect(firstCall.newStatus).toBe("in_progress");

    // The tasks array should show in_progress status for the ready tasks
    const inProgressTasks = firstCall.tasks.filter((t) => t.status === "in_progress");
    expect(inProgressTasks).toHaveLength(2);
  });

  test("worker prompt includes completed task context from previous batches", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    // Phase 1: Planner returns 2 tasks — #2 depends on #1
    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: JSON.stringify([
        { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing 1", blockedBy: [] },
        { id: "#2", content: "Task 2", status: "pending", activeForm: "Doing 2", blockedBy: ["#1"] },
      ]),
      toolUses: 0,
      durationMs: 10,
    }));

    // Phase 2: Worker — capture the task prompt to verify task context
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

    // Phase 3: Reviewer
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
    // Worker called twice: first for #1 (batch 1), then for #2 (batch 2, after #1 completes)
    expect(workerPrompts).toHaveLength(2);

    // Second worker prompt (for task #2) should show task #1 as completed in context
    // because buildWorkerAssignment receives the updated tasks after first batch completed
    expect(workerPrompts[1]).toContain("#1");
    expect(workerPrompts[1]).toContain("Task 1");
    // The completed tasks section should be present in the second worker's prompt
    expect(workerPrompts[1]).toContain("Completed");
  });
});
