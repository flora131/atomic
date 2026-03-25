/**
 * Tests for graph encoder.
 *
 * Verifies that CompiledGraph is correctly translated into an
 * EncodedGraph suitable for verification.
 */

import { test, expect, describe } from "bun:test";
import { encodeGraph } from "@/services/workflows/verification/graph-encoder.ts";
import type { CompiledGraph, BaseState, NodeDefinition, Edge } from "@/services/workflows/graph/types.ts";

/** Create a minimal NodeDefinition for testing. */
function makeNode(
  id: string,
  overrides: Partial<NodeDefinition<BaseState>> = {},
): NodeDefinition<BaseState> {
  return {
    id,
    type: "agent",
    execute: async () => ({}),
    ...overrides,
  };
}

/** Create a minimal CompiledGraph for testing. */
function makeGraph(opts: {
  nodes: Map<string, NodeDefinition<BaseState>>;
  edges: Edge<BaseState>[];
  startNode: string;
  endNodes: Set<string>;
}): CompiledGraph<BaseState> {
  return {
    nodes: opts.nodes,
    edges: opts.edges,
    startNode: opts.startNode,
    endNodes: opts.endNodes,
    config: {},
  };
}

describe("encodeGraph", () => {
  test("encodes single-node graph", () => {
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("A", makeNode("A"));

    const graph = makeGraph({
      nodes,
      edges: [],
      startNode: "A",
      endNodes: new Set(["A"]),
    });

    const encoded = encodeGraph(graph);
    expect(encoded.nodes).toHaveLength(1);
    expect(encoded.nodes[0]!.id).toBe("A");
    expect(encoded.nodes[0]!.type).toBe("agent");
    expect(encoded.edges).toHaveLength(0);
    expect(encoded.startNode).toBe("A");
    expect(encoded.endNodes).toEqual(["A"]);
    expect(encoded.loops).toEqual([]);
    expect(encoded.stateFields).toEqual([]);
  });

  test("encodes node types correctly", () => {
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("a", makeNode("a", { type: "agent" }));
    nodes.set("t", makeNode("t", { type: "tool" }));
    nodes.set("d", makeNode("d", { type: "decision" }));

    const graph = makeGraph({
      nodes,
      edges: [
        { from: "a", to: "t" },
        { from: "t", to: "d" },
      ],
      startNode: "a",
      endNodes: new Set(["d"]),
    });

    const encoded = encodeGraph(graph);
    const typeMap = new Map(encoded.nodes.map((n) => [n.id, n.type]));
    expect(typeMap.get("a")).toBe("agent");
    expect(typeMap.get("t")).toBe("tool");
    expect(typeMap.get("d")).toBe("decision");
  });

  test("preserves reads and outputs metadata", () => {
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("A", makeNode("A", { reads: ["x", "y"], outputs: ["z"] }));
    nodes.set("B", makeNode("B"));

    const graph = makeGraph({
      nodes,
      edges: [{ from: "A", to: "B" }],
      startNode: "A",
      endNodes: new Set(["B"]),
    });

    const encoded = encodeGraph(graph);
    const nodeA = encoded.nodes.find((n) => n.id === "A");
    const nodeB = encoded.nodes.find((n) => n.id === "B");
    expect(nodeA?.reads).toEqual(["x", "y"]);
    expect(nodeA?.outputs).toEqual(["z"]);
    expect(nodeB?.reads).toBeUndefined();
    expect(nodeB?.outputs).toBeUndefined();
  });

  test("encodes unconditional edges correctly", () => {
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("A", makeNode("A"));
    nodes.set("B", makeNode("B"));

    const graph = makeGraph({
      nodes,
      edges: [{ from: "A", to: "B" }],
      startNode: "A",
      endNodes: new Set(["B"]),
    });

    const encoded = encodeGraph(graph);
    expect(encoded.edges).toHaveLength(1);
    expect(encoded.edges[0]!.from).toBe("A");
    expect(encoded.edges[0]!.to).toBe("B");
    expect(encoded.edges[0]!.hasCondition).toBe(false);
  });

  test("encodes conditional edges correctly", () => {
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("A", makeNode("A"));
    nodes.set("B", makeNode("B"));

    const conditionFn = () => true;
    const graph = makeGraph({
      nodes,
      edges: [{ from: "A", to: "B", condition: conditionFn }],
      startNode: "A",
      endNodes: new Set(["B"]),
    });

    const encoded = encodeGraph(graph);
    expect(encoded.edges[0]!.hasCondition).toBe(true);
  });

  test("encodes conditionGroup from edge metadata", () => {
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("A", makeNode("A"));
    nodes.set("B", makeNode("B"));
    nodes.set("C", makeNode("C"));

    const graph = makeGraph({
      nodes,
      edges: [
        { from: "A", to: "B", condition: () => true, conditionGroup: "g1" },
        { from: "A", to: "C", condition: () => true, conditionGroup: "g1" },
      ],
      startNode: "A",
      endNodes: new Set(["B", "C"]),
    });

    const encoded = encodeGraph(graph);
    expect(encoded.edges[0]!.conditionGroup).toBe("g1");
    expect(encoded.edges[1]!.conditionGroup).toBe("g1");
  });

  test("uses edge label as conditionGroup fallback", () => {
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("A", makeNode("A"));
    nodes.set("B", makeNode("B"));

    const graph = makeGraph({
      nodes,
      edges: [{ from: "A", to: "B", label: "fallback-label" }],
      startNode: "A",
      endNodes: new Set(["B"]),
    });

    const encoded = encodeGraph(graph);
    expect(encoded.edges[0]!.conditionGroup).toBe("fallback-label");
  });

  test("converts endNodes Set to array", () => {
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("A", makeNode("A"));
    nodes.set("B", makeNode("B"));
    nodes.set("C", makeNode("C"));

    const graph = makeGraph({
      nodes,
      edges: [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
      ],
      startNode: "A",
      endNodes: new Set(["B", "C"]),
    });

    const encoded = encodeGraph(graph);
    expect(Array.isArray(encoded.endNodes)).toBe(true);
    expect(encoded.endNodes).toContain("B");
    expect(encoded.endNodes).toContain("C");
  });

  test("strips runtime execute functions", () => {
    const executeFn = async () => ({ stateUpdate: { something: true } as never });
    const nodes = new Map<string, NodeDefinition<BaseState>>();
    nodes.set("A", makeNode("A", { execute: executeFn }));

    const graph = makeGraph({
      nodes,
      edges: [],
      startNode: "A",
      endNodes: new Set(["A"]),
    });

    const encoded = encodeGraph(graph);
    const encodedNode = encoded.nodes[0]!;
    expect("execute" in encodedNode).toBe(false);
  });

  test("empty graph produces empty encoded graph", () => {
    const graph = makeGraph({
      nodes: new Map(),
      edges: [],
      startNode: "",
      endNodes: new Set(),
    });

    const encoded = encodeGraph(graph);
    expect(encoded.nodes).toHaveLength(0);
    expect(encoded.edges).toHaveLength(0);
    expect(encoded.startNode).toBe("");
    expect(encoded.endNodes).toEqual([]);
  });
});
