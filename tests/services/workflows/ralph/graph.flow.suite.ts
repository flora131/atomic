import { describe, expect, test } from "bun:test";
import { executeGraph } from "@/services/workflows/graph/compiled.ts";
import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/types.ts";
import { createRalphState } from "@/services/workflows/ralph/state.ts";
import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";
import { createWorkflowWithMockBridge } from "./graph.fixtures.ts";

describe("createRalphWorkflow - 3-Phase Flow", () => {
  test("executes 3-phase flow with simple tasks", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

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
    expect(result.state.reviewResult?.overall_correctness).toBe("patch is correct");
    expect(result.state.fixesApplied).toBe(false);
    expect(workerCallCount).toBe(2);
  });

  test("handles task dependencies in worker loop", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

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

    const executionOrder: string[] = [];
    mockResponses.set("worker", (opts) => {
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
    expect(executionOrder).toEqual(["#1", "#2"]);
  });

  test("triggers fixer when review has findings", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

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

    mockResponses.set("worker", () => ({
      agentId: "worker-1",
      success: true,
      output: "Completed task 1",
      toolUses: 2,
      durationMs: 50,
    }));

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
    expect(result.state.reviewResult?.overall_correctness).toBe("patch is incorrect");
    expect(result.state.reviewResult?.findings).toHaveLength(1);
    expect(fixerCalled).toBe(true);
    expect(result.state.fixesApplied).toBe(true);
    const reviewFixTask = result.state.tasks.find((task: any) => task.id === "#review-fix-1");
    expect(reviewFixTask).toBeDefined();
    expect(reviewFixTask?.status).toBe("completed");
  });

  test("triggers fixer for actionable findings even when review says patch is correct", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

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

    mockResponses.set("worker", () => ({
      agentId: "worker-1",
      success: true,
      output: "Completed task 1",
      toolUses: 2,
      durationMs: 50,
    }));

    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: JSON.stringify({
        findings: [
          {
            title: "[P2] Missing edge-case coverage",
            body: "Add a guard test for malformed input",
            confidence_score: 0.84,
            priority: 2,
          },
        ],
        overall_correctness: "patch is correct",
        overall_explanation: "Feature works, but robustness can improve",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    let fixerCalled = false;
    mockResponses.set("debugger", () => {
      fixerCalled = true;
      return {
        agentId: "fixer-1",
        success: true,
        output: "Applied robustness fix",
        toolUses: 1,
        durationMs: 60,
      };
    });

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-3b", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-3b",
    });

    expect(result.status).toBe("completed");
    expect(result.state.reviewResult?.overall_correctness).toBe("patch is correct");
    expect(result.state.reviewResult?.findings).toHaveLength(1);
    expect(fixerCalled).toBe(true);
    expect(result.state.fixesApplied).toBe(true);
  });

  test("skips fixer when review is clean", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

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

    mockResponses.set("worker", () => ({
      agentId: "worker-1",
      success: true,
      output: "Completed task 1",
      toolUses: 2,
      durationMs: 50,
    }));

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
    expect(result.state.reviewResult?.overall_correctness).toBe("patch is correct");
    expect(fixerCalled).toBe(false);
    expect(result.state.fixesApplied).toBe(false);
  });

  test("falls back to raw review output when structured parse fails", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

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

    mockResponses.set("worker", () => ({
      agentId: "worker-1",
      success: true,
      output: "Completed task 1",
      toolUses: 1,
      durationMs: 20,
    }));

    const rawReview = "I found a correctness issue in edge-case handling. Please add guard clauses.";
    mockResponses.set("reviewer", () => ({
      agentId: "reviewer-1",
      success: true,
      output: rawReview,
      toolUses: 1,
      durationMs: 20,
    }));

    let fixerCalled = false;
    let fixerTask = "";
    mockResponses.set("debugger", (opts) => {
      fixerCalled = true;
      fixerTask = opts.task;
      return {
        agentId: "fixer-1",
        success: true,
        output: "Applied fallback fixes",
        toolUses: 1,
        durationMs: 40,
      };
    });

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-raw-review", { yoloPrompt: "test prompt" }),
      maxIterations: 10,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-raw-review",
    });

    expect(result.status).toBe("completed");
    expect(result.state.reviewResult).toBeNull();
    expect(result.state.rawReviewResult).toBe(rawReview);
    expect(fixerCalled).toBe(true);
    expect(fixerTask).toContain(rawReview);
    expect(result.state.fixesApplied).toBe(true);
    const reviewFixTask = result.state.tasks.find((task: any) => task.id === "#review-fix-1");
    expect(reviewFixTask?.status).toBe("completed");
  });
});
