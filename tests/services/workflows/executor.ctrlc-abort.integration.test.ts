import { describe, expect, test } from "bun:test";
import { compileGraphConfig, executeWorkflow } from "@/services/workflows/executor.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";

function createMockContext(overrides?: Record<string, unknown>) {
  const messages: Array<{ role: string; content: string }> = [];
  let streaming = false;

  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
    },
    addMessage: (role: string, content: string) => {
      messages.push({ role, content });
    },
    setStreaming: (value: boolean) => {
      streaming = value;
    },
    updateWorkflowState: () => {},
    setTodoItems: () => {},
    setWorkflowSessionDir: () => {},
    setWorkflowSessionId: () => {},
    setWorkflowTaskIds: () => {},
    spawnSubagentParallel: async () => [],
    _getMessages: () => messages,
    _getStreaming: () => streaming,
    ...overrides,
  };
}

describe("executeWorkflow Ctrl+C integration", () => {
  test("propagates abort signal to node execution and exits as cancellation", async () => {
    let observedNodeAbortSignal: AbortSignal | undefined;
    const workflowAbortController = new AbortController();
    const context = createMockContext();

    const compiledGraph = compileGraphConfig<BaseState>({
      nodes: [
        {
          id: "spawn-node",
          type: "tool",
          execute: async (ctx) => {
            observedNodeAbortSignal = ctx.abortSignal;
            await new Promise((resolve) => setTimeout(resolve, 75));
            if (ctx.abortSignal?.aborted) {
              throw new Error("Workflow cancelled");
            }
            throw new Error("Abort signal was not propagated to node execution");
          },
        },
      ],
      edges: [],
      startNode: "spawn-node",
    });

    const executionPromise = executeWorkflow(
      {
        name: "ctrlc-workflow",
        description: "Abort chain integration test",
      },
      "run",
      context as unknown as Parameters<typeof executeWorkflow>[2],
      {
        compiledGraph,
        abortSignal: workflowAbortController.signal,
      },
    );

    setTimeout(() => workflowAbortController.abort(), 25);

    const result = await Promise.race([
      executionPromise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("workflow did not abort in time")), 7_500);
      }),
    ]);

    expect(result.success).toBe(true);
    expect(observedNodeAbortSignal).toBe(workflowAbortController.signal);
    expect(context._getStreaming()).toBe(false);
    expect(
      context._getMessages().some((m: { content: string }) =>
        m.content.toLowerCase().includes("workflow failed"),
      ),
    ).toBe(false);
  });
});
