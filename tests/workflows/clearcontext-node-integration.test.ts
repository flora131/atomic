/**
 * Integration tests for Context window management with clearContextNode
 *
 * Tests cover:
 * - Create workflow with loop containing clearContextNode
 * - Execute multiple loop iterations
 * - Verify context cleared at start of each iteration
 * - Verify state preserved across context clears
 * - Verify workflow completes successfully
 *
 * Reference: "Integration test: Context window management with clearContextNode"
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  graph,
  createNode,
} from "../../src/graph/builder.ts";
import {
  executeGraph,
  streamGraph,
  createExecutor,
  type StepResult,
  type ExecutionResult,
} from "../../src/graph/compiled.ts";
import {
  clearContextNode,
  type ContextMonitoringState,
} from "../../src/graph/nodes.ts";
import type {
  BaseState,
  NodeDefinition,
  SignalData,
  ContextWindowUsage,
} from "../../src/graph/types.ts";

// ============================================================================
// Test State Types
// ============================================================================

/**
 * Extended test state that includes context monitoring fields.
 */
interface ClearContextTestState extends BaseState, ContextMonitoringState {
  /** Counter for tracking node executions */
  nodeExecutionCount: number;

  /** Array of executed node IDs in order */
  executedNodes: string[];

  /** Data accumulated during workflow execution */
  data: Record<string, unknown>;

  /** Loop counter */
  loopCounter: number;

  /** Maximum loop iterations */
  maxLoops: number;

  /** Flag indicating workflow completion */
  isComplete: boolean;

  /** Track context clear events */
  contextClearEvents: Array<{
    iteration: number;
    timestamp: string;
    signalReceived: boolean;
  }>;

  /** Important state that should be preserved across context clears */
  importantData: string;

  /** Accumulator for values across iterations */
  accumulatedValues: number[];
}

/**
 * Create a fresh test state with default values.
 */
function createTestState(overrides: Partial<ClearContextTestState> = {}): ClearContextTestState {
  return {
    executionId: `test-exec-${Date.now()}`,
    lastUpdated: new Date().toISOString(),
    outputs: {},
    nodeExecutionCount: 0,
    executedNodes: [],
    data: {},
    loopCounter: 0,
    maxLoops: 3,
    isComplete: false,
    contextWindowUsage: null,
    contextClearEvents: [],
    importantData: "preserved",
    accumulatedValues: [],
    ...overrides,
  };
}

// ============================================================================
// Test Node Factories
// ============================================================================

/**
 * Create a node that tracks execution order.
 */
function createTrackingNode(
  id: string,
  data?: Record<string, unknown>
): NodeDefinition<ClearContextTestState> {
  return createNode<ClearContextTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      data: { ...ctx.state.data, ...data },
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a completion node that marks workflow as complete.
 */
function createCompletionNode(id: string): NodeDefinition<ClearContextTestState> {
  return createNode<ClearContextTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      isComplete: true,
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a loop body node that increments the loop counter and accumulates values.
 */
function createLoopBodyNode(id: string): NodeDefinition<ClearContextTestState> {
  return createNode<ClearContextTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      loopCounter: ctx.state.loopCounter + 1,
      accumulatedValues: [...ctx.state.accumulatedValues, ctx.state.loopCounter + 1],
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a node that tracks context clear events.
 */
function createContextClearTrackerNode(id: string): NodeDefinition<ClearContextTestState> {
  return createNode<ClearContextTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      contextClearEvents: [
        ...ctx.state.contextClearEvents,
        {
          iteration: ctx.state.loopCounter,
          timestamp: new Date().toISOString(),
          signalReceived: true,
        },
      ],
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a node that modifies important data to verify it's preserved.
 */
function createImportantDataNode(
  id: string,
  newValue: string
): NodeDefinition<ClearContextTestState> {
  return createNode<ClearContextTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      importantData: newValue,
      lastUpdated: new Date().toISOString(),
    },
  }));
}

// ============================================================================
// ClearContextNode Workflow Tests
// ============================================================================

