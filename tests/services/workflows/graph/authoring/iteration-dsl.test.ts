import { describe, expect, test } from "bun:test";
import {
  addParallelSegment,
  addLoopSegment,
} from "@/services/workflows/graph/authoring/iteration-dsl.ts";
import type {
  AuthoringGraphOps,
  IterationDslState,
} from "@/services/workflows/graph/authoring/types.ts";
import type {
  BaseState,
  NodeDefinition,
  NodeId,
} from "@/services/workflows/graph/types.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestState extends BaseState {
  count: number;
  done: boolean;
}

interface RecordedEdge {
  from: string;
  to: string;
  condition?: (state: TestState) => boolean;
  label?: string;
}

function createMockOps() {
  let nodeIdCounter = 0;
  const nodes: NodeDefinition<TestState>[] = [];
  const edges: RecordedEdge[] = [];
  const ops: AuthoringGraphOps<TestState> = {
    generateNodeId: (prefix: string): NodeId =>
      `${prefix}_${nodeIdCounter++}`,
    addNode: (node: NodeDefinition<TestState>) => {
      nodes.push(node);
    },
    addEdge: (
      from: string,
      to: string,
      condition?: (state: TestState) => boolean,
      label?: string,
    ) => {
      edges.push({ from, to, condition, label });
    },
  };
  return { ops, nodes, edges };
}

function createState(
  overrides: Partial<IterationDslState<TestState>> = {},
): IterationDslState<TestState> {
  return {
    currentNodeId: null,
    startNodeId: null,
    ...overrides,
  };
}

function makeBodyNode(id: string): NodeDefinition<TestState> {
  return {
    id,
    type: "tool",
    execute: async () => ({}),
  };
}

function makeTestState(overrides: Partial<TestState> = {}): TestState {
  return {
    executionId: "exec-test",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    count: 0,
    done: false,
    ...overrides,
  };
}

