import { describe, expect, test } from "bun:test";
import { asBaseGraph } from "@/services/workflows/graph/contracts/runtime.ts";
import type {
  CompiledGraph,
  Edge,
  GraphConfig,
  NodeDefinition,
} from "@/services/workflows/graph/contracts/runtime.ts";
import type { BaseState } from "@/services/workflows/graph/contracts/core.ts";

// ============================================================================
// Helpers
// ============================================================================

interface TestState extends BaseState {
  counter: number;
  label: string;
}

function makeTestNode(id: string): NodeDefinition<TestState> {
  return {
    id,
    type: "tool",
    execute: async () => ({ stateUpdate: { counter: 1, label: "done" } }),
  };
}

function makeTestGraph(overrides: Partial<CompiledGraph<TestState>> = {}): CompiledGraph<TestState> {
  const nodes = new Map<string, NodeDefinition<TestState>>();
  nodes.set("start", makeTestNode("start"));
  nodes.set("end", makeTestNode("end"));

  const edges: Edge<TestState>[] = [
    { from: "start", to: "end" },
  ];

  return {
    nodes,
    edges,
    startNode: "start",
    endNodes: new Set(["end"]),
    config: {},
    ...overrides,
  };
}

// ============================================================================
// asBaseGraph
// ============================================================================

describe("asBaseGraph", () => {
  test("returns a CompiledGraph<BaseState>", () => {
    const specific = makeTestGraph();
    const widened = asBaseGraph(specific);

    // The widened graph should have the same runtime identity
    expect(widened.startNode).toBe("start");
    expect(widened.nodes.size).toBe(2);
    expect(widened.endNodes.has("end")).toBe(true);
  });

  test("preserves structural fields through widening", () => {
    const specific = makeTestGraph({
      config: { maxConcurrency: 2 } as GraphConfig<TestState>,
    });
    const widened = asBaseGraph(specific);

    expect(widened.config.maxConcurrency).toBe(2);
  });

  test("nodes remain executable after widening", async () => {
    const specific = makeTestGraph();
    const widened = asBaseGraph(specific);

    const node = widened.nodes.get("start")!;
    const result = await node.execute({
      state: { executionId: "test", lastUpdated: new Date().toISOString(), outputs: {} },
      config: {},
      errors: [],
    });

    expect(result.stateUpdate).toBeDefined();
  });

  test("preserves empty config", () => {
    const specific = makeTestGraph({ config: {} as GraphConfig<TestState> });
    const widened = asBaseGraph(specific);
    expect(widened.config).toEqual({});
  });

  test("preserves edge conditions and labels", () => {
    const conditionFn = (state: TestState) => state.counter > 0;
    const specific = makeTestGraph({
      edges: [
        { from: "start", to: "end", condition: conditionFn, label: "check-counter" },
      ],
    });
    const widened = asBaseGraph(specific);

    expect(widened.edges).toHaveLength(1);
    expect(widened.edges[0]!.label).toBe("check-counter");
    expect(widened.edges[0]!.condition).toBeDefined();
  });

  test("preserves conditionGroup on edges", () => {
    const specific = makeTestGraph({
      edges: [
        { from: "start", to: "end", conditionGroup: "group-1" },
      ],
    });
    const widened = asBaseGraph(specific);
    expect(widened.edges[0]!.conditionGroup).toBe("group-1");
  });

  test("preserves metadata in config", () => {
    const specific = makeTestGraph({
      config: { metadata: { workflow: "test", version: 2 } } as GraphConfig<TestState>,
    });
    const widened = asBaseGraph(specific);
    expect(widened.config.metadata).toEqual({ workflow: "test", version: 2 });
  });

  test("preserves multiple end nodes", () => {
    const nodes = new Map<string, NodeDefinition<TestState>>();
    nodes.set("start", makeTestNode("start"));
    nodes.set("end-a", makeTestNode("end-a"));
    nodes.set("end-b", makeTestNode("end-b"));

    const specific: CompiledGraph<TestState> = {
      nodes,
      edges: [
        { from: "start", to: "end-a" },
        { from: "start", to: "end-b" },
      ],
      startNode: "start",
      endNodes: new Set(["end-a", "end-b"]),
      config: {},
    };

    const widened = asBaseGraph(specific);
    expect(widened.endNodes.size).toBe(2);
    expect(widened.endNodes.has("end-a")).toBe(true);
    expect(widened.endNodes.has("end-b")).toBe(true);
  });

  test("widened graph is the same object at runtime (cast, not copy)", () => {
    const specific = makeTestGraph();
    const widened = asBaseGraph(specific);

    // asBaseGraph is a type-only cast, so the object reference should be identical
    expect(widened).toBe(specific as unknown as CompiledGraph<BaseState>);
  });
});
