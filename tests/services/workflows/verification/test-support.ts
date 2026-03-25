/**
 * Test support for workflow verification tests.
 *
 * Provides builder helpers to construct EncodedGraph instances
 * for exercising verification algorithms without needing the
 * full compiler/graph-builder pipeline.
 */

import type {
  EncodedGraph,
  VerificationNode,
  VerificationEdge,
  VerificationLoop,
} from "@/services/workflows/verification/types.ts";

/**
 * Build an EncodedGraph from a concise specification.
 *
 * Usage:
 *   buildGraph({ nodes: ["A","B","C"], edges: [["A","B"],["B","C"]], start: "A", ends: ["C"] })
 */
export function buildGraph(spec: {
  nodes: Array<string | VerificationNode>;
  edges: Array<[string, string] | VerificationEdge>;
  start: string;
  ends: string[];
  loops?: VerificationLoop[];
  stateFields?: string[];
}): EncodedGraph {
  const nodes: VerificationNode[] = spec.nodes.map((n) =>
    typeof n === "string" ? { id: n, type: "agent" } : n,
  );

  const edges: VerificationEdge[] = spec.edges.map((e) =>
    Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string" && e.length === 2
      ? { from: e[0], to: e[1], hasCondition: false }
      : (e as VerificationEdge),
  );

  return {
    nodes,
    edges,
    startNode: spec.start,
    endNodes: spec.ends,
    loops: spec.loops ?? [],
    stateFields: spec.stateFields ?? [],
  };
}

/**
 * Build a simple linear graph: A -> B -> C -> ... -> Z (end).
 */
export function buildLinearGraph(nodeIds: string[]): EncodedGraph {
  if (nodeIds.length === 0) {
    return { nodes: [], edges: [], startNode: "", endNodes: [], loops: [], stateFields: [] };
  }
  const nodes: VerificationNode[] = nodeIds.map((id) => ({ id, type: "agent" }));
  const edges: VerificationEdge[] = [];
  for (let i = 0; i < nodeIds.length - 1; i++) {
    edges.push({ from: nodeIds[i]!, to: nodeIds[i + 1]!, hasCondition: false });
  }
  return {
    nodes,
    edges,
    startNode: nodeIds[0]!,
    endNodes: [nodeIds[nodeIds.length - 1]!],
    loops: [],
    stateFields: [],
  };
}

/**
 * Build a diamond graph:
 *       A
 *      / \
 *     B   C
 *      \ /
 *       D
 */
export function buildDiamondGraph(): EncodedGraph {
  return buildGraph({
    nodes: ["A", "B", "C", "D"],
    edges: [
      ["A", "B"],
      ["A", "C"],
      ["B", "D"],
      ["C", "D"],
    ],
    start: "A",
    ends: ["D"],
  });
}