function makeMockCtx(stateOverrides: Partial<TestState> = {}) {
  const state = makeTestState(stateOverrides);
  return {
    state,
    config: {} as Record<string, unknown>,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// addParallelSegment
// ---------------------------------------------------------------------------

describe("addParallelSegment", () => {
  test("sets parallel node as start when no current node exists", () => {
    const { ops, edges, nodes } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, {
      branches: ["branchA", "branchB"],
    });

    // The parallel node should be the start node
    expect(state.startNodeId).toBe("parallel_0");
    // And also the current node
    expect(state.currentNodeId).toBe("parallel_0");
    // One node added (the parallel node itself)
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe("parallel_0");
    expect(nodes[0]!.type).toBe("parallel");
    // No edge from a previous node, only branch edges
    const incomingEdges = edges.filter((e) => e.to === "parallel_0");
    expect(incomingEdges).toHaveLength(0);
  });

  test("links from current node when one already exists", () => {
    const { ops, edges } = createMockOps();
    const state = createState({ currentNodeId: "existingNode" });

    addParallelSegment(state, ops, {
      branches: ["branchA"],
    });

    // Edge from the existing node to the parallel node
    const linkEdge = edges.find(
      (e) => e.from === "existingNode" && e.to === "parallel_0",
    );
    expect(linkEdge).toBeDefined();
    expect(linkEdge!.condition).toBeUndefined();
    expect(linkEdge!.label).toBeUndefined();

    // startNodeId should NOT be changed (it was already set implicitly by the existing chain)
    expect(state.startNodeId).toBeNull();
  });

  test("does not set startNodeId when currentNodeId is null but startNodeId is already set", () => {
    const { ops } = createMockOps();
    const state = createState({
      currentNodeId: null,
      startNodeId: "alreadySet",
    });

    addParallelSegment(state, ops, { branches: ["b1"] });

    // startNodeId must remain unchanged
    expect(state.startNodeId).toBe("alreadySet");
  });

  test("creates edges to all branches with parallel- labels", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, {
      branches: ["alpha", "beta", "gamma"],
    });

    const branchEdges = edges.filter((e) => e.from === "parallel_0");
    expect(branchEdges).toHaveLength(3);

    expect(branchEdges[0]).toMatchObject({
      from: "parallel_0",
      to: "alpha",
      label: "parallel-alpha",
    });
    expect(branchEdges[1]).toMatchObject({
      from: "parallel_0",
      to: "beta",
      label: "parallel-beta",
    });
    expect(branchEdges[2]).toMatchObject({
      from: "parallel_0",
      to: "gamma",
      label: "parallel-gamma",
    });

    // Branch edges should not carry conditions
    for (const edge of branchEdges) {
      expect(edge.condition).toBeUndefined();
    }
  });

  test("defaults strategy to 'all' in the created node", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, {
      branches: ["b1", "b2"],
      // strategy intentionally omitted — should default to "all"
    });

    // Execute the node to inspect the stateUpdate
    const parallelNode = nodes[0]!;
    const result = await parallelNode.execute(makeMockCtx());
    expect(result.stateUpdate).toBeDefined();
    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs).toBeDefined();
    expect(outputs!["parallel_0"]).toEqual({
      branches: ["b1", "b2"],
      strategy: "all",
    });
  });

  test("respects explicit strategy in the created node", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, {
      branches: ["b1"],
      strategy: "race",
    });

    const parallelNode = nodes[0]!;
    const result = await parallelNode.execute(makeMockCtx());
    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs!["parallel_0"]).toEqual({
      branches: ["b1"],
      strategy: "race",
    });
  });

  test("respects 'any' strategy in the created node", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, {
      branches: ["b1", "b2"],
      strategy: "any",
    });

    const parallelNode = nodes[0]!;
    const result = await parallelNode.execute(makeMockCtx());
    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs!["parallel_0"]).toEqual({
      branches: ["b1", "b2"],
      strategy: "any",
    });
  });

  test("updates currentNodeId to the parallel node", () => {
    const { ops } = createMockOps();
    const state = createState({ currentNodeId: "prev" });

    addParallelSegment(state, ops, { branches: ["x"] });

    expect(state.currentNodeId).toBe("parallel_0");
  });

  test("works with a single branch", () => {
    const { ops, nodes, edges } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, { branches: ["only"] });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe("parallel_0");

    const branchEdges = edges.filter((e) => e.from === "parallel_0");
    expect(branchEdges).toHaveLength(1);
    expect(branchEdges[0]).toMatchObject({
      to: "only",
      label: "parallel-only",
    });
  });

  test("parallel node execution preserves existing outputs in state", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, {
      branches: ["b1"],
    });

    const parallelNode = nodes[0]!;
    const existingOutputs = { someOtherNode: { result: 42 } };
    const result = await parallelNode.execute(
      makeMockCtx({ outputs: existingOutputs } as Partial<TestState>),
    );

    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    // Should preserve existing outputs
    expect(outputs!["someOtherNode"]).toEqual({ result: 42 });
    // And add the parallel node's output
    expect(outputs!["parallel_0"]).toEqual({
      branches: ["b1"],
      strategy: "all",
    });
  });

  test("produces correct total edge count with currentNodeId set", () => {
    const { ops, edges } = createMockOps();
    const state = createState({ currentNodeId: "prev" });

    addParallelSegment(state, ops, {
      branches: ["a", "b", "c"],
    });

    // 1 edge from prev -> parallel + 3 branch edges
    expect(edges).toHaveLength(4);
  });

  test("produces correct total edge count without currentNodeId", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, {
      branches: ["a", "b"],
    });

    // Only 2 branch edges (no incoming edge since no currentNodeId)
    expect(edges).toHaveLength(2);
  });

  test("does not modify pendingEdgeCondition or pendingEdgeLabel", () => {
    const { ops } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, { branches: ["b1"] });

    expect(state.pendingEdgeCondition).toBeUndefined();
    expect(state.pendingEdgeLabel).toBeUndefined();
  });

  test("does not modify pre-existing pendingEdgeCondition or pendingEdgeLabel", () => {
    const existingCondition = (s: TestState) => s.done;
    const { ops } = createMockOps();
    const state = createState({
      currentNodeId: "prev",
      pendingEdgeCondition: existingCondition,
      pendingEdgeLabel: "some-label",
    });

    addParallelSegment(state, ops, { branches: ["b1"] });

    // addParallelSegment does not touch pending edge state
    expect(state.pendingEdgeCondition).toBe(existingCondition);
    expect(state.pendingEdgeLabel).toBe("some-label");
  });

  test("consecutive calls produce unique parallel node IDs", () => {
    const { ops, nodes } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, { branches: ["a"] });
    addParallelSegment(state, ops, { branches: ["b"] });

    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.id).toBe("parallel_0");
    expect(nodes[1]!.id).toBe("parallel_1");
  });

  test("consecutive calls chain parallel nodes together", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addParallelSegment(state, ops, { branches: ["a"] });
    // After first call, currentNodeId = parallel_0
    addParallelSegment(state, ops, { branches: ["b"] });

    // Should have edge from parallel_0 -> parallel_1
    const chainEdge = edges.find(
      (e) => e.from === "parallel_0" && e.to === "parallel_1",
    );
    expect(chainEdge).toBeDefined();
    expect(state.currentNodeId).toBe("parallel_1");
  });
});

