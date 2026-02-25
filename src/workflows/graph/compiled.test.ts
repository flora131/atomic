/**
 * Tests for CompiledGraph execution engine
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { GraphExecutor, createExecutor, executeGraph, streamGraph, initializeExecutionState, mergeState } from "./compiled.ts";
import { graph, createNode } from "./builder.ts";
import type { BaseState, NodeResult, ExecutionContext } from "./types.ts";
import { SchemaValidationError } from "./errors.ts";

// Test state interface
interface TestState extends BaseState {
  counter?: number;
  messages?: string[];
  flag?: boolean;
  errorCount?: number;
}

const testStateSchema: z.ZodType<TestState> = z.object({
  executionId: z.string(),
  lastUpdated: z.string(),
  outputs: z.record(z.string(), z.unknown()),
  counter: z.number().optional(),
  messages: z.array(z.string()).optional(),
  flag: z.boolean().optional(),
  errorCount: z.number().optional(),
});

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

  test("handles node-level onError retry action", async () => {
    let attempts = 0;

    const retryWithHook = createNode<TestState>(
      "retry_with_hook",
      "tool",
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error("retry once");
        }
        return { stateUpdate: { counter: attempts } };
      },
      {
        retry: {
          maxAttempts: 3,
          backoffMs: 10,
          backoffMultiplier: 1,
        },
        onError: async () => ({ action: "retry", delay: 1 }),
      }
    );

    const workflow = graph<TestState>()
      .start(retryWithHook)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(2);
    expect(attempts).toBe(2);
  });

  test("handles node-level onError skip action", async () => {
    const skipOnErrorNode = createNode<TestState>(
      "skip_on_error",
      "tool",
      async () => {
        throw new Error("skip this node");
      },
      {
        onError: async () => ({ action: "skip", fallbackState: { errorCount: 1 } }),
      }
    );

    const afterSkipNode = createNode<TestState>("after_skip", "tool", async (ctx) => {
      return { stateUpdate: { counter: (ctx.state.counter ?? 0) + 1 } };
    });

    const workflow = graph<TestState>()
      .start(skipOnErrorNode)
      .then(afterSkipNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.errorCount).toBe(1);
    expect(result.state.counter).toBe(1);
  });

  test("handles node-level onError abort action", async () => {
    const abortOnErrorNode = createNode<TestState>(
      "abort_on_error",
      "tool",
      async () => {
        throw new Error("original error");
      },
      {
        onError: async () => ({ action: "abort", error: new Error("aborted by hook") }),
      }
    );

    const workflow = graph<TestState>()
      .start(abortOnErrorNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(result.snapshot.errors).toHaveLength(1);
    const executionError = result.snapshot.errors[0]?.error;
    expect(executionError).toBeInstanceOf(Error);
    if (executionError instanceof Error) {
      expect(executionError.message).toBe("aborted by hook");
    }
  });

  test("handles node-level onError goto action", async () => {
    const failAndGotoRecovery = createNode<TestState>(
      "fail_then_goto",
      "tool",
      async () => {
        throw new Error("trigger recovery");
      },
      {
        onError: async () => ({ action: "goto", nodeId: "recovery" }),
      }
    );

    const skippedNode = createNode<TestState>("skipped", "tool", async () => {
      return { stateUpdate: { messages: ["skipped"] } };
    });

    const recoveryNode = createNode<TestState>(
      "recovery",
      "tool",
      async () => {
        return { stateUpdate: { messages: ["recovery"] } };
      },
      { isRecoveryNode: true }
    );

    const workflow = graph<TestState>()
      .start(failAndGotoRecovery)
      .then(skippedNode)
      .then(recoveryNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["recovery"]);
  });

  test("fails on node-level onError goto when target is not a recovery node", async () => {
    const failAndGotoNonRecovery = createNode<TestState>(
      "fail_then_goto_non_recovery",
      "tool",
      async () => {
        throw new Error("trigger invalid recovery");
      },
      {
        onError: async () => ({ action: "goto", nodeId: "non_recovery" }),
      }
    );

    const nonRecoveryNode = createNode<TestState>("non_recovery", "tool", async () => {
      return { stateUpdate: { messages: ["non-recovery"] } };
    });

    const workflow = graph<TestState>()
      .start(failAndGotoNonRecovery)
      .then(nonRecoveryNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(result.snapshot.errors).toHaveLength(1);
    const executionError = result.snapshot.errors[0]?.error;
    expect(executionError).toBeInstanceOf(Error);
    if (executionError instanceof Error) {
      expect(executionError.message).toContain(
        'onError goto target "non_recovery" must set isRecoveryNode: true'
      );
    }
  });

  test("fails on node-level onError goto when target node does not exist", async () => {
    const failAndGotoMissing = createNode<TestState>(
      "fail_then_goto_missing",
      "tool",
      async () => {
        throw new Error("trigger missing recovery");
      },
      {
        onError: async () => ({ action: "goto", nodeId: "missing_recovery" }),
      }
    );

    const workflow = graph<TestState>()
      .start(failAndGotoMissing)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(result.snapshot.errors).toHaveLength(1);
    const executionError = result.snapshot.errors[0]?.error;
    expect(executionError).toBeInstanceOf(Error);
    if (executionError instanceof Error) {
      expect(executionError.message).toContain(
        'onError goto target "missing_recovery" not found in graph'
      );
    }
  });
});

describe("GraphExecutor - ErrorAction Routing", () => {
  test("routes retry action back to the failing node before continuing", async () => {
    let attempts = 0;

    const retryActionNode = createNode<TestState>(
      "retry_action",
      "tool",
      async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("retry once");
        }
        return { stateUpdate: { counter: attempts } };
      },
      {
        retry: {
          maxAttempts: 2,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
        onError: async () => ({ action: "retry", delay: 0 }),
      }
    );

    const afterRetry = createNode<TestState>("after_retry", "tool", async (ctx) => {
      return { stateUpdate: { counter: (ctx.state.counter ?? 0) + 1 } };
    });

    const workflow = graph<TestState>()
      .start(retryActionNode)
      .then(afterRetry)
      .end()
      .compile();

    const visited: string[] = [];
    let finalState: TestState | undefined;

    for await (const step of streamGraph(workflow)) {
      visited.push(step.nodeId);
      finalState = step.state;
    }

    expect(visited).toEqual(["retry_action", "after_retry"]);
    expect(finalState?.counter).toBe(3);
    expect(attempts).toBe(2);
  });

  test("routes skip action to downstream edge with fallback state", async () => {
    const skipActionNode = createNode<TestState>(
      "skip_action",
      "tool",
      async () => {
        throw new Error("skip this");
      },
      {
        onError: async () => ({ action: "skip", fallbackState: { messages: ["skipped"] } }),
      }
    );

    const afterSkipRoute = createNode<TestState>("after_skip_route", "tool", async (ctx) => {
      return { stateUpdate: { messages: [...(ctx.state.messages ?? []), "after"] } };
    });

    const workflow = graph<TestState>()
      .start(skipActionNode)
      .then(afterSkipRoute)
      .end()
      .compile();

    const visited: string[] = [];
    let finalState: TestState | undefined;

    for await (const step of streamGraph(workflow)) {
      visited.push(step.nodeId);
      finalState = step.state;
    }

    expect(visited).toEqual(["skip_action", "after_skip_route"]);
    expect(finalState?.messages).toEqual(["skipped", "after"]);
  });

  test("routes abort action to terminal failed status", async () => {
    const abortActionNode = createNode<TestState>(
      "abort_action",
      "tool",
      async () => {
        throw new Error("original");
      },
      {
        onError: async () => ({ action: "abort", error: new Error("abort now") }),
      }
    );

    const shouldNotRun = createNode<TestState>("should_not_run", "tool", async () => {
      return { stateUpdate: { counter: 999 } };
    });

    const workflow = graph<TestState>()
      .start(abortActionNode)
      .then(shouldNotRun)
      .end()
      .compile();

    const visited: string[] = [];
    let finalStatus: string | undefined;

    for await (const step of streamGraph(workflow)) {
      visited.push(step.nodeId);
      finalStatus = step.status;
    }

    expect(visited).toEqual(["abort_action"]);
    expect(finalStatus).toBe("failed");
  });

  test("routes goto action directly to recovery node", async () => {
    const gotoActionNode = createNode<TestState>(
      "goto_action",
      "tool",
      async () => {
        throw new Error("route to recovery");
      },
      {
        onError: async () => ({ action: "goto", nodeId: "recovery_route" }),
      }
    );

    const normalPathNode = createNode<TestState>("normal_path", "tool", async () => {
      return { stateUpdate: { messages: ["normal"] } };
    });

    const recoveryRoute = createNode<TestState>(
      "recovery_route",
      "tool",
      async () => {
        return { stateUpdate: { messages: ["recovery"] } };
      },
      { isRecoveryNode: true }
    );

    const workflow = graph<TestState>()
      .start(gotoActionNode)
      .then(normalPathNode)
      .then(recoveryRoute)
      .end()
      .compile();

    const visited: string[] = [];
    let finalState: TestState | undefined;

    for await (const step of streamGraph(workflow)) {
      visited.push(step.nodeId);
      finalState = step.state;
    }

    expect(visited).toEqual(["goto_action", "recovery_route"]);
    expect(finalState?.messages).toEqual(["recovery"]);
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

describe("GraphExecutor - State Validation", () => {
  test("accepts execution when node inputSchema is satisfied", async () => {
    const node = createNode<TestState>(
      "validated-input",
      "tool",
      async (ctx) => {
        return { stateUpdate: { counter: (ctx.state.counter ?? 0) + 1 } };
      },
      {
        inputSchema: testStateSchema.refine(
          (state) => typeof state.counter === "number" && state.counter >= 1,
          { message: "counter must be >= 1", path: ["counter"] }
        ),
      }
    );

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow, { initialState: { counter: 1 } });

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(2);
  });

  test("fails execution when node inputSchema is violated", async () => {
    let executed = false;

    const node = createNode<TestState>(
      "invalid-input",
      "tool",
      async () => {
        executed = true;
        return { stateUpdate: { counter: 5 } };
      },
      {
        inputSchema: testStateSchema.refine(
          (state) => typeof state.counter === "number" && state.counter >= 1,
          { message: "counter must be >= 1", path: ["counter"] }
        ),
        retry: {
          maxAttempts: 1,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
      }
    );

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(executed).toBe(false);
    expect(result.snapshot.errors[0]?.error).toBeInstanceOf(SchemaValidationError);
  });

  test("fails execution when node outputSchema is violated", async () => {
    const node = createNode<TestState>(
      "invalid-node-output",
      "tool",
      async () => {
        return { stateUpdate: { counter: 1 } };
      },
      {
        outputSchema: testStateSchema.refine(
          (state) => state.counter === undefined || state.counter >= 2,
          { message: "counter must be >= 2", path: ["counter"] }
        ),
        retry: {
          maxAttempts: 1,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
      }
    );

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(result.snapshot.errors[0]?.error).toBeInstanceOf(SchemaValidationError);
  });

  test("accepts valid state updates when outputSchema is configured", async () => {
    const node = createNode<TestState>("valid", "tool", async () => {
      return { stateUpdate: { counter: 2 } };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile({ outputSchema: testStateSchema });

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(2);
  });

  test("fails execution when state update violates outputSchema", async () => {
    const node = createNode<TestState>(
      "invalid",
      "tool",
      async () => {
        return { stateUpdate: { counter: 1 } };
      },
      {
        retry: {
          maxAttempts: 1,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
      }
    );

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile({
        outputSchema: testStateSchema.refine(
          (state) => state.counter === undefined || state.counter >= 2,
          { message: "counter must be >= 2", path: ["counter"] }
        ),
      });

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(result.snapshot.errors[0]?.error).toBeInstanceOf(SchemaValidationError);
  });
});