describe("Context Window Management with clearContextNode", () => {
  describe("Creating workflow with loop containing clearContextNode", () => {
    test("clearContextNode can be added to workflow", () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context for next iteration",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      expect(workflow).toBeDefined();
      expect(workflow.nodes.has("clear-context")).toBe(true);
    });

    test("workflow with clearContextNode inside loop has correct structure", () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context for next iteration",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= state.maxLoops,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      expect(workflow.nodes.size).toBeGreaterThan(0);
      expect(workflow.startNode).toBe("start");
      expect(workflow.nodes.has("clear-context")).toBe(true);
      expect(workflow.nodes.has("loop-body")).toBe(true);
    });

    test("clearContextNode is of type tool", () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Test message",
      });

      expect(clearNode.type).toBe("tool");
    });

    test("clearContextNode has correct name and description", () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        name: "Custom Clear",
        description: "Custom description",
        message: "Test message",
      });

      expect(clearNode.name).toBe("Custom Clear");
      expect(clearNode.description).toBe("Custom description");
    });
  });

  describe("Execute multiple loop iterations", () => {
    test("workflow executes loop with clearContextNode multiple times", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: (state) => `Iteration ${state.loopCounter}: Clearing context`,
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= state.maxLoops,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 3 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.loopCounter).toBe(3);
      expect(result.state.isComplete).toBe(true);
    });

    test("clearContextNode executes at start of each iteration", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 3,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState({ maxLoops: 3 }),
      })) {
        steps.push(step);
      }

      // Count how many times clear-context was executed
      const clearContextExecutions = steps.filter(
        (s) => s.nodeId === "clear-context"
      );

      // Should execute 3 times (once per iteration)
      expect(clearContextExecutions.length).toBe(3);

      // Verify order: clear-context should come before loop-body in each iteration
      const orderedNodeIds = steps.map((s) => s.nodeId);

      // Find pairs of clear-context and loop-body
      let clearIndex = -1;
      for (let i = 0; i < orderedNodeIds.length; i++) {
        if (orderedNodeIds[i] === "clear-context") {
          clearIndex = i;
        } else if (orderedNodeIds[i] === "loop-body" && clearIndex >= 0) {
          // loop-body should come after clear-context
          expect(i).toBeGreaterThan(clearIndex);
          clearIndex = -1;
        }
      }
    });

    test("loop respects maxIterations limit with clearContextNode", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: () => false, // Never true - would loop forever
          maxIterations: 5,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      // Should stop at maxIterations
      expect(result.state.loopCounter).toBe(5);
    });
  });

  describe("Verify context cleared at start of each iteration", () => {
    test("clearContextNode emits context_window_warning signal", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Test clearing message",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const clearStep = steps.find((s) => s.nodeId === "clear-context");
      expect(clearStep).toBeDefined();
      expect(clearStep!.result.signals).toBeDefined();
      expect(clearStep!.result.signals!.length).toBeGreaterThan(0);

      const contextSignal = clearStep!.result.signals!.find(
        (s) => s.type === "context_window_warning"
      );
      expect(contextSignal).toBeDefined();
    });

    test("context_window_warning signal has action: summarize", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Test message",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const clearStep = steps.find((s) => s.nodeId === "clear-context");
      const contextSignal = clearStep!.result.signals!.find(
        (s) => s.type === "context_window_warning"
      );

      expect(contextSignal!.data).toBeDefined();
      expect((contextSignal!.data as Record<string, unknown>).action).toBe("summarize");
    });

    test("context_window_warning signal contains correct message", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Custom clear message for testing",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const clearStep = steps.find((s) => s.nodeId === "clear-context");
      const contextSignal = clearStep!.result.signals!.find(
        (s) => s.type === "context_window_warning"
      );

      expect(contextSignal!.message).toBe("Custom clear message for testing");
    });

    test("dynamic message is resolved from state", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: (state) => `Iteration ${state.loopCounter}: Clearing context`,
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 2,
          maxIterations: 5,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState({ maxLoops: 2 }),
      })) {
        steps.push(step);
      }

      const clearSteps = steps.filter((s) => s.nodeId === "clear-context");

      // First iteration should have loopCounter 0
      const signal1 = clearSteps[0]!.result.signals!.find(
        (s) => s.type === "context_window_warning"
      );
      expect(signal1!.message).toBe("Iteration 0: Clearing context");

      // Second iteration should have loopCounter 1
      const signal2 = clearSteps[1]!.result.signals!.find(
        (s) => s.type === "context_window_warning"
      );
      expect(signal2!.message).toBe("Iteration 1: Clearing context");
    });

    test("clearContextNode emits signal with usage: 100 to force summarization", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Force summarization",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const clearStep = steps.find((s) => s.nodeId === "clear-context");
      const contextSignal = clearStep!.result.signals!.find(
        (s) => s.type === "context_window_warning"
      );

      expect((contextSignal!.data as Record<string, unknown>).usage).toBe(100);
    });

    test("clearContextNode signal includes nodeId", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "my-clear-node",
        message: "Test",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const clearStep = steps.find((s) => s.nodeId === "my-clear-node");
      const contextSignal = clearStep!.result.signals!.find(
        (s) => s.type === "context_window_warning"
      );

      expect((contextSignal!.data as Record<string, unknown>).nodeId).toBe("my-clear-node");
    });
  });

  describe("Verify state preserved across context clears", () => {
    test("important data is preserved after clearContextNode execution", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createImportantDataNode("set-data", "critical information"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ importantData: "initial" }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.importantData).toBe("critical information");
    });

    test("accumulated values are preserved across loop iterations with clearContextNode", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 4,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 4 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.accumulatedValues).toEqual([1, 2, 3, 4]);
    });

    test("executedNodes array preserves all node executions across context clears", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 2,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 2 }),
      });

      expect(result.status).toBe("completed");
      // Should contain: start, loop-body (x2), complete
      // clearContextNode doesn't add to executedNodes (it's a tool node that emits signals)
      expect(result.state.executedNodes).toContain("start");
      expect(result.state.executedNodes).toContain("loop-body");
      expect(result.state.executedNodes).toContain("complete");
      expect(result.state.executedNodes.filter((n) => n === "loop-body")).toHaveLength(2);
    });

    test("outputs object is preserved across context clears", async () => {
      const setOutputNode = createNode<ClearContextTestState>(
        "set-output",
        "tool",
        async (ctx) => ({
          stateUpdate: {
            outputs: {
              ...ctx.state.outputs,
              testOutput: { value: "preserved output" },
            },
            nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
            executedNodes: [...ctx.state.executedNodes, "set-output"],
          },
        })
      );

      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(setOutputNode)
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      expect(result.state.outputs.testOutput).toEqual({ value: "preserved output" });
    });

    test("loop counter state is preserved and incremented correctly", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 5,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 5 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.loopCounter).toBe(5);
    });

    test("data object accumulates values across iterations with context clears", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const dataAccumulatorNode = createNode<ClearContextTestState>(
        "accumulate",
        "tool",
        async (ctx) => ({
          stateUpdate: {
            nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
            executedNodes: [...ctx.state.executedNodes, "accumulate"],
            loopCounter: ctx.state.loopCounter + 1,
            data: {
              ...ctx.state.data,
              [`iteration_${ctx.state.loopCounter}`]: `value_${ctx.state.loopCounter}`,
            },
          },
        })
      );

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, dataAccumulatorNode], {
          until: (state) => state.loopCounter >= 3,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 3 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.data).toMatchObject({
        iteration_0: "value_0",
        iteration_1: "value_1",
        iteration_2: "value_2",
      });
    });
  });

  describe("Verify workflow completes successfully", () => {
    test("workflow completes successfully with clearContextNode in loop", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= state.maxLoops,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 3 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.isComplete).toBe(true);
    });

    test("workflow with single iteration loop completes", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Single iteration clear",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 1,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 1 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.loopCounter).toBe(1);
      expect(result.state.isComplete).toBe(true);
    });

    test("workflow with clearContextNode completes even when until is immediately true", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Zero iterations",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 0, // Immediately true after first iteration
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 0 }),
      });

      // Loop runs at least once before checking the until condition
      expect(result.status).toBe("completed");
      expect(result.state.loopCounter).toBe(1); // Loop runs once before checking
      expect(result.state.isComplete).toBe(true);
    });

    test("workflow execution status is completed, not failed or cancelled", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 2,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 2 }),
      });

      expect(result.status).toBe("completed");
      expect(result.status).not.toBe("failed");
      expect(result.status).not.toBe("cancelled");
    });
  });

  describe("ClearContextNode with complex workflows", () => {
    test("clearContextNode works with multiple nodes in loop body", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop(
          [
            clearNode,
            createTrackingNode("process-a", { stepA: true }),
            createTrackingNode("process-b", { stepB: true }),
            createLoopBodyNode("increment"),
          ],
          {
            until: (state) => state.loopCounter >= 2,
            maxIterations: 10,
          }
        )
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 2 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.loopCounter).toBe(2);
      expect(result.state.data.stepA).toBe(true);
      expect(result.state.data.stepB).toBe(true);
    });

    test("clearContextNode with conditional branching inside loop", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const checkConditionNode = createNode<ClearContextTestState>(
        "check",
        "tool",
        async (ctx) => ({
          stateUpdate: {
            nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
            executedNodes: [...ctx.state.executedNodes, "check"],
            loopCounter: ctx.state.loopCounter + 1,
            data: {
              ...ctx.state.data,
              lastIteration: ctx.state.loopCounter,
            },
          },
        })
      );

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, checkConditionNode], {
          until: (state) => state.loopCounter >= 3,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 3 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.data.lastIteration).toBe(2); // 0-indexed, last iteration was 2
    });

    test("nested workflows with clearContextNode", async () => {
      const clearNode1 = clearContextNode<ClearContextTestState>({
        id: "outer-clear",
        message: "Outer loop clear",
      });

      // Simple sequential workflow with pre and post processing
      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("pre-process"))
        .then(clearNode1)
        .then(createLoopBodyNode("main-work"))
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      expect(result.state.executedNodes).toContain("pre-process");
      expect(result.state.executedNodes).toContain("main-work");
      expect(result.state.executedNodes).toContain("complete");
    });
  });

  describe("ClearContextNode edge cases", () => {
    test("clearContextNode with undefined message uses default", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const clearStep = steps.find((s) => s.nodeId === "clear-context");
      const contextSignal = clearStep!.result.signals!.find(
        (s) => s.type === "context_window_warning"
      );

      expect(contextSignal!.message).toBe("Clearing context window");
    });

    test("clearContextNode does not modify state directly", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Test",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createImportantDataNode("set-data", "test value"))
        .then(clearNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ importantData: "initial" }),
      });

      // clearContextNode should not have modified importantData
      // Only set-data should have changed it
      expect(result.state.importantData).toBe("test value");
    });

    test("multiple clearContextNodes in sequence", async () => {
      const clearNode1 = clearContextNode<ClearContextTestState>({
        id: "clear-1",
        message: "First clear",
      });

      const clearNode2 = clearContextNode<ClearContextTestState>({
        id: "clear-2",
        message: "Second clear",
      });

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .then(clearNode1)
        .then(clearNode2)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<ClearContextTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const clearSteps = steps.filter(
        (s) => s.nodeId === "clear-1" || s.nodeId === "clear-2"
      );

      expect(clearSteps.length).toBe(2);

      // Both should emit signals
      for (const step of clearSteps) {
        expect(step.result.signals).toBeDefined();
        const signal = step.result.signals!.find(
          (s) => s.type === "context_window_warning"
        );
        expect(signal).toBeDefined();
      }
    });

    test("abort signal cancels workflow at clearContextNode", async () => {
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: "Clearing context",
      });

      const abortController = new AbortController();

      // Abort immediately before execution starts
      abortController.abort();

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, createLoopBodyNode("loop-body")], {
          until: (state) => state.loopCounter >= 100,
          maxIterations: 100,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 100 }),
        abortSignal: abortController.signal,
      });

      // Should be cancelled, not completed
      expect(result.status).toBe("cancelled");
    });
  });

  describe("Integration with Ralph workflow patterns", () => {
    test("clearContextNode placement at loop start matches Ralph workflow", async () => {
      // This test verifies the pattern used in Ralph workflow:
      // init -> loop(clear, implement) -> check -> pr
      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: (state) => `Starting iteration ${state.loopCounter + 1}`,
      });

      const implementNode = createNode<ClearContextTestState>(
        "implement",
        "tool",
        async (ctx) => ({
          stateUpdate: {
            nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
            executedNodes: [...ctx.state.executedNodes, "implement"],
            loopCounter: ctx.state.loopCounter + 1,
            data: {
              ...ctx.state.data,
              [`feature_${ctx.state.loopCounter}`]: "implemented",
            },
          },
        })
      );

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("init-session"))
        .loop([clearNode, implementNode], {
          until: (state) => state.loopCounter >= 3,
          maxIterations: 100,
        })
        .then(createTrackingNode("check-completion"))
        .then(createCompletionNode("create-pr"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 3 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.loopCounter).toBe(3);
      expect(result.state.data).toMatchObject({
        feature_0: "implemented",
        feature_1: "implemented",
        feature_2: "implemented",
      });
      expect(result.state.isComplete).toBe(true);
    });

    test("context clears prevent context window overflow pattern", async () => {
      // Simulate a workflow that would accumulate context over iterations
      // The clearContextNode prevents this by clearing at each iteration start

      const clearNode = clearContextNode<ClearContextTestState>({
        id: "clear-context",
        message: (state) => `Clear before iteration ${state.loopCounter + 1}`,
      });

      // Simulate a node that would add to context
      const heavyContextNode = createNode<ClearContextTestState>(
        "heavy-context",
        "tool",
        async (ctx) => {
          // In a real scenario, this would interact with an LLM
          // and accumulate context tokens
          return {
            stateUpdate: {
              nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
              executedNodes: [...ctx.state.executedNodes, "heavy-context"],
              loopCounter: ctx.state.loopCounter + 1,
              data: {
                ...ctx.state.data,
                totalIterations: ctx.state.loopCounter + 1,
              },
            },
          };
        }
      );

      const workflow = graph<ClearContextTestState>()
        .start(createTrackingNode("start"))
        .loop([clearNode, heavyContextNode], {
          until: (state) => state.loopCounter >= 5,
          maxIterations: 10,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 5 }),
      });

      // Verify workflow completed successfully
      expect(result.status).toBe("completed");
      expect(result.state.loopCounter).toBe(5);
      expect(result.state.isComplete).toBe(true);

      // Verify all iterations completed with accumulated data
      expect(result.state.data.totalIterations).toBe(5);

      // Verify heavy-context ran 5 times
      const heavyContextExecutions = result.state.executedNodes.filter(
        (n) => n === "heavy-context"
      );
      expect(heavyContextExecutions.length).toBe(5);
    });
  });
});