// ---------------------------------------------------------------------------
// addLoopSegment
// ---------------------------------------------------------------------------

describe("addLoopSegment", () => {
  test("throws when bodyNodes is an empty array", () => {
    const { ops } = createMockOps();
    const state = createState();

    expect(() => {
      addLoopSegment(state, ops, [], { until: () => true });
    }).toThrow("Loop body must contain at least one node");
  });

  test("throws with exact error message for empty body", () => {
    const { ops } = createMockOps();
    const state = createState();

    expect(() => {
      addLoopSegment(state, ops, [], { until: () => true });
    }).toThrow("Loop body must contain at least one node");
  });

  test("wires a single body node correctly", () => {
    const { ops, nodes, edges } = createMockOps();
    const state = createState();
    const body = makeBodyNode("bodyA");

    addLoopSegment(state, ops, body, { until: (s) => s.done });

    // Nodes added: loopStart, bodyA, loopCheck
    expect(nodes).toHaveLength(3);
    expect(nodes[0]!.id).toBe("loop_start_0");
    expect(nodes[0]!.type).toBe("decision");
    expect(nodes[1]!.id).toBe("bodyA");
    expect(nodes[2]!.id).toBe("loop_check_1");
    expect(nodes[2]!.type).toBe("decision");

    // loopStart set as startNodeId (since no current node)
    expect(state.startNodeId).toBe("loop_start_0");

    // Edges:
    // 1. loopStart -> bodyA
    const startToBody = edges.find(
      (e) => e.from === "loop_start_0" && e.to === "bodyA",
    );
    expect(startToBody).toBeDefined();

    // 2. bodyA -> loopCheck
    const bodyToCheck = edges.find(
      (e) => e.from === "bodyA" && e.to === "loop_check_1",
    );
    expect(bodyToCheck).toBeDefined();

    // 3. loopCheck -> bodyA (loop-continue, with inverted condition)
    const continueEdge = edges.find(
      (e) =>
        e.from === "loop_check_1" &&
        e.to === "bodyA" &&
        e.label === "loop-continue",
    );
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.condition).toBeInstanceOf(Function);
  });

  test("single body node produces exactly 3 edges", () => {
    const { ops, edges } = createMockOps();
    const state = createState();
    const body = makeBodyNode("bodyA");

    addLoopSegment(state, ops, body, { until: () => true });

    // loopStart->bodyA, bodyA->loopCheck, loopCheck->bodyA (continue)
    expect(edges).toHaveLength(3);
  });

  test("chains multiple body nodes in order", () => {
    const { ops, nodes, edges } = createMockOps();
    const state = createState();
    const bodyA = makeBodyNode("bodyA");
    const bodyB = makeBodyNode("bodyB");
    const bodyC = makeBodyNode("bodyC");

    addLoopSegment(state, ops, [bodyA, bodyB, bodyC], {
      until: (s) => s.done,
    });

    // Nodes: loopStart, bodyA, bodyB, bodyC, loopCheck
    expect(nodes).toHaveLength(5);

    // Body chain edges: bodyA -> bodyB, bodyB -> bodyC
    const chainAB = edges.find(
      (e) => e.from === "bodyA" && e.to === "bodyB",
    );
    expect(chainAB).toBeDefined();

    const chainBC = edges.find(
      (e) => e.from === "bodyB" && e.to === "bodyC",
    );
    expect(chainBC).toBeDefined();

    // loopStart -> first body
    const startEdge = edges.find(
      (e) => e.from === "loop_start_0" && e.to === "bodyA",
    );
    expect(startEdge).toBeDefined();

    // last body -> loopCheck
    const lastToCheck = edges.find(
      (e) => e.from === "bodyC" && e.to === "loop_check_1",
    );
    expect(lastToCheck).toBeDefined();

    // loop-continue: loopCheck -> first body
    const continueEdge = edges.find(
      (e) =>
        e.from === "loop_check_1" &&
        e.to === "bodyA" &&
        e.label === "loop-continue",
    );
    expect(continueEdge).toBeDefined();
  });

  test("three body nodes produce exactly 5 edges", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addLoopSegment(
      state,
      ops,
      [makeBodyNode("a"), makeBodyNode("b"), makeBodyNode("c")],
      { until: () => true },
    );

    // loopStart->a, a->b, b->c, c->loopCheck, loopCheck->a (continue)
    expect(edges).toHaveLength(5);
  });

  test("two body nodes produce exactly 4 edges", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addLoopSegment(
      state,
      ops,
      [makeBodyNode("a"), makeBodyNode("b")],
      { until: () => true },
    );

    // loopStart->a, a->b, b->loopCheck, loopCheck->a (continue)
    expect(edges).toHaveLength(4);
  });

  test("body chain edges have no conditions or labels", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addLoopSegment(
      state,
      ops,
      [makeBodyNode("a"), makeBodyNode("b"), makeBodyNode("c")],
      { until: () => true },
    );

    // Chain edges: a->b, b->c
    const chainAB = edges.find((e) => e.from === "a" && e.to === "b");
    const chainBC = edges.find((e) => e.from === "b" && e.to === "c");

    expect(chainAB!.condition).toBeUndefined();
    expect(chainAB!.label).toBeUndefined();
    expect(chainBC!.condition).toBeUndefined();
    expect(chainBC!.label).toBeUndefined();
  });

  test("loopStart to first body edge has no condition or label", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addLoopSegment(state, ops, makeBodyNode("b"), { until: () => true });

    const startToBody = edges.find(
      (e) => e.from === "loop_start_0" && e.to === "b",
    );
    expect(startToBody!.condition).toBeUndefined();
    expect(startToBody!.label).toBeUndefined();
  });

  test("last body to loopCheck edge has no condition or label", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addLoopSegment(state, ops, makeBodyNode("b"), { until: () => true });

    const bodyToCheck = edges.find(
      (e) => e.from === "b" && e.to === "loop_check_1",
    );
    expect(bodyToCheck!.condition).toBeUndefined();
    expect(bodyToCheck!.label).toBeUndefined();
  });

  test("loop-continue edge inverts the until condition", () => {
    const { ops, edges } = createMockOps();
    const state = createState();
    const body = makeBodyNode("b");

    // until returns true when done=true (meaning "stop when done")
    const untilFn = (s: TestState) => s.done;

    addLoopSegment(state, ops, body, { until: untilFn });

    const continueEdge = edges.find((e) => e.label === "loop-continue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.condition).toBeDefined();

    const doneState = makeTestState({ done: true });
    const notDoneState = makeTestState({ done: false });

    // When until is true (done), continue condition should be false (stop looping)
    expect(continueEdge!.condition!(doneState)).toBe(false);
    // When until is false (not done), continue condition should be true (keep looping)
    expect(continueEdge!.condition!(notDoneState)).toBe(true);
  });

  test("loop-continue edge inverts a count-based until condition", () => {
    const { ops, edges } = createMockOps();
    const state = createState();
    const body = makeBodyNode("b");

    addLoopSegment(state, ops, body, {
      until: (s) => s.count >= 3,
    });

    const continueEdge = edges.find((e) => e.label === "loop-continue");

    // count=2 -> until returns false -> continue should be true
    expect(continueEdge!.condition!(makeTestState({ count: 2 }))).toBe(true);
    // count=3 -> until returns true -> continue should be false
    expect(continueEdge!.condition!(makeTestState({ count: 3 }))).toBe(false);
    // count=5 -> until returns true -> continue should be false
    expect(continueEdge!.condition!(makeTestState({ count: 5 }))).toBe(false);
  });

  test("sets pendingEdgeCondition and pendingEdgeLabel for loop exit", () => {
    const { ops } = createMockOps();
    const state = createState();
    const body = makeBodyNode("b");

    const untilFn = (s: TestState) => s.count > 5;

    addLoopSegment(state, ops, body, { until: untilFn });

    expect(state.pendingEdgeCondition).toBeInstanceOf(Function);
    expect(state.pendingEdgeLabel).toBe("loop-exit");

    // The pending condition should match the until condition (exit when until is true)
    const shouldExit = makeTestState({ count: 10 });
    const shouldContinue = makeTestState({ count: 2 });

    expect(state.pendingEdgeCondition!(shouldExit)).toBe(true);
    expect(state.pendingEdgeCondition!(shouldContinue)).toBe(false);
  });

  test("pending exit condition mirrors until function exactly", () => {
    const { ops } = createMockOps();
    const state = createState();
    const body = makeBodyNode("b");

    const untilFn = (s: TestState) => s.done && s.count > 0;
    addLoopSegment(state, ops, body, { until: untilFn });

    // Both conditions must be true for exit
    expect(state.pendingEdgeCondition!(makeTestState({ done: true, count: 1 }))).toBe(true);
    // done=true but count=0 -> until is false -> should not exit
    expect(state.pendingEdgeCondition!(makeTestState({ done: true, count: 0 }))).toBe(false);
    // done=false but count=1 -> until is false -> should not exit
    expect(state.pendingEdgeCondition!(makeTestState({ done: false, count: 1 }))).toBe(false);
  });

  test("sets currentNodeId to the loopCheck node", () => {
    const { ops } = createMockOps();
    const state = createState();
    const body = makeBodyNode("b");

    addLoopSegment(state, ops, body, { until: () => true });

    expect(state.currentNodeId).toBe("loop_check_1");
  });

  test("sets loopStart as start when no current node exists", () => {
    const { ops } = createMockOps();
    const state = createState();
    const body = makeBodyNode("b");

    addLoopSegment(state, ops, body, { until: () => true });

    expect(state.startNodeId).toBe("loop_start_0");
  });

  test("links from current node when one already exists", () => {
    const { ops, edges } = createMockOps();
    const state = createState({ currentNodeId: "prevNode" });
    const body = makeBodyNode("b");

    addLoopSegment(state, ops, body, { until: () => true });

    const linkEdge = edges.find(
      (e) => e.from === "prevNode" && e.to === "loop_start_0",
    );
    expect(linkEdge).toBeDefined();
    // startNodeId should not be changed
    expect(state.startNodeId).toBeNull();
  });

  test("edge from currentNodeId to loopStart has no condition or label", () => {
    const { ops, edges } = createMockOps();
    const state = createState({ currentNodeId: "prevNode" });
    const body = makeBodyNode("b");

    addLoopSegment(state, ops, body, { until: () => true });

    const linkEdge = edges.find(
      (e) => e.from === "prevNode" && e.to === "loop_start_0",
    );
    expect(linkEdge!.condition).toBeUndefined();
    expect(linkEdge!.label).toBeUndefined();
  });

  test("with currentNodeId set, produces one extra edge", () => {
    const { ops: ops1, edges: edges1 } = createMockOps();
    const state1 = createState();
    addLoopSegment(state1, ops1, makeBodyNode("b"), { until: () => true });

    const { ops: ops2, edges: edges2 } = createMockOps();
    const state2 = createState({ currentNodeId: "prev" });
    addLoopSegment(state2, ops2, makeBodyNode("b"), { until: () => true });

    // One extra edge from prev -> loop_start
    expect(edges2).toHaveLength(edges1.length + 1);
  });

  test("does not set startNodeId when currentNodeId is null but startNodeId is already set", () => {
    const { ops } = createMockOps();
    const state = createState({
      currentNodeId: null,
      startNodeId: "alreadySet",
    });
    const body = makeBodyNode("b");

    addLoopSegment(state, ops, body, { until: () => true });

    expect(state.startNodeId).toBe("alreadySet");
  });

  test("single-element array body is treated the same as a single node", () => {
    const { ops: ops1, nodes: nodes1, edges: edges1 } = createMockOps();
    const state1 = createState();
    const body1 = makeBodyNode("b");

    addLoopSegment(state1, ops1, body1, { until: () => true });

    const { ops: ops2, nodes: nodes2, edges: edges2 } = createMockOps();
    const state2 = createState();
    const body2 = makeBodyNode("b");

    addLoopSegment(state2, ops2, [body2], { until: () => true });

    // Same number of nodes and edges
    expect(nodes1).toHaveLength(nodes2.length);
    expect(edges1).toHaveLength(edges2.length);

    // Same node IDs
    expect(nodes1.map((n) => n.id)).toEqual(nodes2.map((n) => n.id));

    // Same edge structure (ignoring condition functions)
    expect(edges1.map((e) => ({ from: e.from, to: e.to, label: e.label }))).toEqual(
      edges2.map((e) => ({ from: e.from, to: e.to, label: e.label })),
    );
  });

  test("loopStart node execution initializes iteration counter in outputs", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();
    addLoopSegment(state, ops, makeBodyNode("b"), { until: () => true });

    const loopStartNode = nodes[0]!;
    expect(loopStartNode.id).toBe("loop_start_0");

    const result = await loopStartNode.execute(makeMockCtx());
    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs).toBeDefined();
    // Iteration key uses loop_start_0_iteration
    expect(outputs!["loop_start_0_iteration"]).toBe(0);
  });

  test("loopStart node execution preserves existing outputs", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();
    addLoopSegment(state, ops, makeBodyNode("b"), { until: () => true });

    const loopStartNode = nodes[0]!;
    const result = await loopStartNode.execute(
      makeMockCtx({ outputs: { existingKey: "keep" } } as Partial<TestState>),
    );

    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs!["existingKey"]).toBe("keep");
    expect(outputs!["loop_start_0_iteration"]).toBe(0);
  });

  test("loopCheck node execution increments iteration counter", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();
    addLoopSegment(state, ops, makeBodyNode("b"), { until: () => true });

    const loopCheckNode = nodes[2]!;
    expect(loopCheckNode.id).toBe("loop_check_1");

    // Simulate iteration 0 already set
    const result = await loopCheckNode.execute(
      makeMockCtx({
        outputs: { loop_start_0_iteration: 0 },
      } as Partial<TestState>),
    );

    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs!["loop_start_0_iteration"]).toBe(1);
  });

  test("loopCheck node increments from higher iteration value", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();
    addLoopSegment(state, ops, makeBodyNode("b"), { until: () => true });

    const loopCheckNode = nodes[2]!;

    const result = await loopCheckNode.execute(
      makeMockCtx({
        outputs: { loop_start_0_iteration: 5 },
      } as Partial<TestState>),
    );

    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs!["loop_start_0_iteration"]).toBe(6);
  });

  test("loopCheck node defaults to 0 when iteration key is missing", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();
    addLoopSegment(state, ops, makeBodyNode("b"), { until: () => true });

    const loopCheckNode = nodes[2]!;

    // No iteration key set yet
    const result = await loopCheckNode.execute(makeMockCtx());

    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    // (0 ?? 0) + 1 = 1
    expect(outputs!["loop_start_0_iteration"]).toBe(1);
  });

  test("loopCheck node preserves existing outputs alongside iteration counter", async () => {
    const { ops, nodes } = createMockOps();
    const state = createState();
    addLoopSegment(state, ops, makeBodyNode("b"), { until: () => true });

    const loopCheckNode = nodes[2]!;
    const result = await loopCheckNode.execute(
      makeMockCtx({
        outputs: {
          loop_start_0_iteration: 2,
          otherData: "preserved",
        },
      } as Partial<TestState>),
    );

    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs!["loop_start_0_iteration"]).toBe(3);
    expect(outputs!["otherData"]).toBe("preserved");
  });

  test("overwrites any pre-existing pendingEdgeCondition and pendingEdgeLabel", () => {
    const { ops } = createMockOps();
    const oldCondition = (_s: TestState) => false;
    const state = createState({
      currentNodeId: "prev",
      pendingEdgeCondition: oldCondition,
      pendingEdgeLabel: "old-label",
    });

    addLoopSegment(state, ops, makeBodyNode("b"), {
      until: (s) => s.done,
    });

    // Should be overwritten with loop-exit condition/label
    expect(state.pendingEdgeCondition).not.toBe(oldCondition);
    expect(state.pendingEdgeLabel).toBe("loop-exit");
  });

  test("body nodes are added to graph in order between loop_start and loop_check", () => {
    const { ops, nodes } = createMockOps();
    const state = createState();

    addLoopSegment(
      state,
      ops,
      [makeBodyNode("first"), makeBodyNode("second"), makeBodyNode("third")],
      { until: () => true },
    );

    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds).toEqual([
      "loop_start_0",
      "first",
      "second",
      "third",
      "loop_check_1",
    ]);
  });

  test("loop-continue edge always targets the first body node in multi-body loops", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addLoopSegment(
      state,
      ops,
      [makeBodyNode("first"), makeBodyNode("second")],
      { until: () => true },
    );

    const continueEdge = edges.find((e) => e.label === "loop-continue");
    expect(continueEdge!.from).toBe("loop_check_1");
    expect(continueEdge!.to).toBe("first");
  });

  test("last body node connects to loop_check in multi-body loops", () => {
    const { ops, edges } = createMockOps();
    const state = createState();

    addLoopSegment(
      state,
      ops,
      [makeBodyNode("first"), makeBodyNode("last")],
      { until: () => true },
    );

    const lastToCheck = edges.find(
      (e) => e.from === "last" && e.to === "loop_check_1",
    );
    expect(lastToCheck).toBeDefined();
  });
});
