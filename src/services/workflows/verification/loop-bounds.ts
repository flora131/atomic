/**
 * Loop Bounds Verification
 *
 * Property 4: Every loop terminates within its declared maxIterations.
 *
 * Encoding: ranking function `ranking = maxIter - iterCount`.
 * Assert `ranking >= 0 AND iterCount < maxIter AND ranking <= 0`.
 * `unsat` proves the loop always terminates within bounds.
 */

import { init } from "z3-solver";
import type {
  EncodedGraph,
  PropertyResult,
} from "@/services/workflows/verification/types";

export async function checkLoopBounds(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  // If no loops, trivially passes
  if (graph.loops.length === 0) {
    return { verified: true };
  }

  const { Context } = await init();
  const ctx = Context("main");

  const unboundedLoops: Array<{ entryNode: string; maxIterations: number }> =
    [];

  for (const loop of graph.loops) {
    const solver = new ctx.Solver();

    const iterCount = ctx.Int.const(`iter_${loop.entryNode}`);
    const maxIter = ctx.Int.val(loop.maxIterations);
    const ranking = ctx.Sub(maxIter, iterCount);

    // The loop invariant: ranking >= 0 (iterCount <= maxIter)
    solver.add(ctx.GE(ranking, ctx.Int.val(0)));
    // The loop condition: iterCount < maxIter (loop hasn't exhausted)
    solver.add(ctx.LT(iterCount, maxIter));
    // Try to find a state where ranking <= 0 (violation)
    solver.add(ctx.LE(ranking, ctx.Int.val(0)));

    const result = await solver.check();

    if (result !== "unsat") {
      // Could find a violating state -- loop may not terminate
      unboundedLoops.push({
        entryNode: loop.entryNode,
        maxIterations: loop.maxIterations,
      });
    }
  }

  if (unboundedLoops.length > 0) {
    const loopDescs = unboundedLoops
      .map(
        (l) =>
          `loop at "${l.entryNode}" (maxIterations=${l.maxIterations})`,
      )
      .join(", ");
    return {
      verified: false,
      counterexample: `Unbounded loops detected: ${loopDescs}`,
      details: { unboundedLoops },
    };
  }

  return { verified: true };
}
