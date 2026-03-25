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

// ---------------------------------------------------------------------------
// addParallelSegment
// ---------------------------------------------------------------------------

describe("addParallelSegment", () => {
  test("sets parallel node as start when no current node exists", () => {
    const { ops, nodes, edges } = createMockOps();
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
    const { ops, nodes, edges } = createMockOps();
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
    const mockCtx = {
      state: {
        executionId: "exec-1",
        lastUpdated: new Date().toISOString(),
        outputs: {},
        count: 0,
        done: false,
      } as TestState,
      config: {} as Parameters<typeof parallelNode.execute>[0]["config"],
      errors: [],
    };

    const result = await parallelNode.execute(mockCtx);
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
    const mockCtx = {
      state: {
        executionId: "exec-1",
        lastUpdated: new Date().toISOString(),
        outputs: {},
        count: 0,
        done: false,
      } as TestState,
      config: {} as Parameters<typeof parallelNode.execute>[0]["config"],
      errors: [],
    };

    const result = await parallelNode.execute(mockCtx);
    const outputs = (result.stateUpdate as Partial<TestState>).outputs;
    expect(outputs!["parallel_0"]).toEqual({
      branches: ["b1"],
      strategy: "race",
    });
  });

  test("updates currentNodeId to the parallel node", () => {
    const { ops } = createMockOps();
    const state = createState({ currentNodeId: "prev" });

    addParallelSegment(state, ops, { branches: ["x"] });

    expect(state.currentNodeId).toBe("parallel_0");
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

    const doneState = {
      executionId: "",
      lastUpdated: "",
      outputs: {},
      count: 0,
      done: true,
    } as TestState;

    const notDoneState = {
      executionId: "",
      lastUpdated: "",
      outputs: {},
      count: 0,
      done: false,
    } as TestState;

    // When until is true (done), continue condition should be false (stop looping)
    expect(continueEdge!.condition!(doneState)).toBe(false);
    // When until is false (not done), continue condition should be true (keep looping)
    expect(continueEdge!.condition!(notDoneState)).toBe(true);
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
    const shouldExit = {
      executionId: "",
      lastUpdated: "",
      outputs: {},
      count: 10,
      done: false,
    } as TestState;
    const shouldContinue = {
      executionId: "",
      lastUpdated: "",
      outputs: {},
      count: 2,
      done: false,
    } as TestState;

    expect(state.pendingEdgeCondition!(shouldExit)).toBe(true);
    expect(state.pendingEdgeCondition!(shouldContinue)).toBe(false);
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
});
