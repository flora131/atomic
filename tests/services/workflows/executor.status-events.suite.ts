import { describe, expect, test } from "bun:test";
import {
  compileGraphConfig,
  executeWorkflow,
} from "@/services/workflows/executor.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import { createMockContext } from "./executor.fixtures.ts";

describe("executeWorkflow - task status events", () => {
  test("notifyTaskStatusChange publishes workflow.task.statusChange event on eventBus", async () => {
    const context = createMockContext();
    const publishedEvents: any[] = [];

    const mockEventBus = {
      publish: (event: any) => {
        publishedEvents.push(event);
      },
      on: (_type: string, _handler: any) => () => {},
      onAll: () => () => {},
      clear: () => {},
      hasHandlers: () => false,
      get handlerCount() { return 0; },
    };

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
      { compiledGraph: compiledGraph as any, eventBus: mockEventBus as any },
    );

    expect(capturedNotifyFn).toBeDefined();
    expect(typeof capturedNotifyFn).toBe("function");

    capturedNotifyFn(
      ["task-1", "task-2"],
      "in_progress",
      [
        { id: "task-1", title: "First", status: "in_progress" },
        { id: "task-2", title: "Second", status: "in_progress" },
      ],
    );

    const statusChangeEvents = publishedEvents.filter(
      (event) => event.type === "workflow.task.statusChange",
    );
    expect(statusChangeEvents.length).toBe(1);
    expect(statusChangeEvents[0].data.taskIds).toEqual(["task-1", "task-2"]);
    expect(statusChangeEvents[0].data.newStatus).toBe("in_progress");
    expect(statusChangeEvents[0].data.tasks).toHaveLength(2);
  });

  test("subscribes to workflow.task.statusChange and debounce-saves tasks", async () => {
    const context = createMockContext();
    const saveCalls: Array<{ tasks: any[]; sessionId: string }> = [];
    const saveTasksToSession = async (tasks: any[], sessionId: string) => {
      saveCalls.push({ tasks, sessionId });
    };

    const subscriptions: Array<{ type: string; handler: any }> = [];
    let unsubscribeCalled = false;

    const mockEventBus = {
      publish: (event: any) => {
        for (const sub of subscriptions) {
          if (sub.type === event.type) {
            sub.handler(event);
          }
        }
      },
      on: (type: string, handler: any) => {
        subscriptions.push({ type, handler });
        return () => { unsubscribeCalled = true; };
      },
      onAll: () => () => {},
      clear: () => {},
      hasHandlers: () => false,
      get handlerCount() { return 0; },
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
        eventBus: mockEventBus as any,
        saveTasksToSession,
      },
    );

    expect(result.success).toBe(true);

    const statusChangeSubs = subscriptions.filter(
      (subscription) => subscription.type === "workflow.task.statusChange",
    );
    expect(statusChangeSubs.length).toBe(1);
    expect(unsubscribeCalled).toBe(true);

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

    const subscriptions: Array<{ type: string; handler: any }> = [];
    const mockEventBus = {
      publish: (event: any) => {
        for (const sub of subscriptions) {
          if (sub.type === event.type) {
            sub.handler(event);
          }
        }
      },
      on: (type: string, handler: any) => {
        subscriptions.push({ type, handler });
        return () => {};
      },
      onAll: () => () => {},
      clear: () => {},
      hasHandlers: () => false,
      get handlerCount() { return 0; },
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
        eventBus: mockEventBus as any,
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

  test("backfills task identity metadata when status snapshots are legacy", async () => {
    const context = createMockContext();
    const saveCalls: Array<{ tasks: any[]; sessionId: string }> = [];
    const saveTasksToSession = async (tasks: any[], sessionId: string) => {
      saveCalls.push({ tasks, sessionId });
    };

    const subscriptions: Array<{ type: string; handler: any }> = [];
    const mockEventBus = {
      publish: (event: any) => {
        for (const sub of subscriptions) {
          if (sub.type === event.type) {
            sub.handler(event);
          }
        }
      },
      on: (type: string, handler: any) => {
        subscriptions.push({ type, handler });
        return () => {};
      },
      onAll: () => () => {},
      clear: () => {},
      hasHandlers: () => false,
      get handlerCount() { return 0; },
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
        eventBus: mockEventBus as any,
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

  test("unsubscribes from statusChange events on error", async () => {
    let unsubscribeCalled = false;

    const mockEventBus = {
      publish: () => {},
      on: () => () => { unsubscribeCalled = true; },
      onAll: () => () => {},
      clear: () => {},
      hasHandlers: () => false,
      get handlerCount() { return 0; },
    };

    const context = createMockContext();
    const errorContext = {
      ...context,
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
        eventBus: mockEventBus as any,
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
    expect(unsubscribeCalled).toBe(true);
  });

  test("publishes step completion status from actual terminal step state", async () => {
    const context = createMockContext();
    const publishedEvents: any[] = [];

    const mockEventBus = {
      publish: (event: any) => {
        publishedEvents.push(event);
      },
      on: () => () => {},
      onAll: () => () => {},
      clear: () => {},
      hasHandlers: () => false,
      get handlerCount() { return 0; },
    };

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "step-1",
          type: "tool",
          execute: async () => ({
            stateUpdate: { value: "ok" } as Partial<TestState>,
          }),
        },
        {
          id: "step-2",
          type: "tool",
          execute: async () => {
            throw new Error("boom");
          },
        },
      ],
      edges: [{ from: "step-1", to: "step-2" }],
      startNode: "step-1",
    });

    const definition = {
      name: "test-workflow",
      description: "Step status parity",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      {
        compiledGraph: compiledGraph as any,
        eventBus: mockEventBus as any,
      },
    );

    expect(result.success).toBe(false);

    const completionEvents = publishedEvents.filter(
      (event) => event.type === "workflow.step.complete",
    );
    expect(completionEvents).toHaveLength(2);
    expect(completionEvents[0].data.nodeId).toBe("step-1");
    expect(completionEvents[0].data.status).toBe("success");
    expect(completionEvents[1].data.nodeId).toBe("step-2");
    expect(completionEvents[1].data.status).toBe("error");
  });
});
