/**
 * Reachability Verification
 *
 * Property 1: Every node in the graph is reachable from the start node.
 *
 * Encoding: Boolean variable `reach[i]` per node.
 * - reach[start] = true
 * - For each non-start node j with predecessors:
 *     reach[j] <=> OR(reach[pred] for pred in predecessors(j))
 * - For each non-start node j with no predecessors:
 *     reach[j] = false (unreachable by definition)
 * - Assert NOT(reach[j]) for each node j and check unsat to verify reachability
 */

import { init } from "z3-solver";
import type { Bool } from "z3-solver";
import type { EncodedGraph } from "@/services/workflows/verification/types.ts";
import type { PropertyResult } from "@/services/workflows/verification/types.ts";

export async function checkReachability(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  const { Context } = await init();
  const ctx = Context("main");

  // Create boolean variables for reachability
  const reach = new Map<string, Bool<"main">>();
  for (const node of graph.nodes) {
    reach.set(node.id, ctx.Bool.const(`reach_${node.id}`));
  }

  const solver = new ctx.Solver();

  // Start node is always reachable
  const startReach = reach.get(graph.startNode);
  if (!startReach) {
    return {
      verified: false,
      counterexample: `Start node "${graph.startNode}" not found in graph nodes`,
      details: { unreachableNodes: [] },
    };
  }
  solver.add(startReach);

  // Build predecessor map
  const predecessors = new Map<string, string[]>();
  for (const node of graph.nodes) {
    predecessors.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const preds = predecessors.get(edge.to);
    if (preds) {
      preds.push(edge.from);
    }
  }

  // For each non-start node: reachable iff at least one predecessor is reachable
  for (const node of graph.nodes) {
    if (node.id === graph.startNode) continue;

    const nodeReach = reach.get(node.id)!;
    const preds = predecessors.get(node.id) ?? [];

    if (preds.length === 0) {
      // No predecessors -- node cannot be reachable
      solver.add(ctx.Not(nodeReach));
    } else if (preds.length === 1) {
      // Single predecessor -- reach[node] <=> reach[pred]
      const singlePred = preds[0] as string;
      solver.add(ctx.Eq(nodeReach, reach.get(singlePred)!));
    } else {
      // Multiple predecessors -- reach[node] <=> OR(reach[pred] for pred in predecessors)
      const predReachVars = preds.map((p) => reach.get(p)!);
      const predReachable = ctx.Or(...predReachVars);
      solver.add(ctx.Eq(nodeReach, predReachable));
    }
  }

  // Check that all nodes are reachable
  const unreachableNodes: string[] = [];
  for (const node of graph.nodes) {
    const nodeReach = reach.get(node.id)!;
    // Push a scope, assert NOT reachable, check if satisfiable
    solver.push();
    solver.add(ctx.Not(nodeReach));
    const result = await solver.check();
    solver.pop();

    if (result === "sat") {
      // Found a model where this node is unreachable
      unreachableNodes.push(node.id);
    }
  }

  if (unreachableNodes.length > 0) {
    return {
      verified: false,
      counterexample: `Node(s) ${unreachableNodes.map((n) => `"${n}"`).join(", ")} unreachable from start node "${graph.startNode}"`,
      details: { unreachableNodes },
    };
  }

  return { verified: true };
}
