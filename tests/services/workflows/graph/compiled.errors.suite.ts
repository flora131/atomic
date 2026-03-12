import { describe, expect, test } from "bun:test";
import { executeGraph, streamGraph } from "@/services/workflows/graph/compiled.ts";
import { createNode, graph } from "@/services/workflows/graph/builder.ts";
import type { TestState } from "./compiled.fixtures.ts";

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
      },
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
      },
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

    class RetryableError extends Error {}
    class NonRetryableError extends Error {}

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
      },
    );

    const workflow = graph<TestState>()
      .start(selectiveRetryNode)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(attempts).toBe(1);
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
      },
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
      },
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
      },
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
      },
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
      { isRecoveryNode: true },
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
      },
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
        'onError goto target "non_recovery" must set isRecoveryNode: true',
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
      },
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
        'onError goto target "missing_recovery" not found in graph',
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
      },
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
      },
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
      },
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
      },
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
      { isRecoveryNode: true },
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
