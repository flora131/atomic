/**
 * Termination Verification
 *
 * Property 2: All reachable nodes can reach at least one end node.
 *
 * Algorithm: Reverse BFS from all end nodes. Any reachable node (from
 * start) that is NOT reachable in the reverse graph cannot terminate.
 */

import type { EncodedGraph } from "@/services/workflows/verification/types.ts";
import type { PropertyResult } from "@/services/workflows/verification/types.ts";

export async function checkTermination(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  // Build reverse adjacency (predecessor → successor becomes successor → predecessor)
  const reverseAdj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    reverseAdj.set(node.id, []);
  }
  for (const edge of graph.edges) {
    reverseAdj.get(edge.to)?.push(edge.from);
  }

  // Reverse BFS from all end nodes — find all nodes that can reach an end
  const canReachEnd = new Set<string>();
  const queue = [...graph.endNodes];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (canReachEnd.has(current)) continue;
    canReachEnd.add(current);

    for (const pred of reverseAdj.get(current) ?? []) {
      if (!canReachEnd.has(pred)) {
        queue.push(pred);
      }
    }
  }

  // Forward BFS from start to find reachable nodes
  const reachable = new Set<string>();
  const fwdQueue = [graph.startNode];
  while (fwdQueue.length > 0) {
    const current = fwdQueue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    for (const edge of graph.edges) {
      if (edge.from === current && !reachable.has(edge.to)) {
        fwdQueue.push(edge.to);
      }
    }
  }

  // Dead-end nodes: reachable from start but cannot reach any end node
  const deadEndNodes = [...reachable].filter((id) => !canReachEnd.has(id));

  if (deadEndNodes.length > 0) {
    return {
      verified: false,
      counterexample: `Node(s) ${deadEndNodes.map((n) => `"${n}"`).join(", ")} have no path to any end node`,
      details: { deadEndNodes },
    };
  }

  return { verified: true };
}
