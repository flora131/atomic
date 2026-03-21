/**
 * Tests for the Z3 Workflow Verifier orchestrator.
 *
 * Mocks all 5 property checkers and encodeGraph to test the orchestration
 * logic in isolation: parallel execution, aggregate result computation,
 * and optional pre-encoded graph passthrough.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import type {
  EncodedGraph,
  PropertyResult,
  VerificationResult,
} from "@/services/workflows/verification/types";
import type {
  BaseState,
  CompiledGraph,
} from "@/services/workflows/graph/types";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockEncodeGraph = mock<(graph: CompiledGraph<BaseState>) => EncodedGraph>(
  () => ({
    nodes: [
      { id: "start", type: "agent" },
      { id: "end", type: "agent" },
    ],
    edges: [{ from: "start", to: "end", hasCondition: false }],
    startNode: "start",
    endNodes: ["end"],
    loops: [],
    stateFields: [],
  }),
);

const PASS: PropertyResult = { verified: true };
const FAIL_REACHABILITY: PropertyResult = {
  verified: false,
  counterexample: 'Node(s) "orphan" unreachable from start node "start"',
  details: { unreachableNodes: ["orphan"] },
};
const FAIL_TERMINATION: PropertyResult = {
  verified: false,
  counterexample: "Not all paths reach an end node",
  details: { deadEndNodes: [] },
};
const FAIL_DEADLOCK: PropertyResult = {
  verified: false,
  counterexample:
    'Node(s) "stuck" may deadlock — all outgoing edges have conditions that are not exhaustive',
  details: { deadlockedNodes: ["stuck"] },
};
const FAIL_LOOP_BOUNDS: PropertyResult = {
  verified: false,
  counterexample: 'Unbounded loops detected: loop at "loopEntry" (maxIterations=10)',
  details: { unboundedLoops: [{ entryNode: "loopEntry", maxIterations: 10 }] },
};
const FAIL_DATA_FLOW: PropertyResult = {
  verified: false,
  counterexample:
    'node "reader" reads "data" which may not be written on all paths',
  details: { violations: [{ nodeId: "reader", field: "data" }] },
};

const mockCheckReachability = mock<(g: EncodedGraph) => Promise<PropertyResult>>(
  async () => PASS,
);
const mockCheckTermination = mock<(g: EncodedGraph) => Promise<PropertyResult>>(
  async () => PASS,
);
const mockCheckDeadlockFreedom = mock<
  (g: EncodedGraph) => Promise<PropertyResult>
>(async () => PASS);
const mockCheckLoopBounds = mock<(g: EncodedGraph) => Promise<PropertyResult>>(
  async () => PASS,
);
const mockCheckStateDataFlow = mock<
  (g: EncodedGraph) => Promise<PropertyResult>
>(async () => PASS);

mock.module("@/services/workflows/verification/graph-encoder", () => ({
  encodeGraph: mockEncodeGraph,
}));
mock.module("@/services/workflows/verification/reachability", () => ({
  checkReachability: mockCheckReachability,
}));
mock.module("@/services/workflows/verification/termination", () => ({
  checkTermination: mockCheckTermination,
}));
mock.module("@/services/workflows/verification/deadlock-freedom", () => ({
  checkDeadlockFreedom: mockCheckDeadlockFreedom,
}));
mock.module("@/services/workflows/verification/loop-bounds", () => ({
  checkLoopBounds: mockCheckLoopBounds,
}));
mock.module("@/services/workflows/verification/state-data-flow", () => ({
  checkStateDataFlow: mockCheckStateDataFlow,
}));

// Must import AFTER mock.module
const { verifyWorkflow } = await import(
  "@/services/workflows/verification/verifier"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDummyGraph(): CompiledGraph<BaseState> {
  return {
    nodes: new Map([
      [
        "start",
        {
          id: "start",
          type: "agent" as const,
          execute: async () => ({}),
        },
      ],
      [
        "end",
        {
          id: "end",
          type: "agent" as const,
          execute: async () => ({}),
        },
      ],
    ]),
    edges: [{ from: "start", to: "end" }],
    startNode: "start",
    endNodes: new Set(["end"]),
    config: {},
  } as unknown as CompiledGraph<BaseState>;
}

function makeEncodedGraph(
  overrides?: Partial<EncodedGraph>,
): EncodedGraph {
  return {
    nodes: [
      { id: "start", type: "agent" },
      { id: "end", type: "agent" },
    ],
    edges: [{ from: "start", to: "end", hasCondition: false }],
    startNode: "start",
    endNodes: ["end"],
    loops: [],
    stateFields: [],
    ...overrides,
  };
}

function resetAllMocks(): void {
  mockEncodeGraph.mockClear();
  mockCheckReachability.mockClear();
  mockCheckTermination.mockClear();
  mockCheckDeadlockFreedom.mockClear();
  mockCheckLoopBounds.mockClear();
  mockCheckStateDataFlow.mockClear();

  // Reset to default passing behavior
  mockCheckReachability.mockImplementation(async () => PASS);
  mockCheckTermination.mockImplementation(async () => PASS);
  mockCheckDeadlockFreedom.mockImplementation(async () => PASS);
  mockCheckLoopBounds.mockImplementation(async () => PASS);
  mockCheckStateDataFlow.mockImplementation(async () => PASS);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyWorkflow", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test("returns valid=true when all properties pass", async () => {
    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(true);
    expect(result.properties.reachability.verified).toBe(true);
    expect(result.properties.termination.verified).toBe(true);
    expect(result.properties.deadlockFreedom.verified).toBe(true);
    expect(result.properties.loopBounds.verified).toBe(true);
    expect(result.properties.stateDataFlow.verified).toBe(true);
  });

  test("returns valid=false when reachability fails", async () => {
    mockCheckReachability.mockImplementation(async () => FAIL_REACHABILITY);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(false);
    expect(result.properties.reachability.verified).toBe(false);
    expect(result.properties.reachability.counterexample).toContain("orphan");
    // Other properties should still pass
    expect(result.properties.termination.verified).toBe(true);
    expect(result.properties.deadlockFreedom.verified).toBe(true);
    expect(result.properties.loopBounds.verified).toBe(true);
    expect(result.properties.stateDataFlow.verified).toBe(true);
  });

  test("returns valid=false when termination fails", async () => {
    mockCheckTermination.mockImplementation(async () => FAIL_TERMINATION);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(false);
    expect(result.properties.termination.verified).toBe(false);
    expect(result.properties.termination.counterexample).toContain(
      "Not all paths",
    );
  });

  test("returns valid=false when deadlock-freedom fails", async () => {
    mockCheckDeadlockFreedom.mockImplementation(async () => FAIL_DEADLOCK);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(false);
    expect(result.properties.deadlockFreedom.verified).toBe(false);
    expect(result.properties.deadlockFreedom.counterexample).toContain(
      "stuck",
    );
  });

  test("returns valid=false when loop-bounds fails", async () => {
    mockCheckLoopBounds.mockImplementation(async () => FAIL_LOOP_BOUNDS);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(false);
    expect(result.properties.loopBounds.verified).toBe(false);
    expect(result.properties.loopBounds.counterexample).toContain(
      "Unbounded loops",
    );
  });

  test("returns valid=false when state data-flow fails", async () => {
    mockCheckStateDataFlow.mockImplementation(async () => FAIL_DATA_FLOW);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(false);
    expect(result.properties.stateDataFlow.verified).toBe(false);
    expect(result.properties.stateDataFlow.counterexample).toContain(
      'reads "data"',
    );
  });

  test("returns valid=false when multiple properties fail", async () => {
    mockCheckReachability.mockImplementation(async () => FAIL_REACHABILITY);
    mockCheckTermination.mockImplementation(async () => FAIL_TERMINATION);
    mockCheckDeadlockFreedom.mockImplementation(async () => FAIL_DEADLOCK);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(false);
    expect(result.properties.reachability.verified).toBe(false);
    expect(result.properties.termination.verified).toBe(false);
    expect(result.properties.deadlockFreedom.verified).toBe(false);
    // These should still pass
    expect(result.properties.loopBounds.verified).toBe(true);
    expect(result.properties.stateDataFlow.verified).toBe(true);
  });

  test("returns valid=false when all properties fail", async () => {
    mockCheckReachability.mockImplementation(async () => FAIL_REACHABILITY);
    mockCheckTermination.mockImplementation(async () => FAIL_TERMINATION);
    mockCheckDeadlockFreedom.mockImplementation(async () => FAIL_DEADLOCK);
    mockCheckLoopBounds.mockImplementation(async () => FAIL_LOOP_BOUNDS);
    mockCheckStateDataFlow.mockImplementation(async () => FAIL_DATA_FLOW);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(false);
    expect(result.properties.reachability.verified).toBe(false);
    expect(result.properties.termination.verified).toBe(false);
    expect(result.properties.deadlockFreedom.verified).toBe(false);
    expect(result.properties.loopBounds.verified).toBe(false);
    expect(result.properties.stateDataFlow.verified).toBe(false);
  });

  test("calls encodeGraph when no encodedGraph is provided", async () => {
    const graph = makeDummyGraph();
    await verifyWorkflow(graph);

    expect(mockEncodeGraph).toHaveBeenCalledTimes(1);
    expect(mockEncodeGraph).toHaveBeenCalledWith(graph);
  });

  test("skips encodeGraph when encodedGraph is provided", async () => {
    const preEncoded = makeEncodedGraph();
    await verifyWorkflow(makeDummyGraph(), preEncoded);

    expect(mockEncodeGraph).not.toHaveBeenCalled();
  });

  test("passes encoded graph to all 5 checkers", async () => {
    const preEncoded = makeEncodedGraph({
      nodes: [
        { id: "custom-start", type: "agent" },
        { id: "custom-end", type: "agent" },
      ],
      startNode: "custom-start",
      endNodes: ["custom-end"],
    });

    await verifyWorkflow(makeDummyGraph(), preEncoded);

    expect(mockCheckReachability).toHaveBeenCalledWith(preEncoded);
    expect(mockCheckTermination).toHaveBeenCalledWith(preEncoded);
    expect(mockCheckDeadlockFreedom).toHaveBeenCalledWith(preEncoded);
    expect(mockCheckLoopBounds).toHaveBeenCalledWith(preEncoded);
    expect(mockCheckStateDataFlow).toHaveBeenCalledWith(preEncoded);
  });

  test("calls all 5 checkers exactly once", async () => {
    await verifyWorkflow(makeDummyGraph());

    expect(mockCheckReachability).toHaveBeenCalledTimes(1);
    expect(mockCheckTermination).toHaveBeenCalledTimes(1);
    expect(mockCheckDeadlockFreedom).toHaveBeenCalledTimes(1);
    expect(mockCheckLoopBounds).toHaveBeenCalledTimes(1);
    expect(mockCheckStateDataFlow).toHaveBeenCalledTimes(1);
  });

  test("preserves counterexample and details from failed checks", async () => {
    mockCheckReachability.mockImplementation(async () => FAIL_REACHABILITY);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.properties.reachability.counterexample).toBe(
      FAIL_REACHABILITY.counterexample,
    );
    expect(result.properties.reachability.details).toEqual(
      FAIL_REACHABILITY.details,
    );
  });

  test("result satisfies VerificationResult type", async () => {
    const result: VerificationResult = await verifyWorkflow(makeDummyGraph());

    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("properties");
    expect(result.properties).toHaveProperty("reachability");
    expect(result.properties).toHaveProperty("termination");
    expect(result.properties).toHaveProperty("deadlockFreedom");
    expect(result.properties).toHaveProperty("loopBounds");
    expect(result.properties).toHaveProperty("stateDataFlow");
  });

  test("runs all checks in parallel (not sequentially)", async () => {
    const callOrder: string[] = [];
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    mockCheckReachability.mockImplementation(async () => {
      callOrder.push("reachability-start");
      await delay(10);
      callOrder.push("reachability-end");
      return PASS;
    });
    mockCheckTermination.mockImplementation(async () => {
      callOrder.push("termination-start");
      await delay(10);
      callOrder.push("termination-end");
      return PASS;
    });
    mockCheckDeadlockFreedom.mockImplementation(async () => {
      callOrder.push("deadlock-start");
      await delay(10);
      callOrder.push("deadlock-end");
      return PASS;
    });
    mockCheckLoopBounds.mockImplementation(async () => {
      callOrder.push("loop-start");
      await delay(10);
      callOrder.push("loop-end");
      return PASS;
    });
    mockCheckStateDataFlow.mockImplementation(async () => {
      callOrder.push("dataflow-start");
      await delay(10);
      callOrder.push("dataflow-end");
      return PASS;
    });

    await verifyWorkflow(makeDummyGraph());

    // All starts should come before all ends if running in parallel
    const startIndices = callOrder
      .filter((e) => e.endsWith("-start"))
      .map((e) => callOrder.indexOf(e));
    const endIndices = callOrder
      .filter((e) => e.endsWith("-end"))
      .map((e) => callOrder.indexOf(e));

    const maxStartIndex = Math.max(...startIndices);
    const minEndIndex = Math.min(...endIndices);

    // In parallel execution, all starts occur before any end completes
    expect(maxStartIndex).toBeLessThan(minEndIndex);
  });

  test("handles a checker that passes with details", async () => {
    const passWithDetails: PropertyResult = {
      verified: true,
      details: { info: "some diagnostic info" },
    };
    mockCheckReachability.mockImplementation(async () => passWithDetails);

    const result = await verifyWorkflow(makeDummyGraph());

    expect(result.valid).toBe(true);
    expect(result.properties.reachability.verified).toBe(true);
    expect(result.properties.reachability.details).toEqual({
      info: "some diagnostic info",
    });
  });
});
