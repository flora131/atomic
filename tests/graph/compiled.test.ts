/**
 * Integration tests for CompiledGraph execution engine
 *
 * Tests cover:
 * - Basic graph execution with execute()
 * - Streaming execution with stream()
 * - State management and updates
 * - Retry with exponential backoff
 * - Signal handling (human_input_required, checkpoint)
 * - Edge conditions and routing
 * - Checkpointing
 * - Abort/cancellation
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  GraphExecutor,
  createExecutor,
  executeGraph,
  streamGraph,
  initializeExecutionState,
  mergeState,
  isLoopNode,
  type ExecutionOptions,
  type StepResult,
} from "../../src/graph/compiled.ts";
import {
  graph,
  createNode,
  createDecisionNode,
  createWaitNode,
} from "../../src/graph/builder.ts";
import type {
  BaseState,
  NodeDefinition,
  CompiledGraph,
  GraphConfig,
  Checkpointer,
} from "../../src/graph/types.ts";

// ============================================================================
// Test State Types
// ============================================================================

interface TestState extends BaseState {
  counter: number;
  items: string[];
  approved: boolean;
  error?: string;
}

function createTestState(overrides: Partial<TestState> = {}): TestState {
  return {
    executionId: "test-exec-1",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    counter: 0,
    items: [],
    approved: false,
    ...overrides,
  };
}

// ============================================================================
// Test Node Factories
// ============================================================================

function createIncrementNode(id: string): NodeDefinition<TestState> {
  return createNode<TestState>(id, "tool", async (ctx) => ({
    stateUpdate: { counter: ctx.state.counter + 1 },
  }));
}

function createAppendNode(id: string, item: string): NodeDefinition<TestState> {
  return createNode<TestState>(id, "tool", async (ctx) => ({
    stateUpdate: { items: [...ctx.state.items, item] },
  }));
}

function createFailingNode(id: string, failCount: number = 1): NodeDefinition<TestState> {
  let attempts = 0;
  return createNode<TestState>(
    id,
    "tool",
    async () => {
      attempts++;
      if (attempts <= failCount) {
        throw new Error(`Intentional failure ${attempts}`);
      }
      return { stateUpdate: { counter: 999 } };
    },
    { retry: { maxAttempts: 3, backoffMs: 10, backoffMultiplier: 1 } }
  );
}

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("Helper Functions", () => {
  describe("isLoopNode", () => {
    test("returns true for loop_start nodes", () => {
      expect(isLoopNode("loop_start_1")).toBe(true);
      expect(isLoopNode("my_loop_start")).toBe(true);
    });

    test("returns true for loop_check nodes", () => {
      expect(isLoopNode("loop_check_2")).toBe(true);
      expect(isLoopNode("my_loop_check")).toBe(true);
    });

    test("returns false for regular nodes", () => {
      expect(isLoopNode("start")).toBe(false);
      expect(isLoopNode("process")).toBe(false);
      expect(isLoopNode("loop")).toBe(false);
    });
  });

  describe("initializeExecutionState", () => {
    test("creates state with execution ID", () => {
      const state = initializeExecutionState<TestState>("exec-123");
      expect(state.executionId).toBe("exec-123");
      expect(state.outputs).toEqual({});
      expect(state.lastUpdated).toBeDefined();
    });

    test("merges initial values", () => {
      const state = initializeExecutionState<TestState>("exec-123", {
        counter: 5,
        items: ["a"],
      });
      expect(state.counter).toBe(5);
      expect(state.items).toEqual(["a"]);
    });
  });

  describe("mergeState", () => {
    test("merges simple values", () => {
      const current = createTestState({ counter: 5 });
      const updated = mergeState(current, { counter: 10 });

      expect(updated.counter).toBe(10);
      expect(updated.executionId).toBe(current.executionId);
    });

    test("merges outputs specially", () => {
      const current = createTestState();
      current.outputs = { node1: "result1" };

      const updated = mergeState(current, {
        outputs: { node2: "result2" },
      });

      expect(updated.outputs).toEqual({
        node1: "result1",
        node2: "result2",
      });
    });

    test("updates lastUpdated timestamp", async () => {
      const current = createTestState();
      const oldTimestamp = current.lastUpdated;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 2));
      const updated = mergeState(current, { counter: 1 });

      expect(updated.lastUpdated).not.toBe(oldTimestamp);
    });
  });
});

// ============================================================================
// GraphExecutor Tests
// ============================================================================

describe("GraphExecutor", () => {
  describe("execute()", () => {
    test("executes simple linear graph", async () => {
      const compiled = graph<TestState>()
        .start(createIncrementNode("step1"))
        .then(createIncrementNode("step2"))
        .then(createIncrementNode("step3"))
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.status).toBe("completed");
      expect(result.state.counter).toBe(3);
    });

    test("executes graph with multiple nodes", async () => {
      const compiled = graph<TestState>()
        .start(createAppendNode("add-a", "a"))
        .then(createAppendNode("add-b", "b"))
        .then(createAppendNode("add-c", "c"))
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.status).toBe("completed");
      expect(result.state.items).toEqual(["a", "b", "c"]);
    });

    test("uses provided execution ID", async () => {
      const compiled = graph<TestState>()
        .start(createIncrementNode("step"))
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        executionId: "custom-exec-id",
      });

      expect(result.state.executionId).toBe("custom-exec-id");
    });

    test("handles empty result state", async () => {
      const noopNode = createNode<TestState>("noop", "tool", async () => ({}));

      const compiled = graph<TestState>()
        .start(noopNode)
        .end()
        .compile();

      const result = await executeGraph(compiled);

      expect(result.status).toBe("completed");
    });
  });

  describe("stream()", () => {
    test("yields step results for each node", async () => {
      const compiled = graph<TestState>()
        .start(createIncrementNode("step1"))
        .then(createIncrementNode("step2"))
        .end()
        .compile();

      const steps: StepResult<TestState>[] = [];
      for await (const step of streamGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      })) {
        steps.push(step);
      }

      expect(steps.length).toBe(2);
      expect(steps[0]!.nodeId).toBe("step1");
      expect(steps[0]!.state.counter).toBe(1);
      expect(steps[1]!.nodeId).toBe("step2");
      expect(steps[1]!.state.counter).toBe(2);
    });

    test("streams incremental state updates", async () => {
      const compiled = graph<TestState>()
        .start(createAppendNode("a", "first"))
        .then(createAppendNode("b", "second"))
        .then(createAppendNode("c", "third"))
        .end()
        .compile();

      const itemCounts: number[] = [];
      for await (const step of streamGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      })) {
        itemCounts.push(step.state.items.length);
      }

      expect(itemCounts).toEqual([1, 2, 3]);
    });

    test("final step has completed status", async () => {
      const compiled = graph<TestState>()
        .start(createIncrementNode("only"))
        .end()
        .compile();

      let lastStep: StepResult<TestState> | undefined;
      for await (const step of streamGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      })) {
        lastStep = step;
      }

      expect(lastStep?.status).toBe("completed");
    });
  });

  describe("conditional branching", () => {
    test("follows matching condition", async () => {
      const compiled = graph<TestState>()
        .start(createNode<TestState>("init", "tool", async () => ({
          stateUpdate: { counter: 10 },
        })))
        .if((state) => state.counter > 5)
        .then(createAppendNode("high", "high-path"))
        .else()
        .then(createAppendNode("low", "low-path"))
        .endif()
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.state.items).toContain("high-path");
      expect(result.state.items).not.toContain("low-path");
    });

    test("follows else branch when condition is false", async () => {
      const compiled = graph<TestState>()
        .start(createNode<TestState>("init", "tool", async () => ({
          stateUpdate: { counter: 2 },
        })))
        .if((state) => state.counter > 5)
        .then(createAppendNode("high", "high-path"))
        .else()
        .then(createAppendNode("low", "low-path"))
        .endif()
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.state.items).not.toContain("high-path");
      expect(result.state.items).toContain("low-path");
    });
  });

  describe("retry logic", () => {
    test("retries on failure and succeeds", async () => {
      // Fails once, then succeeds
      const failingNode = createFailingNode("retry-test", 1);

      const compiled = graph<TestState>()
        .start(failingNode)
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.status).toBe("completed");
      expect(result.state.counter).toBe(999);
    });

    test("fails after max retry attempts", async () => {
      // Fails 5 times (more than max attempts of 3)
      const alwaysFailNode = createFailingNode("always-fail", 5);

      const compiled = graph<TestState>()
        .start(alwaysFailNode)
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.status).toBe("failed");
    });

    test("succeeds after exactly maxAttempts retries", async () => {
      // Fails 2 times, then succeeds on 3rd attempt (maxAttempts=3)
      const failingNode = createFailingNode("retry-edge", 2);

      const compiled = graph<TestState>()
        .start(failingNode)
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.status).toBe("completed");
      expect(result.state.counter).toBe(999);
    });

    test("applies exponential backoff delays", async () => {
      let attemptTimes: number[] = [];
      let attempts = 0;

      // Create a node that tracks attempt times
      const timingNode = createNode<TestState>(
        "timing-test",
        "tool",
        async () => {
          attemptTimes.push(Date.now());
          attempts++;
          if (attempts < 3) {
            throw new Error(`Intentional failure ${attempts}`);
          }
          return { stateUpdate: { counter: 999 } };
        },
        { retry: { maxAttempts: 3, backoffMs: 50, backoffMultiplier: 2 } }
      );

      const compiled = graph<TestState>()
        .start(timingNode)
        .end()
        .compile();

      await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      // Should have 3 attempts
      expect(attemptTimes.length).toBe(3);

      // Calculate delays between attempts
      const delay1 = attemptTimes[1]! - attemptTimes[0]!;
      const delay2 = attemptTimes[2]! - attemptTimes[1]!;

      // First delay should be ~50ms (backoffMs)
      expect(delay1).toBeGreaterThanOrEqual(40); // Allow 10ms tolerance
      expect(delay1).toBeLessThan(100);

      // Second delay should be ~100ms (50 * 2 = 100)
      expect(delay2).toBeGreaterThanOrEqual(80); // Allow 20ms tolerance
      expect(delay2).toBeLessThan(200);
    });

    test("respects retryOn predicate - retries matching errors", async () => {
      let attempts = 0;

      const selectiveNode = createNode<TestState>(
        "selective-retry",
        "tool",
        async () => {
          attempts++;
          if (attempts < 3) {
            const error = new Error("transient_error");
            throw error;
          }
          return { stateUpdate: { counter: 999 } };
        },
        {
          retry: {
            maxAttempts: 3,
            backoffMs: 10,
            backoffMultiplier: 1,
            retryOn: (error) => error.message.includes("transient"),
          },
        }
      );

      const compiled = graph<TestState>()
        .start(selectiveNode)
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.status).toBe("completed");
      expect(attempts).toBe(3);
    });

    test("respects retryOn predicate - does not retry non-matching errors", async () => {
      let attempts = 0;

      const selectiveNode = createNode<TestState>(
        "no-retry",
        "tool",
        async () => {
          attempts++;
          throw new Error("permanent_error");
        },
        {
          retry: {
            maxAttempts: 3,
            backoffMs: 10,
            backoffMultiplier: 1,
            retryOn: (error) => error.message.includes("transient"),
          },
        }
      );

      const compiled = graph<TestState>()
        .start(selectiveNode)
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      // Should fail immediately without retrying
      expect(result.status).toBe("failed");
      expect(attempts).toBe(1);
    });

    test("tracks attempt count in execution error", async () => {
      const alwaysFailNode = createNode<TestState>(
        "tracked-failure",
        "tool",
        async () => {
          throw new Error("Always fails");
        },
        { retry: { maxAttempts: 3, backoffMs: 10, backoffMultiplier: 1 } }
      );

      const compiled = graph<TestState>()
        .start(alwaysFailNode)
        .end()
        .compile();

      const steps: StepResult<TestState>[] = [];
      for await (const step of streamGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      })) {
        steps.push(step);
      }

      // Last step should be failed with error
      const lastStep = steps[steps.length - 1]!;
      expect(lastStep.status).toBe("failed");
      expect(lastStep.error).toBeDefined();
      expect(lastStep.error!.attempt).toBe(3); // All 3 attempts exhausted
      expect(lastStep.error!.nodeId).toBe("tracked-failure");
    });

    test("uses default retry config when not specified", async () => {
      let attempts = 0;

      // Node without explicit retry config - uses DEFAULT_RETRY_CONFIG
      const defaultRetryNode = createNode<TestState>(
        "default-retry",
        "tool",
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error(`Failure ${attempts}`);
          }
          return { stateUpdate: { counter: 999 } };
        }
        // No retry config - will use default
      );

      const compiled = graph<TestState>()
        .start(defaultRetryNode)
        .end()
        .compile();

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      // Default maxAttempts is 3, so should succeed
      expect(result.status).toBe("completed");
      expect(attempts).toBe(3);
    });
  });

  describe("signal handling", () => {
    test("pauses on human_input_required signal", async () => {
      const waitNode = createWaitNode<TestState>("approval", "Please approve");

      const compiled = graph<TestState>()
        .start(createIncrementNode("before"))
        .then(waitNode)
        .then(createIncrementNode("after"))
        .end()
        .compile();

      const steps: StepResult<TestState>[] = [];
      for await (const step of streamGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      })) {
        steps.push(step);
      }

      // Should pause at the wait node
      const lastStep = steps[steps.length - 1]!;
      expect(lastStep.status).toBe("paused");
      expect(lastStep.nodeId).toBe("approval");
    });

    test("emits signals in step results", async () => {
      const signalNode = createNode<TestState>("signal", "tool", async () => ({
        signals: [
          { type: "context_window_warning", message: "High usage" },
        ],
      }));

      const compiled = graph<TestState>()
        .start(signalNode)
        .end()
        .compile();

      const steps: StepResult<TestState>[] = [];
      for await (const step of streamGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      })) {
        steps.push(step);
      }

      expect(steps[0]!.result.signals).toBeDefined();
      expect(steps[0]!.result.signals![0]!.type).toBe("context_window_warning");
    });
  });

  describe("abort handling", () => {
    test("cancels execution on abort signal", async () => {
      const abortController = new AbortController();

      const slowNode = createNode<TestState>("slow", "tool", async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { stateUpdate: { counter: 100 } };
      });

      const compiled = graph<TestState>()
        .start(slowNode)
        .then(createIncrementNode("after"))
        .end()
        .compile();

      // Abort immediately
      abortController.abort();

      const result = await executeGraph(compiled, {
        abortSignal: abortController.signal,
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.status).toBe("cancelled");
    });
  });

  describe("max steps limit", () => {
    test("fails when exceeding max steps", async () => {
      // Create a graph that would run forever
      const loopNode = createNode<TestState>("loop", "tool", async (ctx) => ({
        stateUpdate: { counter: ctx.state.counter + 1 },
        goto: "loop", // Always go back to itself
      }));

      const compiled: CompiledGraph<TestState> = {
        nodes: new Map([["loop", loopNode]]),
        edges: [],
        startNode: "loop",
        endNodes: new Set(),
        config: {},
      };

      const result = await executeGraph(compiled, {
        maxSteps: 5,
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.status).toBe("failed");
      expect(result.state.counter).toBeLessThanOrEqual(5);
    });
  });

  describe("checkpointing", () => {
    test("saves checkpoints when enabled", async () => {
      const savedCheckpoints: Array<{ id: string; label: string }> = [];

      const mockCheckpointer: Checkpointer<TestState> = {
        save: async (id, _state, label) => {
          savedCheckpoints.push({ id, label: label ?? "" });
        },
        load: async () => null,
        list: async () => [],
        delete: async () => {},
      };

      const compiled = graph<TestState>()
        .start(createIncrementNode("step1"))
        .then(createIncrementNode("step2"))
        .end()
        .compile({ checkpointer: mockCheckpointer, autoCheckpoint: true });

      await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      // Should have checkpointed after each step
      expect(savedCheckpoints.length).toBeGreaterThan(0);
    });

    test("handles checkpoint errors gracefully", async () => {
      const failingCheckpointer: Checkpointer<TestState> = {
        save: async () => {
          throw new Error("Checkpoint failed");
        },
        load: async () => null,
        list: async () => [],
        delete: async () => {},
      };

      const compiled = graph<TestState>()
        .start(createIncrementNode("step"))
        .end()
        .compile({ checkpointer: failingCheckpointer, autoCheckpoint: true });

      // Should complete despite checkpoint failure
      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });
      expect(result.status).toBe("completed");
    });
  });

  describe("goto handling", () => {
    test("respects goto result to skip nodes", async () => {
      const skipNode = createNode<TestState>("skipper", "tool", async () => ({
        goto: "final", // Skip to final
      }));

      const skippedNode = createAppendNode("skipped", "should-not-see");
      const finalNode = createAppendNode("final", "final-item");

      // Manually build graph with edges
      const compiled: CompiledGraph<TestState> = {
        nodes: new Map([
          ["skipper", skipNode],
          ["skipped", skippedNode],
          ["final", finalNode],
        ]),
        edges: [
          { from: "skipper", to: "skipped" },
          { from: "skipped", to: "final" },
        ],
        startNode: "skipper",
        endNodes: new Set(["final"]),
        config: {},
      };

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      expect(result.state.items).toContain("final-item");
      expect(result.state.items).not.toContain("should-not-see");
    });

    test("handles goto to multiple nodes", async () => {
      // A node that goes to multiple targets
      const multiNode = createNode<TestState>("multi", "tool", async () => ({
        goto: ["path-a", "path-b"],
      }));

      const pathA = createAppendNode("path-a", "a");
      const pathB = createAppendNode("path-b", "b");

      const compiled: CompiledGraph<TestState> = {
        nodes: new Map([
          ["multi", multiNode],
          ["path-a", pathA],
          ["path-b", pathB],
        ]),
        edges: [],
        startNode: "multi",
        endNodes: new Set(["path-a", "path-b"]),
        config: {},
      };

      const result = await executeGraph(compiled, {
        initialState: { counter: 0, items: [], approved: false },
      });

      // Should visit both paths
      expect(result.state.items).toContain("a");
      expect(result.state.items).toContain("b");
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("Factory Functions", () => {
  test("createExecutor returns GraphExecutor instance", () => {
    const compiled = graph<TestState>()
      .start(createIncrementNode("test"))
      .end()
      .compile();

    const executor = createExecutor(compiled);
    expect(executor).toBeInstanceOf(GraphExecutor);
  });

  test("executeGraph is equivalent to createExecutor().execute()", async () => {
    const compiled = graph<TestState>()
      .start(createIncrementNode("test"))
      .end()
      .compile();

    const opts = { initialState: { counter: 0, items: [], approved: false } };
    const result1 = await executeGraph(compiled, opts);
    const result2 = await createExecutor(compiled).execute(opts);

    expect(result1.status).toBe(result2.status);
    expect(result1.state.counter).toBe(result2.state.counter);
  });

  test("streamGraph is equivalent to createExecutor().stream()", async () => {
    const compiled = graph<TestState>()
      .start(createIncrementNode("step1"))
      .then(createIncrementNode("step2"))
      .end()
      .compile();

    const opts = { initialState: { counter: 0, items: [], approved: false } };

    const steps1: StepResult<TestState>[] = [];
    for await (const step of streamGraph(compiled, opts)) {
      steps1.push(step);
    }

    const steps2: StepResult<TestState>[] = [];
    for await (const step of createExecutor(compiled).stream(opts)) {
      steps2.push(step);
    }

    expect(steps1.length).toBe(steps2.length);
    expect(steps1.map((s) => s.nodeId)).toEqual(steps2.map((s) => s.nodeId));
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge Cases", () => {
  test("handles node that returns no state update", async () => {
    const noopNode = createNode<TestState>("noop", "tool", async () => ({}));

    const compiled = graph<TestState>()
      .start(noopNode)
      .end()
      .compile();

    const result = await executeGraph(compiled, {
      initialState: { counter: 42, items: [], approved: false },
    });

    expect(result.state.counter).toBe(42); // Unchanged
  });

  test("handles single-node graph", async () => {
    const compiled = graph<TestState>()
      .start(createIncrementNode("only"))
      .end()
      .compile();

    const result = await executeGraph(compiled, {
      initialState: { counter: 0, items: [], approved: false },
    });

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(1);
  });

  test("handles deeply nested outputs", async () => {
    const complexNode = createNode<TestState>("complex", "tool", async (ctx) => ({
      stateUpdate: {
        outputs: {
          ...ctx.state.outputs,
          complex: {
            nested: {
              deeply: {
                value: 42,
              },
            },
          },
        },
      },
    }));

    const compiled = graph<TestState>()
      .start(complexNode)
      .end()
      .compile();

    const result = await executeGraph(compiled, {
      initialState: { counter: 0, items: [], approved: false },
    });

    const output = result.state.outputs["complex"] as Record<string, unknown>;
    expect(output).toBeDefined();
    expect((output.nested as Record<string, unknown>).deeply).toEqual({ value: 42 });
  });
});
