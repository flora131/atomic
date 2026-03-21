/**
 * Z3 Workflow Verifier
 *
 * Orchestrates all 5 structural property checks on a compiled workflow graph.
 * Verification is mandatory — all workflows must pass before registration.
 */

import type {
  BaseState,
  CompiledGraph,
} from "@/services/workflows/graph/types.ts";
import type {
  VerificationResult,
  EncodedGraph,
} from "@/services/workflows/verification/types.ts";
import { encodeGraph } from "@/services/workflows/verification/graph-encoder.ts";
import { checkReachability } from "@/services/workflows/verification/reachability.ts";
import { checkTermination } from "@/services/workflows/verification/termination.ts";
import { checkDeadlockFreedom } from "@/services/workflows/verification/deadlock-freedom.ts";
import { checkLoopBounds } from "@/services/workflows/verification/loop-bounds.ts";
import { checkStateDataFlow } from "@/services/workflows/verification/state-data-flow.ts";

/**
 * Verify structural properties of a compiled workflow graph.
 *
 * Runs all 5 property checks and returns an aggregate result.
 * Properties checked:
 * 1. Reachability — all nodes reachable from start
 * 2. Termination — all paths reach an end node
 * 3. Deadlock-freedom — no non-end node can get stuck
 * 4. Loop bounds — all loops have bounded iterations
 * 5. State data-flow — all reads have preceding writes on all paths
 *
 * @param graph - The compiled graph to verify
 * @param encodedGraph - Optional pre-encoded graph (for testing). If not provided, encodeGraph() is called.
 * @returns VerificationResult with per-property results
 */
export async function verifyWorkflow(
  graph: CompiledGraph<BaseState>,
  encodedGraph?: EncodedGraph,
): Promise<VerificationResult> {
  const encoded = encodedGraph ?? encodeGraph(graph);

  // Run all property checks in parallel
  const [reachability, termination, deadlockFreedom, loopBounds, stateDataFlow] =
    await Promise.all([
      checkReachability(encoded),
      checkTermination(encoded),
      checkDeadlockFreedom(encoded),
      checkLoopBounds(encoded),
      checkStateDataFlow(encoded),
    ]);

  const valid =
    reachability.verified &&
    termination.verified &&
    deadlockFreedom.verified &&
    loopBounds.verified &&
    stateDataFlow.verified;

  return {
    valid,
    properties: {
      reachability,
      termination,
      deadlockFreedom,
      loopBounds,
      stateDataFlow,
    },
  };
}
