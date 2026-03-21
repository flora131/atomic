/**
 * Loop Bounds Verification
 *
 * Property 4: Every loop has a declared maxIterations > 0.
 *
 * Since loops are compiler-generated with a required maxIterations field,
 * this check validates that the metadata is present and positive.
 * The conductor enforces the bound at runtime via step counting.
 */

import type {
  EncodedGraph,
  PropertyResult,
} from "@/services/workflows/verification/types.ts";

export async function checkLoopBounds(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  if (graph.loops.length === 0) {
    return { verified: true };
  }

  const unboundedLoops: Array<{ entryNode: string; maxIterations: number }> = [];

  for (const loop of graph.loops) {
    if (loop.maxIterations <= 0) {
      unboundedLoops.push({
        entryNode: loop.entryNode,
        maxIterations: loop.maxIterations,
      });
    }
  }

  if (unboundedLoops.length > 0) {
    const loopDescs = unboundedLoops
      .map((l) => `loop at "${l.entryNode}" (maxIterations=${l.maxIterations})`)
      .join(", ");
    return {
      verified: false,
      counterexample: `Unbounded loops detected: ${loopDescs}`,
      details: { unboundedLoops },
    };
  }

  return { verified: true };
}
