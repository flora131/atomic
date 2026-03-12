import { describe, expect, test } from "bun:test";
import {
  compileGraphConfig,
  executeWorkflow,
} from "@/services/workflows/executor.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "@/services/workflows/runtime-parity-observability.ts";
import { createMockContext } from "./executor.fixtures.ts";

describe("executeWorkflow - task parity", () => {
  test("persists task result envelopes from status snapshots", async () => {
    resetRuntimeParityMetrics();
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
              ["#12"],
              "completed",
              [{
                id: "#12",
                title: "Persist envelope",
                status: "completed",
                identity: {
                  canonicalId: "#12",
                  providerBindings: {
                    subagent_id: ["worker-12"],
                  },
                },
                taskResult: {
                  task_id: "#12",
                  tool_name: "task",
                  title: "Persist envelope",
                  metadata: {
                    sessionId: "session-12",
                    providerBindings: {
                      subagent_id: "worker-12",
                    },
                  },
                  status: "completed",
                  output_text: "done",
                  envelope_text: "task_id: #12",
                },
              }],
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
      description: "Task result persistence",
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
    expect(task.taskResult).toMatchObject({
      task_id: "#12",
      tool_name: "task",
      status: "completed",
      metadata: {
        providerBindings: {
          subagent_id: "worker-12",
        },
      },
      output_text: "done",
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.status_snapshot_total{phase=received,workflow=test-workflow}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.status_snapshot_total{phase=persisted,workflow=test-workflow}"]).toBe(1);
    expect(metrics.histograms["workflow.runtime.parity.status_snapshot_task_count{workflow=test-workflow}"]).toEqual([1]);
  });

  test("fails fast when task result task_id mismatches canonical identity", async () => {
    resetRuntimeParityMetrics();
    const context = createMockContext();

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
              ["#13"],
              "completed",
              [{
                id: "#13",
                title: "Mismatched envelope",
                status: "completed",
                identity: {
                  canonicalId: "#13",
                  providerBindings: {
                    subagent_id: ["worker-13"],
                  },
                },
                taskResult: {
                  task_id: "#14",
                  tool_name: "task",
                  title: "Mismatched envelope",
                  status: "completed",
                  output_text: "done",
                },
              }],
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
      description: "Task result mismatch",
      command: "/test",
    };

    const result = await executeWorkflow(
      definition,
      "test prompt",
      context as any,
      {
        compiledGraph: compiledGraph as any,
        eventBus: mockEventBus as any,
        saveTasksToSession: async () => {},
      },
    );

    expect(result.success).toBe(false);
    expect(
      context
        ._getMessages()
        .some((message: { role: string; content: string }) =>
          message.role === "system" && message.content.includes("TaskResult envelope task_id mismatch: expected #13, received #14"),
        ),
    ).toBe(true);

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.task_result_invariant_failures_total{reason=task_id_mismatch}"]).toBeGreaterThanOrEqual(1);
    expect(metrics.counters["workflow.runtime.parity.task_result_normalization_failures_total{reason=invalid_envelope}"]).toBeGreaterThanOrEqual(1);
    expect(metrics.counters["workflow.runtime.parity.execution_total{phase=failure,workflow=test-workflow}"]).toBe(1);
  });
});
