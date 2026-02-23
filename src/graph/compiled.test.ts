/**
 * Tests for CompiledGraph execution engine
 */

import { describe, expect, test } from "bun:test";
import { GraphExecutor, createExecutor, executeGraph, streamGraph, initializeExecutionState, mergeState } from "./compiled.ts";
import { graph, createNode } from "./builder.ts";
import type { BaseState, NodeResult, ExecutionContext } from "./types.ts";

// Test state interface
interface TestState extends BaseState {
  counter?: number;
  messages?: string[];
  flag?: boolean;
  errorCount?: number;
}

describe("initializeExecutionState", () => {
  test("creates a new state with executionId and timestamp", () => {
    const executionId = "test-exec-123";
    const state = initializeExecutionState<TestState>(executionId);
    
    expect(state.executionId).toBe(executionId);
    expect(state.lastUpdated).toBeDefined();
    expect(state.outputs).toEqual({});
  });

  test("merges initial state values", () => {
    const executionId = "test-exec-123";
    const initial: Partial<TestState> = {
      counter: 42,
      messages: ["hello"],
    };
    
    const state = initializeExecutionState<TestState>(executionId, initial);
    
    expect(state.executionId).toBe(executionId);
    expect(state.counter).toBe(42);
    expect(state.messages).toEqual(["hello"]);
    expect(state.outputs).toEqual({});
  });

  test("preserves initial outputs and merges with base", () => {
    const executionId = "test-exec-123";
    const initial: Partial<TestState> = {
      outputs: { node1: "value1" },
    };
    
    const state = initializeExecutionState<TestState>(executionId, initial);
    
    expect(state.outputs).toEqual({ node1: "value1" });
  });

  test("does not allow overwriting executionId", () => {
    const executionId = "test-exec-123";
    const initial: Partial<TestState> = {
      executionId: "wrong-id" as string,
    };
    
    const state = initializeExecutionState<TestState>(executionId, initial);
    
    expect(state.executionId).toBe(executionId);
  });
});

describe("mergeState", () => {
  test("merges partial state updates", () => {
    const current: TestState = {
      executionId: "exec-1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: { node1: "value1" },
      counter: 10,
    };
    
    const update: Partial<TestState> = {
      counter: 20,
      flag: true,
    };
    
    const merged = mergeState(current, update);
    
    expect(merged.counter).toBe(20);
    expect(merged.flag).toBe(true);
    expect(merged.executionId).toBe("exec-1");
    expect(merged.outputs).toEqual({ node1: "value1" });
    expect(merged.lastUpdated).not.toBe(current.lastUpdated);
  });

  test("merges outputs correctly", () => {
    const current: TestState = {
      executionId: "exec-1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: { node1: "value1", node2: "value2" },
    };
    
    const update: Partial<TestState> = {
      outputs: { node2: "updated", node3: "new" },
    };
    
    const merged = mergeState(current, update);
    
    expect(merged.outputs).toEqual({
      node1: "value1",
      node2: "updated",
      node3: "new",
    });
  });

  test("updates lastUpdated timestamp", () => {
    const current: TestState = {
      executionId: "exec-1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: {},
    };
    
    const merged = mergeState(current, {});
    
    expect(merged.lastUpdated).not.toBe(current.lastUpdated);
    expect(new Date(merged.lastUpdated).getTime()).toBeGreaterThan(
      new Date(current.lastUpdated).getTime()
    );
  });
});

