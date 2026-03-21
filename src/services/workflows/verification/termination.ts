/**
 * Termination Verification
 *
 * Property 2: All paths from the start node eventually reach an end node.
 *
 * Encoding: Integer distance variable `dist[i]` per node representing
 * the distance to the nearest end node.
 * - dist[end] = 0 for all end nodes
 * - For non-end nodes with successors:
 *     dist[i] > 0 AND dist[i] = dist[succ] + 1 for at least one successor
 * - For non-end nodes with no successors: dead end (fail early)
 * - All distances must be non-negative
 * - Check satisfiability -- sat means all nodes can reach an end
 */

import { init } from "z3-solver";
import type { Arith } from "z3-solver";
import type { EncodedGraph } from "@/services/workflows/verification/types.ts";
import type { PropertyResult } from "@/services/workflows/verification/types.ts";

export async function checkTermination(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  const { Context } = await init();
  const ctx = Context("main");

  // Build successor map
  const successors = new Map<string, string[]>();
  for (const node of graph.nodes) {
    successors.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const succs = successors.get(edge.from);
    if (succs) {
      succs.push(edge.to);
    }
  }

  const endNodeSet = new Set(graph.endNodes);

  // Pre-check: identify non-end nodes with no successors (dead ends)
  // These make termination impossible without needing Z3
  const deadEndNodes: string[] = [];
  for (const node of graph.nodes) {
    const succs = successors.get(node.id) ?? [];
    if (!endNodeSet.has(node.id) && succs.length === 0) {
      deadEndNodes.push(node.id);
    }
  }

  if (deadEndNodes.length > 0) {
    return {
      verified: false,
      counterexample: `Node(s) ${deadEndNodes.map((n) => `"${n}"`).join(", ")} have no path to any end node`,
      details: { deadEndNodes },
    };
  }

  // Create integer distance variables
  const dist = new Map<string, Arith<"main">>();
  for (const node of graph.nodes) {
    dist.set(node.id, ctx.Int.const(`dist_${node.id}`));
  }

  const solver = new ctx.Solver();

  // End nodes have distance 0
  for (const endNode of graph.endNodes) {
    const endDist = dist.get(endNode);
    if (endDist) {
      solver.add(endDist.eq(0));
    }
  }

  // For each non-end node with successors:
  // dist[i] > 0 AND there exists a successor where dist[i] = dist[succ] + 1
  for (const node of graph.nodes) {
    if (endNodeSet.has(node.id)) continue;

    const nodeDist = dist.get(node.id)!;
    const succs = successors.get(node.id) ?? [];

    // dist[i] > 0 (non-end nodes must have positive distance)
    solver.add(ctx.GT(nodeDist, ctx.Int.val(0)));

    // dist[i] = dist[succ] + 1 for at least one successor
    if (succs.length === 1) {
      const singleSucc = succs[0] as string;
      const succDist = dist.get(singleSucc)!;
      solver.add(nodeDist.eq(succDist.add(1)));
    } else {
      const succConstraints = succs.map((s) => {
        const succDist = dist.get(s)!;
        return nodeDist.eq(succDist.add(1));
      });
      solver.add(ctx.Or(...succConstraints));
    }
  }

  // All distances non-negative
  for (const node of graph.nodes) {
    const nodeDist = dist.get(node.id)!;
    solver.add(ctx.GE(nodeDist, ctx.Int.val(0)));
  }

  const result = await solver.check();

  if (result === "unsat") {
    return {
      verified: false,
      counterexample: "Not all paths reach an end node",
      details: { deadEndNodes: [] },
    };
  }

  return { verified: true };
}
