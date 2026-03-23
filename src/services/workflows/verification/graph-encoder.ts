/**
 * Graph Encoder
 *
 * Translates a CompiledGraph (with Map-based nodes and function-based edges)
 * into an EncodedGraph (with arrays and boolean flags) suitable for
 * verification constraint generation.
 *
 * This is a pure data transformation — no solver calls here.
 */

import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import type {
  EncodedGraph,
  VerificationEdge,
  VerificationNode,
} from "@/services/workflows/verification/types.ts";

/**
 * Encode a CompiledGraph into a verification-ready EncodedGraph.
 *
 * Strips runtime functions (execute, condition predicates) and retains
 * only structural information needed for verification analysis.
 */
export function encodeGraph(graph: CompiledGraph<BaseState>): EncodedGraph {
  const nodes: VerificationNode[] = [];
  for (const [id, node] of graph.nodes) {
    nodes.push({
      id,
      type: node.type,
      reads: node.reads,
      outputs: node.outputs,
    });
  }

  const edges: VerificationEdge[] = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    hasCondition: edge.condition !== undefined,
    conditionGroup: edge.conditionGroup ?? edge.label,
  }));

  return {
    nodes,
    edges,
    startNode: graph.startNode,
    endNodes: Array.from(graph.endNodes),
    loops: [], // Populated by the compiler when loop instructions are present
    stateFields: [], // Populated by the compiler from .state() schema
  };
}
