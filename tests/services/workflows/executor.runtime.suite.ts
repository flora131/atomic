import { describe, expect, test } from "bun:test";
import {
  compileGraphConfig,
  executeWorkflow,
} from "@/services/workflows/executor.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import { createMockContext } from "./executor.fixtures.ts";

describe("executeWorkflow", () => {
  test("returns error when no graphConfig or compiledGraph provided", async () => {
    const context = createMockContext();
    const definition = {
      name: "test-workflow",
      description: "Test workflow without graph",
      command: "/test",
    };

    const result = await executeWorkflow(definition, "test prompt", context as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain("no graphConfig");
    expect(context._getStreaming()).toBe(false);
  });

  test("successfully executes with a pre-compiled graph", async () => {
    const context = createMockContext();

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "test-node",
          type: "tool",
          execute: async () => ({
            stateUpdate: { value: "executed" } as Partial<TestState>,
          }),
        },
      ],
      edges: [],
      startNode: "test-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Test workflow with compiled graph",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      { compiledGraph: compiledGraph as any },
    );

    expect(result.success).toBe(true);
    expect(context._getStreaming()).toBe(false);
    const messages = context._getMessages();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((message: any) => message.content.includes("Starting"))).toBe(true);
    expect(messages.some((message: any) => message.content.includes("completed successfully"))).toBe(true);
  });

  test("uses nodeDescriptions for progress messages", async () => {
    const context = createMockContext();

    interface TestState extends BaseState {
      step: number;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "step1",
          type: "tool",
          execute: async () => ({
            stateUpdate: { step: 1 } as Partial<TestState>,
          }),
        },
        {
          id: "step2",
          type: "tool",
          execute: async () => ({
            stateUpdate: { step: 2 } as Partial<TestState>,
          }),
        },
      ],
      edges: [{ from: "step1", to: "step2" }],
      startNode: "step1",
    });

    const definition = {
      name: "test-workflow",
      description: "Test workflow with node descriptions",
      command: "/test",
      nodeDescriptions: {
        step1: "Executing first step",
        step2: "Executing second step",
      },
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      { compiledGraph: compiledGraph as any },
    );

    expect(result.success).toBe(true);
    const messages = context._getMessages();
    expect(messages.some((message: any) => message.content.includes("Starting"))).toBe(true);
    expect(messages.some((message: any) => message.content.includes("completed successfully"))).toBe(true);
  });

  test("threads workflow abort signal to subagent spawns", async () => {
    const context = createMockContext();
    const workflowAbortController = new AbortController();
    let capturedParallelAbortSignal: AbortSignal | undefined;
    let capturedAgentAbortSignal: AbortSignal | undefined;
    let observedNodeAbortSignal: AbortSignal | undefined;

    const contextWithCapture = {
      ...context,
      spawnSubagentParallel: async (agents: any[], abortSignal?: AbortSignal) => {
        capturedParallelAbortSignal = abortSignal;
        capturedAgentAbortSignal = agents[0]?.abortSignal;
        return [{
          agentId: agents[0]?.agentId ?? "agent-1",
          success: true,
          output: "ok",
          toolUses: 0,
          durationMs: 1,
        }];
      },
    };

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "spawn-node",
          type: "tool",
          execute: async (ctx: any) => {
            observedNodeAbortSignal = ctx.abortSignal;
            const spawnSubagent = ctx.config.runtime?.spawnSubagent;
            if (!spawnSubagent) {
              throw new Error("spawnSubagent missing");
            }
            await spawnSubagent({
              agentId: "worker-1",
              agentName: "worker",
              task: "do work",
            });
            return { stateUpdate: { value: "done" } as Partial<TestState> };
          },
        },
      ],
      edges: [],
      startNode: "spawn-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Abort signal propagation",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      contextWithCapture as any,
      {
        compiledGraph: compiledGraph as any,
        abortSignal: workflowAbortController.signal,
      },
    );

    expect(result.success).toBe(true);
    expect(observedNodeAbortSignal).toBe(workflowAbortController.signal);
    expect(capturedParallelAbortSignal).toBe(workflowAbortController.signal);
    expect(capturedAgentAbortSignal).toBe(workflowAbortController.signal);
  });

  test("handles workflow cancellation error gracefully", async () => {
    const context = createMockContext();

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "cancel-node",
          type: "tool",
          execute: async () => {
            throw new Error("Workflow cancelled");
          },
        },
      ],
      edges: [],
      startNode: "cancel-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Test workflow with cancellation",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      { compiledGraph: compiledGraph as any },
    );

    expect(result.success).toBe(true);
    expect(context._getStreaming()).toBe(false);
    expect(result.stateUpdate?.workflowActive).toBe(false);
  });

  test("returns failure message without adding a duplicate chat error line", async () => {
    const context = createMockContext();

    interface TestState extends BaseState {
      value: string;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "failing-node",
          type: "tool",
          execute: async () => {
            throw new Error("Sub-agent \"reviewer\" failed: Claude Code process exited with code 1");
          },
        },
      ],
      edges: [],
      startNode: "failing-node",
    });

    const definition = {
      name: "ralph",
      description: "Test workflow failure surface",
      command: "/ralph",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      { compiledGraph: compiledGraph as any },
    );

    expect(result.success).toBe(false);
    expect(result.message).toBeUndefined();

    const messages = context._getMessages();
    const failureLines = messages.filter((message: { content: string }) =>
      message.content.toLowerCase().includes("workflow failed at node"),
    );
    expect(failureLines).toHaveLength(1);
    expect(failureLines[0]?.role).toBe("system");
  });

  test("creates state using createState factory when provided", async () => {
    const context = createMockContext();

    interface TestState extends BaseState {
      customValue: string;
      sessionId: string;
    }

    let capturedParams: any = null;

    const definition = {
      name: "test-workflow",
      description: "Test workflow with state factory",
      command: "/test",
      graphConfig: {
        nodes: [
          {
            id: "test-node",
            type: "tool" as const,
            execute: async (ctx: any) => {
              expect((ctx.state as TestState).customValue).toBe("factory-created");
              return { stateUpdate: {} };
            },
          },
        ],
        edges: [],
        startNode: "test-node",
      },
      createState: (params: any) => {
        capturedParams = params;
        return {
          executionId: params.sessionId,
          lastUpdated: new Date().toISOString(),
          outputs: {},
          customValue: "factory-created",
          sessionId: params.sessionId,
        } as TestState;
      },
    };

    const result = await executeWorkflow(
      definition as any,
      "test prompt",
      context as any,
    );

    expect(result.success).toBe(true);
    expect(capturedParams).not.toBeNull();
    expect(capturedParams.prompt).toBe("test prompt");
    expect(capturedParams.sessionId).toBeDefined();
    expect(capturedParams.sessionDir).toBeDefined();
    expect(capturedParams.maxIterations).toBe(100);
  });

  test("injects resolved runtime feature flags into graph runtime config", async () => {
    const context = createMockContext();

    interface TestState extends BaseState {
      value: string;
    }

    let capturedFlags: unknown;
    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "feature-node",
          type: "tool",
          execute: async (ctx: any) => {
            capturedFlags = (ctx.config.runtime as any)?.featureFlags;
            return { stateUpdate: { value: "done" } as Partial<TestState> };
          },
        },
      ],
      edges: [],
      startNode: "feature-node",
    });

    const definition = {
      name: "test-workflow",
      description: "Feature flags test",
      command: "/test",
      runtime: {
        featureFlags: {
          emitTaskStatusEvents: false,
        },
      },
    };

    const result = await executeWorkflow(
      definition as any,
      "test prompt",
      context as any,
      {
        compiledGraph: compiledGraph as any,
        featureFlags: {
          strictTaskContract: true,
        },
      },
    );

    expect(result.success).toBe(true);
    expect(capturedFlags).toEqual({
      emitTaskStatusEvents: false,
      persistTaskStatusEvents: true,
      strictTaskContract: true,
    });
  });

  test("does not inject notifyTaskStatusChange when task status events are disabled", async () => {
    const context = createMockContext();

    interface TestState extends BaseState {
      value: string;
    }

    let capturedNotifyFn: unknown;
    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "notify-node",
          type: "tool",
          execute: async (ctx: any) => {
            capturedNotifyFn = (ctx.config.runtime as any)?.notifyTaskStatusChange;
            return { stateUpdate: { value: "done" } as Partial<TestState> };
          },
        },
      ],
      edges: [],
      startNode: "notify-node",
    });

    const mockEventBus = {
      publish: () => {},
      on: () => () => {},
      onAll: () => () => {},
      clear: () => {},
      hasHandlers: () => false,
      get handlerCount() { return 0; },
    };

    const definition = {
      name: "test-workflow",
      description: "Disable status events",
      command: "/test",
      runtime: {
        featureFlags: {
          emitTaskStatusEvents: false,
        },
      },
    };

    const result = await executeWorkflow(
      definition as any,
      "test prompt",
      context as any,
      {
        compiledGraph: compiledGraph as any,
        eventBus: mockEventBus as any,
      },
    );

    expect(result.success).toBe(true);
    expect(capturedNotifyFn).toBeUndefined();
  });

  test("debounces saveTasksToSession calls", async () => {
    const context = createMockContext();
    const saveCalls: Array<{ tasks: any[]; sessionId: string }> = [];
    const saveTasksToSession = async (tasks: any[], sessionId: string) => {
      saveCalls.push({ tasks, sessionId });
    };

    interface TestState extends BaseState {
      tasks: Array<{ id: string; content: string; status: string; activeForm: string }>;
    }

    const compiledGraph = compileGraphConfig<TestState>({
      nodes: [
        {
          id: "step1",
          type: "tool",
          execute: async () => ({
            stateUpdate: {
              tasks: [
                { id: "t1", content: "Task 1", status: "pending", activeForm: "Task 1" },
              ],
            } as Partial<TestState>,
          }),
        },
        {
          id: "step2",
          type: "tool",
          execute: async () => ({
            stateUpdate: {
              tasks: [
                { id: "t1", content: "Task 1", status: "in_progress", activeForm: "Task 1" },
              ],
            } as Partial<TestState>,
          }),
        },
      ],
      edges: [{ from: "step1", to: "step2" }],
      startNode: "step1",
    });

    const definition = {
      name: "test-workflow",
      description: "Test debounce",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      { compiledGraph: compiledGraph as any, saveTasksToSession },
    );

    expect(result.success).toBe(true);
    expect(saveCalls.length).toBeGreaterThanOrEqual(1);
    const lastSave = saveCalls[saveCalls.length - 1]!;
    expect(lastSave.tasks.length).toBeGreaterThan(0);
  });
});
