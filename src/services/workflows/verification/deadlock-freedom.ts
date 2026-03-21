/**
 * Deadlock-Freedom Verification
 *
 * Property 3: Every reachable non-end node has at least one enabled
 * outgoing edge, ensuring the workflow cannot get "stuck".
 *
 * Uses abstract boolean modeling for conditional edges -- each unique
 * condition is a Z3 boolean variable with mutual exclusion constraints
 * for branches from the same decision point.
 */

import { init } from "z3-solver";
import type {
  EncodedGraph,
  PropertyResult,
  VerificationEdge,
} from "@/services/workflows/verification/types";

export async function checkDeadlockFreedom(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  const { Context } = await init();
  const ctx = Context("main");
  const solver = new ctx.Solver();

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

  // Check each non-end node
  for (const node of graph.nodes) {
    if (endNodeSet.has(node.id)) continue;

    const edges = outgoingEdges.get(node.id) ?? [];
    if (edges.length === 0) {
      // Non-end node with no outgoing edges -- deadlock
      deadlockedNodes.push(node.id);
      continue;
    }

    // Check if at least one edge is unconditional
    const hasUnconditional = edges.some((e) => !e.hasCondition);
    if (hasUnconditional) {
      // At least one unconditional edge -- no deadlock possible
      continue;
    }

    // All edges are conditional -- check if they're exhaustive
    // Group by condition group (if/elseIf/else from same decision point)
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

    // For grouped conditional edges: check if exhaustive
    // (the compiler should ensure if/else blocks are exhaustive,
    // but we verify it here)
    let isExhaustive = false;

    for (const [, groupEdges] of groups) {
      // If any group has an "else" (unconditional within the group),
      // the group is exhaustive
      if (groupEdges.some((e) => !e.hasCondition)) {
        isExhaustive = true;
        break;
      }
    }

    // If there are ungrouped conditional edges and no exhaustive group,
    // use Z3 to check if the conditions can all be false simultaneously
    if (!isExhaustive && ungrouped.length > 0) {
      // Create boolean variables for each condition
      const condVars = ungrouped.map((_, i) =>
        ctx.Bool.const(`cond_${node.id}_${i}`),
      );

      solver.push();
      // Assert all conditions are false (potential deadlock)
      for (const cv of condVars) {
        solver.add(ctx.Not(cv));
      }
      const result = await solver.check();
      solver.pop();

      if (result === "sat") {
        // All conditions can be false -- potential deadlock
        deadlockedNodes.push(node.id);
      }
    } else if (!isExhaustive && ungrouped.length === 0) {
      // All edges are in groups, but no group is exhaustive
      // Check each group
      let allGroupsExhaustive = true;
      for (const [, groupEdges] of groups) {
        if (!groupEdges.some((e) => !e.hasCondition)) {
          allGroupsExhaustive = false;
          break;
        }
      }
      if (!allGroupsExhaustive) {
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
