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

describe("createRalphWorkflow - Parallel Worker Dispatch", () => {
  test("calls notifyTaskStatusChange with in_progress before spawning", async () => {
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
    expect(inProgressCalls.length).toBeGreaterThanOrEqual(1);

    const firstCall = inProgressCalls[0]!;
    expect(firstCall.taskIds.sort()).toEqual(["#1", "#2"]);
    expect(firstCall.newStatus).toBe("in_progress");

    const inProgressTasks = firstCall.tasks.filter((task) => task.status === "in_progress");
    expect(inProgressTasks).toHaveLength(2);

    const firstTaskIdentity = (inProgressTasks[0] as any)?.identity;
    expect(firstTaskIdentity?.providerBindings?.subagent_id?.length ?? 0).toBeGreaterThan(0);
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

  test("worker prompt includes completed task context from previous batches", async () => {
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
