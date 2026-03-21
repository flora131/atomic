import { describe, test, expect } from "bun:test";
import { encodeGraph } from "@/services/workflows/verification/graph-encoder";
import type { CompiledGraph, BaseState } from "@/services/workflows/graph/types";
import type { EncodedGraph } from "@/services/workflows/verification/types";

/**
 * Helper to build a minimal CompiledGraph for testing.
 */
function makeGraph(opts: {
  nodes: Array<{
    id: string;
    type: string;
    _reads?: string[];
    _outputs?: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    condition?: () => boolean;
    label?: string;
  }>;
  startNode: string;
  endNodes: string[];
}): CompiledGraph<BaseState> {
  const nodeMap = new Map<string, Record<string, unknown>>();
  for (const n of opts.nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      type: n.type,
      execute: async () => ({}),
      _reads: n._reads,
      _outputs: n._outputs,
    });
  }

  return {
    nodes: nodeMap,
    edges: opts.edges.map((e) => ({
      from: e.from,
      to: e.to,
      condition: e.condition,
      label: e.label,
    })),
    startNode: opts.startNode,
    endNodes: new Set(opts.endNodes),
    config: {},
  } as unknown as CompiledGraph<BaseState>;
}

describe("encodeGraph", () => {
  test("encodes a simple linear graph", () => {
    const graph = makeGraph({
      nodes: [
        { id: "start", type: "agent" },
        { id: "middle", type: "tool" },
        { id: "end", type: "agent" },
      ],
      edges: [
        { from: "start", to: "middle" },
        { from: "middle", to: "end" },
      ],
      startNode: "start",
      endNodes: ["end"],
    });

    const encoded = encodeGraph(graph);

    expect(encoded.nodes).toHaveLength(3);
    expect(encoded.edges).toHaveLength(2);
    expect(encoded.startNode).toBe("start");
    expect(encoded.endNodes).toEqual(["end"]);
    expect(encoded.loops).toEqual([]);
    expect(encoded.stateFields).toEqual([]);
  });

  test("preserves node IDs and types", () => {
    const graph = makeGraph({
      nodes: [
        { id: "a", type: "agent" },
        { id: "b", type: "tool" },
      ],
      edges: [{ from: "a", to: "b" }],
      startNode: "a",
      endNodes: ["b"],
    });

    const encoded = encodeGraph(graph);

    expect(encoded.nodes[0]).toEqual(
      expect.objectContaining({ id: "a", type: "agent" }),
    );
    expect(encoded.nodes[1]).toEqual(
      expect.objectContaining({ id: "b", type: "tool" }),
    );
  });

  test("preserves _reads and _outputs metadata", () => {
    const graph = makeGraph({
      nodes: [
        { id: "a", type: "tool", _reads: ["input"], _outputs: ["result"] },
        { id: "b", type: "agent" },
      ],
      edges: [{ from: "a", to: "b" }],
      startNode: "a",
      endNodes: ["b"],
    });

    const encoded = encodeGraph(graph);

    expect(encoded.nodes[0]?.reads).toEqual(["input"]);
    expect(encoded.nodes[0]?.outputs).toEqual(["result"]);
    expect(encoded.nodes[1]?.reads).toBeUndefined();
    expect(encoded.nodes[1]?.outputs).toBeUndefined();
  });

  test("marks edges with conditions correctly", () => {
    const graph = makeGraph({
      nodes: [
        { id: "a", type: "decision" },
        { id: "b", type: "agent" },
        { id: "c", type: "agent" },
      ],
      edges: [
        { from: "a", to: "b", condition: () => true, label: "if-branch" },
        { from: "a", to: "c", label: "else-branch" },
      ],
      startNode: "a",
      endNodes: ["b", "c"],
    });

    const encoded = encodeGraph(graph);

    expect(encoded.edges[0]?.hasCondition).toBe(true);
    expect(encoded.edges[0]?.conditionGroup).toBe("if-branch");
    expect(encoded.edges[1]?.hasCondition).toBe(false);
    expect(encoded.edges[1]?.conditionGroup).toBe("else-branch");
  });

  test("converts Set endNodes to Array", () => {
    const graph = makeGraph({
      nodes: [
        { id: "start", type: "agent" },
        { id: "end1", type: "agent" },
        { id: "end2", type: "agent" },
      ],
      edges: [
        { from: "start", to: "end1" },
        { from: "start", to: "end2" },
      ],
      startNode: "start",
      endNodes: ["end1", "end2"],
    });

    const encoded = encodeGraph(graph);

    expect(Array.isArray(encoded.endNodes)).toBe(true);
    expect(encoded.endNodes).toContain("end1");
    expect(encoded.endNodes).toContain("end2");
  });

  test("handles empty graph with only start=end node", () => {
    const graph = makeGraph({
      nodes: [{ id: "only", type: "agent" }],
      edges: [],
      startNode: "only",
      endNodes: ["only"],
    });

    const encoded = encodeGraph(graph);

    expect(encoded.nodes).toHaveLength(1);
    expect(encoded.edges).toHaveLength(0);
    expect(encoded.startNode).toBe("only");
    expect(encoded.endNodes).toEqual(["only"]);
  });

  test("strips runtime functions from edges", () => {
    const conditionFn = () => true;
    const graph = makeGraph({
      nodes: [
        { id: "a", type: "agent" },
        { id: "b", type: "agent" },
      ],
      edges: [{ from: "a", to: "b", condition: conditionFn }],
      startNode: "a",
      endNodes: ["b"],
    });

    const encoded = encodeGraph(graph);

    // The encoded edge should not have the condition function
    const edge = encoded.edges[0] as unknown as Record<string, unknown>;
    expect(edge.condition).toBeUndefined();
    expect(encoded.edges[0]?.hasCondition).toBe(true);
  });

  test("returns valid EncodedGraph type", () => {
    const graph = makeGraph({
      nodes: [
        { id: "s", type: "agent" },
        { id: "e", type: "agent" },
      ],
      edges: [{ from: "s", to: "e" }],
      startNode: "s",
      endNodes: ["e"],
    });

    const encoded: EncodedGraph = encodeGraph(graph);

    // Verify the shape satisfies EncodedGraph
    expect(encoded).toHaveProperty("nodes");
    expect(encoded).toHaveProperty("edges");
    expect(encoded).toHaveProperty("startNode");
    expect(encoded).toHaveProperty("endNodes");
    expect(encoded).toHaveProperty("loops");
    expect(encoded).toHaveProperty("stateFields");
  });
});
