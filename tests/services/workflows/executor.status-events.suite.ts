import { describe, expect, test } from "bun:test";
import {
  compileGraphConfig,
  executeWorkflow,
} from "@/services/workflows/executor.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import { createMockContext } from "./executor.fixtures.ts";

describe("executeWorkflow - task status events", () => {
  test("notifyTaskStatusChange is injected into graph runtime and calls context.onTaskStatusChange", async () => {
    const context = createMockContext();
    const statusChangeCalls: Array<{ taskIds: string[]; newStatus: string; tasks: any[] }> = [];

    interface TestState extends BaseState {
      value: string;
    }

    let capturedNotifyFn: any = null;
    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "test-node",
          type: "tool",
          execute: async (ctx: any) => {
            capturedNotifyFn = (ctx.config.runtime as any)?.notifyTaskStatusChange;
            return { stateUpdate: { value: "done" } as Partial<TestState> };
          },
        },
      ],
      edges: [],
      startNode: "test-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Test notify",
      command: "/test",
    };

    await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      { compiledGraph: compiledGraph as any },
    );

    expect(capturedNotifyFn).toBeDefined();
    expect(typeof capturedNotifyFn).toBe("function");
  });

  test("task status changes route through context.onTaskStatusChange to saveTasksToSession", async () => {
    const context = createMockContext();
    const saveCalls: Array<{ tasks: any[]; sessionId: string }> = [];
    const saveTasksToSession = async (tasks: any[], sessionId: string) => {
      saveCalls.push({ tasks, sessionId });
    };

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "test-node",
          type: "tool",
          execute: async (ctx: any) => {
            const notifyFn = (ctx.config.runtime as any)?.notifyTaskStatusChange;
            if (notifyFn) {
              notifyFn(
                ["t1"],
                "in_progress",
                [{ id: "t1", title: "Task 1", status: "in_progress" }],
              );
            }
            return { stateUpdate: { value: "done" } as Partial<TestState> };
          },
        },
      ],
      edges: [],
      startNode: "test-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Test subscriber",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      {
        compiledGraph: compiledGraph as any,
        saveTasksToSession,
      },
    );

    expect(result.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(saveCalls.length).toBeGreaterThanOrEqual(1);

    const lastSave = saveCalls[saveCalls.length - 1]!;
    expect(lastSave.tasks[0]).toMatchObject({
      id: "t1",
      description: "Task 1",
      status: "in_progress",
      summary: "Task 1",
    });
  });

  test("preserves blockedBy when subsequent statusChange snapshots omit it", async () => {
    const context = createMockContext();
    const saveCalls: Array<{ tasks: any[]; sessionId: string }> = [];
    const saveTasksToSession = async (tasks: any[], sessionId: string) => {
      saveCalls.push({ tasks, sessionId });
    };

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "test-node",
          type: "tool",
          execute: async (ctx: any) => {
            const notifyFn = (ctx.config.runtime as any)?.notifyTaskStatusChange;
            if (notifyFn) {
              notifyFn(
                ["#2"],
                "pending",
                [
                  { id: "#1", title: "Task 1", status: "completed", blockedBy: [] },
                  { id: "#2", title: "Task 2", status: "pending", blockedBy: ["#1"] },
                ],
              );
              notifyFn(
                ["2"],
                "in_progress",
                [
                  { id: "#1", title: "Task 1", status: "completed" },
                  { id: "2", title: "Task 2", status: "in_progress" },
                ],
              );
            }
            return { stateUpdate: { value: "done" } as Partial<TestState> };
          },
        },
      ],
      edges: [],
      startNode: "test-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Test blockedBy preservation",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      {
        compiledGraph: compiledGraph as any,
        saveTasksToSession,
      },
    );

    expect(result.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(saveCalls.length).toBeGreaterThanOrEqual(1);

    const lastSave = saveCalls[saveCalls.length - 1]!;
    const task2 = lastSave.tasks.find((task: any) => task.id === "2" || task.id === "#2");
    expect(task2).toBeDefined();
    expect(task2.blockedBy).toEqual(["#1"]);
  });

  test("merges per-task status snapshots into the latest persisted task list", async () => {
    const context = createMockContext();
    const saveCalls: Array<{ tasks: any[]; sessionId: string }> = [];
    const saveTasksToSession = async (tasks: any[], sessionId: string) => {
      saveCalls.push({ tasks, sessionId });
    };

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "test-node",
          type: "tool",
          execute: async (ctx: any) => {
            const notifyFn = (ctx.config.runtime as any)?.notifyTaskStatusChange;
            notifyFn?.(
              ["#1", "#2"],
              "pending",
              [
                { id: "#1", title: "Task 1", status: "pending", blockedBy: [] },
                { id: "#2", title: "Task 2", status: "pending", blockedBy: ["#1"] },
              ],
            );
            notifyFn?.(
              ["#1"],
              "in_progress",
              [{ id: "#1", title: "Task 1", status: "in_progress" }],
            );
            return { stateUpdate: { value: "done" } as Partial<TestState> };
          },
        },
      ],
      edges: [],
      startNode: "test-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Merge partial task snapshots",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      {
        compiledGraph: compiledGraph as any,
        saveTasksToSession,
      },
    );

    expect(result.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const lastSave = saveCalls[saveCalls.length - 1]!;
    expect(lastSave.tasks).toHaveLength(2);
    const task1 = lastSave.tasks.find((task: any) => task.id === "#1");
    const task2 = lastSave.tasks.find((task: any) => task.id === "#2");
    expect(task1).toMatchObject({
      id: "#1",
      description: "Task 1",
      status: "in_progress",
    });
    expect(task2).toMatchObject({
      id: "#2",
      description: "Task 2",
      status: "pending",
      blockedBy: ["#1"],
    });
  });

  test("backfills task identity metadata when status snapshots are legacy", async () => {
    const context = createMockContext();
    const saveCalls: Array<{ tasks: any[]; sessionId: string }> = [];
    const saveTasksToSession = async (tasks: any[], sessionId: string) => {
      saveCalls.push({ tasks, sessionId });
    };

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "test-node",
          type: "tool",
          execute: async (ctx: any) => {
            const notifyFn = (ctx.config.runtime as any)?.notifyTaskStatusChange;
            notifyFn?.(
              ["#7"],
              "in_progress",
              [{ id: "#7", title: "Legacy Task", status: "in_progress" }],
            );
            return { stateUpdate: { value: "done" } as Partial<TestState> };
          },
        },
      ],
      edges: [],
      startNode: "test-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Task identity backfill",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      {
        compiledGraph: compiledGraph as any,
        saveTasksToSession,
      },
    );

    expect(result.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const lastSave = saveCalls[saveCalls.length - 1];
    expect(lastSave).toBeDefined();
    const task = lastSave?.tasks[0];
    expect(task.identity?.canonicalId).toBe("#7");
    expect(task.identity?.providerBindings?.task_id).toContain("#7");
  });

  test("clears onTaskStatusChange on error", async () => {
    const context = createMockContext();
    const errorContext = {
      ...context,
      onTaskStatusChange: undefined as any,
      setWorkflowSessionDir: () => {
        throw new Error("Session dir error");
      },
    };

    interface TestState extends BaseState {
      tasks: Array<{ id: string; description: string; status: string; summary: string }>;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "task-node",
          type: "tool",
          execute: async () => ({
            stateUpdate: {
              tasks: [
                { id: "t1", description: "Task 1", status: "pending", summary: "Task 1" },
              ],
            } as Partial<TestState>,
          }),
        },
      ],
      edges: [],
      startNode: "task-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Test error cleanup",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      errorContext as any,
      {
        compiledGraph: compiledGraph as any,
        saveTasksToSession: async () => {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.message).toBeUndefined();
    expect(
      context
        ._getMessages()
        .some((message: { role: string; content: string }) =>
          message.role === "system" && message.content.includes("Session dir error"),
        ),
    ).toBe(true);
    expect(errorContext.onTaskStatusChange).toBeUndefined();
  });
});