describe("GraphExecutor - Basic Execution", () => {
  test("executes a simple linear graph", async () => {
    const node1 = createNode<TestState>("node1", "tool", async (ctx) => {
      return {
        stateUpdate: {
          counter: 1,
          outputs: { ...ctx.state.outputs, node1: "executed" },
        },
      };
    });

    const node2 = createNode<TestState>("node2", "tool", async (ctx) => {
      return {
        stateUpdate: {
          counter: (ctx.state.counter ?? 0) + 1,
          outputs: { ...ctx.state.outputs, node2: "executed" },
        },
      };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(2);
    expect(result.state.outputs.node1).toBe("executed");
    expect(result.state.outputs.node2).toBe("executed");
  });

  test("executes single node graph", async () => {
    const node = createNode<TestState>("single", "tool", async () => {
      return {
        stateUpdate: {
          flag: true,
        },
      };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.flag).toBe(true);
  });

  test("preserves state across multiple nodes", async () => {
    const node1 = createNode<TestState>("node1", "tool", async () => {
      return {
        stateUpdate: {
          messages: ["msg1"],
        },
      };
    });

    const node2 = createNode<TestState>("node2", "tool", async (ctx) => {
      return {
        stateUpdate: {
          messages: [...(ctx.state.messages ?? []), "msg2"],
        },
      };
    });

    const node3 = createNode<TestState>("node3", "tool", async (ctx) => {
      return {
        stateUpdate: {
          messages: [...(ctx.state.messages ?? []), "msg3"],
        },
      };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .then(node3)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["msg1", "msg2", "msg3"]);
  });
});

describe("GraphExecutor - Conditional Routing", () => {
  test("routes through if branch when condition is true", async () => {
    const start = createNode<TestState>("start", "tool", async () => {
      return { stateUpdate: { flag: true } };
    });

    const ifNode = createNode<TestState>("if", "tool", async () => {
      return { stateUpdate: { messages: ["if-branch"] } };
    });

    const elseNode = createNode<TestState>("else", "tool", async () => {
      return { stateUpdate: { messages: ["else-branch"] } };
    });

    const end = createNode<TestState>("end", "tool", async (ctx) => {
      return {
        stateUpdate: {
          messages: [...(ctx.state.messages ?? []), "end"],
        },
      };
    });

    const workflow = graph<TestState>()
      .start(start)
      .if((state) => state.flag === true)
        .then(ifNode)
      .else()
        .then(elseNode)
      .endif()
      .then(end)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["if-branch", "end"]);
  });

  test("routes through else branch when condition is false", async () => {
    const start = createNode<TestState>("start", "tool", async () => {
      return { stateUpdate: { flag: false } };
    });

    const ifNode = createNode<TestState>("if", "tool", async () => {
      return { stateUpdate: { messages: ["if-branch"] } };
    });

    const elseNode = createNode<TestState>("else", "tool", async () => {
      return { stateUpdate: { messages: ["else-branch"] } };
    });

    const end = createNode<TestState>("end", "tool", async (ctx) => {
      return {
        stateUpdate: {
          messages: [...(ctx.state.messages ?? []), "end"],
        },
      };
    });

    const workflow = graph<TestState>()
      .start(start)
      .if((state) => state.flag === true)
        .then(ifNode)
      .else()
        .then(elseNode)
      .endif()
      .then(end)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["else-branch", "end"]);
  });

  test("handles goto in node result", async () => {
    const start = createNode<TestState>("start", "tool", async () => {
      return { goto: "target" };
    });

    const skipped = createNode<TestState>("skipped", "tool", async () => {
      return { stateUpdate: { messages: ["skipped"] } };
    });

    const target = createNode<TestState>("target", "tool", async () => {
      return { stateUpdate: { messages: ["target"] } };
    });

    const workflow = graph<TestState>()
      .start(start)
      .then(skipped)
      .end()
      .compile();

    // Manually add the target node and edge
    workflow.nodes.set("target", target);
    workflow.edges.push({ from: "start", to: "target" });
    // Mark target as an end node since it has no outgoing edges
    workflow.endNodes.add("target");

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["target"]);
  });
});

describe("GraphExecutor - Error Handling", () => {
  test("fails execution when node throws error", async () => {
    const errorNode = createNode<TestState>("error", "tool", async () => {
      throw new Error("Test error");
    });

    const workflow = graph<TestState>()
      .start(errorNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(result.snapshot.errors).toHaveLength(1);
    expect(result.snapshot.errors[0]?.error).toBeInstanceOf(Error);
  });

  test("retries node execution on failure", async () => {
    let attempts = 0;

    const retryNode = createNode<TestState>(
      "retry",
      "tool",
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Retry me");
        }
        return { stateUpdate: { counter: attempts } };
      },
      {
        retry: {
          maxAttempts: 3,
          backoffMs: 10,
          backoffMultiplier: 1,
        },
      }
    );

    const workflow = graph<TestState>()
      .start(retryNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(3);
    expect(attempts).toBe(3);
  });

  test("fails after max retry attempts", async () => {
    let attempts = 0;

    const alwaysFailNode = createNode<TestState>(
      "fail",
      "tool",
      async () => {
        attempts++;
        throw new Error("Always fails");
      },
      {
        retry: {
          maxAttempts: 2,
          backoffMs: 10,
          backoffMultiplier: 1,
        },
      }
    );

    const workflow = graph<TestState>()
      .start(alwaysFailNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(attempts).toBe(2);
  });

  test("respects retryOn predicate", async () => {
    let attempts = 0;

    class RetryableError extends Error {
      retryable = true;
    }
    class NonRetryableError extends Error {
      retryable = false;
    }

    const selectiveRetryNode = createNode<TestState>(
      "selective",
      "tool",
      async () => {
        attempts++;
        if (attempts === 1) {
          throw new NonRetryableError("Do not retry");
        }
        return { stateUpdate: { counter: attempts } };
      },
      {
        retry: {
          maxAttempts: 3,
          backoffMs: 10,
          backoffMultiplier: 1,
          retryOn: (error) => error instanceof RetryableError,
        },
      }
    );

    const workflow = graph<TestState>()
      .start(selectiveRetryNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(attempts).toBe(1); // Should not retry non-retryable error
  });
});

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

  test("emits resolved phase metadata when paused during stream", async () => {
    const pauseNode = createNode<TestState>("pause", "tool", async () => ({
      stateUpdate: { counter: 1 },
      signals: [{ type: "human_input_required", message: "Need input" }],
    }));
    pauseNode.phaseName = "Human Input";
    pauseNode.phaseIcon = "🧑";

    const workflow = graph<TestState>()
      .start(pauseNode)
      .end()
      .compile();

    const steps: Array<{
      status: string;
      phaseName?: string;
      phaseIcon?: string;
      phaseMessage?: string;
    }> = [];
    for await (const step of streamGraph(workflow)) {
      steps.push({
        status: step.status,
        phaseName: step.phaseName,
        phaseIcon: step.phaseIcon,
        phaseMessage: step.phaseMessage,
      });
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("paused");
    expect(steps[0]?.phaseName).toBe("Human Input");
    expect(steps[0]?.phaseIcon).toBe("🧑");
    expect(steps[0]?.phaseMessage).toBe("[Human Input] Completed.");
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

  test("emits default phase metadata from node definition", async () => {
    const node = createNode<TestState>("phase-node", "tool", async () => ({}));
    node.phaseName = "Task Decomposition";
    node.phaseIcon = "📋";

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const steps: Array<{ phaseName?: string; phaseIcon?: string; phaseMessage?: string }> = [];
    for await (const step of streamGraph(workflow)) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.phaseName).toBe("Task Decomposition");
    expect(steps[0]?.phaseIcon).toBe("📋");
    expect(steps[0]?.phaseMessage).toBe("[Task Decomposition] Completed.");
  });

  test("uses node result message for phase metadata when provided", async () => {
    const node = createNode<TestState>("phase-message-node", "tool", async () => ({
      message: "[Code Review] Review completed.",
    }));
    node.phaseName = "Code Review";
    node.phaseIcon = "🔍";

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const messages: Array<{ phaseMessage?: string; phaseName?: string; phaseIcon?: string }> = [];
    for await (const step of streamGraph(workflow)) {
      messages.push({
        phaseMessage: step.phaseMessage,
        phaseName: step.phaseName,
        phaseIcon: step.phaseIcon,
      });
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]?.phaseName).toBe("Code Review");
    expect(messages[0]?.phaseIcon).toBe("🔍");
    expect(messages[0]?.phaseMessage).toBe("[Code Review] Review completed.");
  });

  test("leaves phase metadata undefined when node has no phase or message", async () => {
    const node = createNode<TestState>("plain-node", "tool", async () => ({}));

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const steps: Array<{ phaseMessage?: string; phaseName?: string; phaseIcon?: string }> = [];
    for await (const step of streamGraph(workflow)) {
      steps.push({
        phaseMessage: step.phaseMessage,
        phaseName: step.phaseName,
        phaseIcon: step.phaseIcon,
      });
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.phaseName).toBeUndefined();
    expect(steps[0]?.phaseIcon).toBeUndefined();
    expect(steps[0]?.phaseMessage).toBeUndefined();
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
        goto: "node", // Loop forever
      };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    // Add self-loop edge
    workflow.edges.push({ from: "node", to: "node" });

    const result = await executeGraph(workflow, { maxSteps: 5 });

    expect(result.status).toBe("failed");
    expect(result.state.counter).toBeLessThanOrEqual(5);
  });
});

describe("GraphExecutor - Edge Cases", () => {
  test("handles empty state updates", async () => {
    const node = createNode<TestState>("node", "tool", async () => {
      return {}; // No state update
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
    // node2 has no outgoing edges, so it should be an end node
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
