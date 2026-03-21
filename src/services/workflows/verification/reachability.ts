/**
 * Reachability Verification
 *
 * Property 1: Every node in the graph is reachable from the start node.
 *
 * Algorithm: BFS from start node, then check if all nodes were visited.
 */

import type { EncodedGraph } from "@/services/workflows/verification/types.ts";
import type { PropertyResult } from "@/services/workflows/verification/types.ts";

export async function checkReachability(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));

  if (!allNodeIds.has(graph.startNode)) {
    return {
      verified: false,
      counterexample: `Start node "${graph.startNode}" not found in graph nodes`,
      details: { unreachableNodes: [] },
    };
  }

  // BFS from start node
  const visited = new Set<string>();
  const queue = [graph.startNode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of graph.edges) {
      if (edge.from === current && !visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  const unreachableNodes = graph.nodes
    .map((n) => n.id)
    .filter((id) => !visited.has(id));

  if (unreachableNodes.length > 0) {
    return {
      verified: false,
      counterexample: `Node(s) ${unreachableNodes.map((n) => `"${n}"`).join(", ")} unreachable from start node "${graph.startNode}"`,
      details: { unreachableNodes },
    };
  }

  return { verified: true };
}
