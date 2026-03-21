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
  PropertyResult,
} from "@/services/workflows/verification/types.ts";
import { encodeGraph as defaultEncodeGraph } from "@/services/workflows/verification/graph-encoder.ts";
import { checkReachability as defaultCheckReachability } from "@/services/workflows/verification/reachability.ts";
import { checkTermination as defaultCheckTermination } from "@/services/workflows/verification/termination.ts";
import { checkDeadlockFreedom as defaultCheckDeadlockFreedom } from "@/services/workflows/verification/deadlock-freedom.ts";
import { checkLoopBounds as defaultCheckLoopBounds } from "@/services/workflows/verification/loop-bounds.ts";
import { checkStateDataFlow as defaultCheckStateDataFlow } from "@/services/workflows/verification/state-data-flow.ts";

/** Property checker function signature. */
type PropertyChecker = (graph: EncodedGraph) => Promise<PropertyResult>;

/**
 * Injectable property checkers for testing.
 * Production code uses the defaults; tests can substitute mock checkers
 * without polluting the global module registry.
 */
export interface PropertyCheckers {
  checkReachability: PropertyChecker;
  checkTermination: PropertyChecker;
  checkDeadlockFreedom: PropertyChecker;
  checkLoopBounds: PropertyChecker;
  checkStateDataFlow: PropertyChecker;
}

/** Default production checkers. */
const DEFAULT_CHECKERS: PropertyCheckers = {
  checkReachability: defaultCheckReachability,
  checkTermination: defaultCheckTermination,
  checkDeadlockFreedom: defaultCheckDeadlockFreedom,
  checkLoopBounds: defaultCheckLoopBounds,
  checkStateDataFlow: defaultCheckStateDataFlow,
};

/** Options for workflow verification. */
export interface VerifyWorkflowOptions {
  /** Pre-encoded graph (skips encodeGraph). */
  encodedGraph?: EncodedGraph;
  /** Override property checkers (for testing). */
  checkers?: Partial<PropertyCheckers>;
}

/**
 * Verify structural properties of a compiled workflow graph.
 *
 * Runs all 5 property checks and returns an aggregate result.
 * Properties checked:
 * 1. Reachability - all nodes reachable from start
 * 2. Termination - all paths reach an end node
 * 3. Deadlock-freedom - no non-end node can get stuck
 * 4. Loop bounds - all loops have bounded iterations
 * 5. State data-flow - all reads have preceding writes on all paths
 *
 * @param graph - The compiled graph to verify
 * @param options - Optional verification options (pre-encoded graph, custom checkers)
 * @returns VerificationResult with per-property results
 */
export async function verifyWorkflow(
  graph: CompiledGraph<BaseState>,
  options?: VerifyWorkflowOptions,
): Promise<VerificationResult> {
  const encoded = options?.encodedGraph ?? defaultEncodeGraph(graph);
  const checkers = { ...DEFAULT_CHECKERS, ...options?.checkers };

  const [reachability, termination, deadlockFreedom, loopBounds, stateDataFlow] =
    await Promise.all([
      checkers.checkReachability(encoded),
      checkers.checkTermination(encoded),
      checkers.checkDeadlockFreedom(encoded),
      checkers.checkLoopBounds(encoded),
      checkers.checkStateDataFlow(encoded),
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
