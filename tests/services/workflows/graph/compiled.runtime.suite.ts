import { describe, expect, test } from "bun:test";
import {
  createExecutor,
  executeGraph,
  streamGraph,
} from "@/services/workflows/graph/compiled.ts";
import { createNode, graph } from "@/services/workflows/graph/builder.ts";
import type { ExecutionContext } from "@/services/workflows/graph/types.ts";
import type { TestState } from "./compiled.fixtures.ts";

describe("GraphExecutor - Signal Handling", () => {
  test("pauses execution on human_input_required signal", async () => {
    const pauseNode = createNode<TestState>("pause", "tool", async () => {
      return {
        stateUpdate: { counter: 1 },
        signals: [{ type: "human_input_required", message: "Need input" }],
      };
    });

    const afterPause = createNode<TestState>("after", "tool", async () => {
      return { stateUpdate: { counter: 2 } };
    });

    const workflow = graph<TestState>()
      .start(pauseNode)
      .then(afterPause)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("paused");
    expect(result.state.counter).toBe(1);
  });

  test("collects signals during execution", async () => {
    const signalNode = createNode<TestState>("signal", "tool", async () => {
      return {
        signals: [
          { type: "checkpoint", message: "Save state" },
          { type: "context_window_warning", message: "Context high" },
        ],
      };
    });

    const workflow = graph<TestState>()
      .start(signalNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.snapshot.signals).toHaveLength(2);
    expect(result.snapshot.signals[0]?.type).toBe("checkpoint");
    expect(result.snapshot.signals[1]?.type).toBe("context_window_warning");
  });
});

describe("GraphExecutor - Streaming Execution", () => {
  test("streams results for each executed node", async () => {
    const node1 = createNode<TestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });

    const node2 = createNode<TestState>("node2", "tool", async () => {
      return { stateUpdate: { counter: 2 } };
    });

    const node3 = createNode<TestState>("node3", "tool", async () => {
      return { stateUpdate: { counter: 3 } };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .then(node3)
      .end()
      .compile();

    const steps: string[] = [];
    for await (const step of streamGraph(workflow)) {
      steps.push(step.nodeId);
    }

    expect(steps).toEqual(["node1", "node2", "node3"]);
  });

  test("provides state at each step", async () => {
    const node1 = createNode<TestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });

    const node2 = createNode<TestState>("node2", "tool", async (ctx) => {
      return { stateUpdate: { counter: (ctx.state.counter ?? 0) + 1 } };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const counters: number[] = [];
    for await (const step of streamGraph(workflow)) {
      counters.push(step.state.counter ?? 0);
    }

    expect(counters).toEqual([1, 2]);
  });

  test("emits status correctly during streaming", async () => {
    const node1 = createNode<TestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });

    const node2 = createNode<TestState>("node2", "tool", async () => {
      return { stateUpdate: { counter: 2 } };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const statuses: string[] = [];
    for await (const step of streamGraph(workflow)) {
      statuses.push(step.status);
    }

    expect(statuses).toEqual(["running", "completed"]);
  });

  test("routes updates mode through GraphExecutor.stream", async () => {
    const node = createNode<TestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });

    const workflow = graph<TestState>().start(node).end().compile();
    const executor = createExecutor(workflow);
    const events = [];

    for await (const event of executor.stream({ modes: ["updates"] })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("updates");
    if (events[0]?.mode === "updates") {
      expect(events[0].update.counter).toBe(1);
    }
  });

  test("routes values mode when modes key is undefined", async () => {
    const node = createNode<TestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });

    const workflow = graph<TestState>().start(node).end().compile();
    const events = [];

    for await (const event of streamGraph(workflow, { modes: undefined })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("values");
    if (events[0]?.mode === "values") {
      expect(events[0].state.counter).toBe(1);
    }
  });
});

describe("GraphExecutor - Abort and Limits", () => {
  test("stops execution when abort signal is triggered", async () => {
    const controller = new AbortController();

    const node1 = createNode<TestState>("node1", "tool", async () => {
      controller.abort();
      return { stateUpdate: { counter: 1 } };
    });

    const node2 = createNode<TestState>("node2", "tool", async () => {
      return { stateUpdate: { counter: 2 } };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const result = await executeGraph(workflow, {
      abortSignal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
  });

  test("enforces max steps limit", async () => {
    const node = createNode<TestState>("node", "tool", async (ctx) => {
      return {
        stateUpdate: { counter: (ctx.state.counter ?? 0) + 1 },
        goto: "node",
      };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    workflow.edges.push({ from: "node", to: "node" });

    const result = await executeGraph(workflow, { maxSteps: 5 });

    expect(result.status).toBe("failed");
    expect(result.state.counter).toBeLessThanOrEqual(5);
  });
});

describe("GraphExecutor - Edge Cases", () => {
  test("handles empty state updates", async () => {
    const node = createNode<TestState>("node", "tool", async () => {
      return {};
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.executionId).toBeDefined();
  });

  test("handles node that returns only signals", async () => {
    const node = createNode<TestState>("node", "tool", async () => {
      return {
        signals: [{ type: "checkpoint" }],
      };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.snapshot.signals).toHaveLength(1);
  });

  test("provides initial state to first node", async () => {
    const node = createNode<TestState>("node", "tool", async (ctx) => {
      return {
        stateUpdate: {
          counter: (ctx.state.counter ?? 0) + 10,
        },
      };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow, {
      initialState: { counter: 5 },
    });

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(15);
  });

  test("handles nodes with no outgoing edges", async () => {
    const node1 = createNode<TestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });

    const node2 = createNode<TestState>("node2", "tool", async () => {
      return { stateUpdate: { counter: 2 } };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(workflow.endNodes.has("node2")).toBe(true);
  });

  test("creates unique execution IDs", async () => {
    const node = createNode<TestState>("node", "tool", async () => {
      return {};
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result1 = await executeGraph(workflow);
    const result2 = await executeGraph(workflow);

    expect(result1.state.executionId).not.toBe(result2.state.executionId);
  });
});

describe("GraphExecutor - Context Access", () => {
  test("provides execution context to nodes", async () => {
    let receivedContext: ExecutionContext<TestState> | null = null;

    const node = createNode<TestState>("node", "tool", async (ctx) => {
      receivedContext = ctx;
      return { stateUpdate: { flag: true } };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    await executeGraph(workflow);

    expect(receivedContext).not.toBeNull();
    expect(receivedContext!.state).toBeDefined();
    expect(receivedContext!.config).toBeDefined();
    expect(receivedContext!.errors).toBeInstanceOf(Array);
  });

  test("getNodeOutput returns output from previous nodes", async () => {
    const node1 = createNode<TestState>("node1", "tool", async (ctx) => {
      return {
        stateUpdate: {
          outputs: { ...ctx.state.outputs, node1: "result1" },
        },
      };
    });

    const node2 = createNode<TestState>("node2", "tool", async (ctx) => {
      const node1Output = ctx.getNodeOutput!("node1");
      return {
        stateUpdate: {
          outputs: {
            ...ctx.state.outputs,
            node2: `received: ${node1Output}`,
          },
        },
      };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.state.outputs.node2).toBe("received: result1");
  });
});
