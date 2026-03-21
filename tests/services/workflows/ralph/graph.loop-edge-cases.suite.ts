import { describe, expect, test } from "bun:test";
import { executeGraph } from "@/services/workflows/graph/compiled.ts";
import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/types.ts";
import { createRalphState } from "@/services/workflows/ralph/state.ts";
import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";
import { createWorkflowWithMockBridge } from "./graph.fixtures.ts";

describe("createRalphWorkflow - Worker Loop", () => {
  // NOTE: "exits loop when no actionable tasks remain after retries exhaust"
  // was removed — it tested the EagerDispatchCoordinator retry loop which was
  // deleted in the Ralph workflow redesign (§8.1). Worker retries are now
  // handled inside the orchestrator agent session, not by programmatic dispatch.

  test("stops eager cascades once maxIterations is exhausted", async () => {
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
        { id: "#3", description: "Task 3", status: "pending", summary: "Doing 3", blockedBy: ["#2"] },
        { id: "#4", description: "Task 4", status: "pending", summary: "Doing 4", blockedBy: ["#3"] },
        { id: "#5", description: "Task 5", status: "pending", summary: "Doing 5", blockedBy: ["#4"] },
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
        overall_explanation: "Iteration limit enforced",
      }),
      toolUses: 1,
      durationMs: 30,
    }));

    const workflow = createWorkflowWithMockBridge(mockResponses);

    const initialState: Partial<RalphWorkflowState> = {
      ...createRalphState("test-exec-6", { yoloPrompt: "test prompt" }),
      maxIterations: 3,
      ralphSessionDir: "/tmp/test-session",
    };

    const result = await executeGraph(workflow, {
      initialState,
      executionId: "test-exec-6",
      maxSteps: 50,
    });

    expect(result.status).toBe("completed");
    expect(workerCallCount).toBe(3);
    const completed = result.state.tasks.filter((task: any) => task.status === "completed");
    const pending = result.state.tasks.filter((task: any) => task.status === "pending");
    expect(completed).toHaveLength(3);
    expect(pending).toHaveLength(2);
    expect(result.state.iteration).toBe(3);
  });
});

describe("createRalphWorkflow - Edge Cases", () => {
  test("handles empty task list from planner", async () => {
    const mockResponses = new Map<
      string,
      (opts: SubagentSpawnOptions) => SubagentStreamResult
    >();

    mockResponses.set("planner", () => ({
      agentId: "planner-1",
      success: true,
      output: "[]",
      toolUses: 0,
      durationMs: 10,
    }));

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
    expect(workerCalled).toBe(false);
  });

  test("filters out low-priority P3 findings", async () => {
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
          description: "Task 1",
          status: "pending",
          summary: "Doing task 1",
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
    expect(result.state.reviewResult?.findings).toHaveLength(0);
    expect(fixerCalled).toBe(false);
  });
});
