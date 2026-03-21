/**
 * Deadlock-Freedom Verification
 *
 * Property 3: Every reachable non-end node has at least one outgoing edge.
 *
 * For conditional edges from the same decision point (conditionGroup),
 * the group is exhaustive if it contains an unconditional (else) branch.
 * Ungrouped conditional edges without a fallback are potential deadlocks.
 */

import type {
  EncodedGraph,
  PropertyResult,
  VerificationEdge,
} from "@/services/workflows/verification/types.ts";

export async function checkDeadlockFreedom(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  const endNodeSet = new Set(graph.endNodes);
  const deadlockedNodes: string[] = [];

  // Group edges by source node
  const outgoingEdges = new Map<string, VerificationEdge[]>();
  for (const node of graph.nodes) {
    outgoingEdges.set(node.id, []);
  }
  for (const edge of graph.edges) {
    outgoingEdges.get(edge.from)?.push(edge);
  }

  for (const node of graph.nodes) {
    if (endNodeSet.has(node.id)) continue;

    const edges = outgoingEdges.get(node.id) ?? [];
    if (edges.length === 0) {
      deadlockedNodes.push(node.id);
      continue;
    }

    // Any unconditional edge means no deadlock
    if (edges.some((e) => !e.hasCondition)) continue;

    // All edges conditional — check if exhaustive via condition groups
    const groups = new Map<string, VerificationEdge[]>();
    const ungrouped: VerificationEdge[] = [];
    for (const edge of edges) {
      if (edge.conditionGroup) {
        const group = groups.get(edge.conditionGroup) ?? [];
        group.push(edge);
        groups.set(edge.conditionGroup, group);
      } else {
        ungrouped.push(edge);
      }
    }

    // A group is exhaustive if it has an unconditional (else) branch
    let isExhaustive = false;
    for (const [, groupEdges] of groups) {
      if (groupEdges.some((e) => !e.hasCondition)) {
        isExhaustive = true;
        break;
      }
    }

    if (!isExhaustive) {
      // Ungrouped conditional edges with no fallback = potential deadlock
      if (ungrouped.length > 0) {
        deadlockedNodes.push(node.id);
      } else {
        // All edges in groups but none exhaustive
        deadlockedNodes.push(node.id);
      }
    }
  }

  if (deadlockedNodes.length > 0) {
    return {
      verified: false,
      counterexample: `Node(s) ${deadlockedNodes.map((n) => `"${n}"`).join(", ")} may deadlock — all outgoing edges have conditions that are not exhaustive`,
      details: { deadlockedNodes },
    };
  }

  return { verified: true };
}
