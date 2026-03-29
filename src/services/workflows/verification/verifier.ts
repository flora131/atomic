/**
 * Workflow Verifier
 *
 * Orchestrates all structural property checks, model validation,
 * and TypeScript type-checking on a compiled workflow graph.
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
import type { StageDefinition } from "@/services/workflows/conductor/types.ts";
import { encodeGraph as defaultEncodeGraph } from "@/services/workflows/verification/graph-encoder.ts";
import { checkReachability as defaultCheckReachability } from "@/services/workflows/verification/reachability.ts";
import { checkTermination as defaultCheckTermination } from "@/services/workflows/verification/termination.ts";
import { checkDeadlockFreedom as defaultCheckDeadlockFreedom } from "@/services/workflows/verification/deadlock-freedom.ts";
import { checkLoopBounds as defaultCheckLoopBounds } from "@/services/workflows/verification/loop-bounds.ts";
import { checkStateDataFlow as defaultCheckStateDataFlow } from "@/services/workflows/verification/state-data-flow.ts";
import { checkModelValidation as defaultCheckModelValidation } from "@/services/workflows/verification/model-validation.ts";

/** Property checker function signature. */
type PropertyChecker = (graph: EncodedGraph) => Promise<PropertyResult>;

/** Model validation checker function signature. */
type ModelValidationChecker = (stages: readonly StageDefinition[]) => Promise<PropertyResult>;

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
  checkModelValidation: ModelValidationChecker;
}

/** Default production checkers. */
const DEFAULT_CHECKERS: PropertyCheckers = {
  checkReachability: defaultCheckReachability,
  checkTermination: defaultCheckTermination,
  checkDeadlockFreedom: defaultCheckDeadlockFreedom,
  checkLoopBounds: defaultCheckLoopBounds,
  checkStateDataFlow: defaultCheckStateDataFlow,
  checkModelValidation: defaultCheckModelValidation,
};

/** Options for workflow verification. */
export interface VerifyWorkflowOptions {
  /** Pre-encoded graph (skips encodeGraph). */
  encodedGraph?: EncodedGraph;
  /** Override property checkers (for testing). */
  checkers?: Partial<PropertyCheckers>;
  /** Conductor stage definitions for model validation. */
  conductorStages?: readonly StageDefinition[];
}

/**
 * Verify structural properties of a compiled workflow graph.
 *
 * Runs all property checks and returns an aggregate result.
 * Properties checked:
 * 1. Reachability - all nodes reachable from start
 * 2. Termination - all paths reach an end node
 * 3. Deadlock-freedom - no non-end node can get stuck
 * 4. Loop bounds - all loops have bounded iterations
 * 5. State data-flow - all reads have preceding writes on all paths
 * 6. Model validation - all declared models and reasoning efforts exist
 *
 * @param graph - The compiled graph to verify
 * @param options - Optional verification options (pre-encoded graph, custom checkers, stages)
 * @returns VerificationResult with per-property results
 */
export async function verifyWorkflow(
  graph: CompiledGraph<BaseState>,
  options?: VerifyWorkflowOptions,
): Promise<VerificationResult> {
  const encoded = options?.encodedGraph ?? defaultEncodeGraph(graph);
  const checkers = { ...DEFAULT_CHECKERS, ...options?.checkers };
  const stages = options?.conductorStages ?? [];

  const [reachability, termination, deadlockFreedom, loopBounds, stateDataFlow, modelValidation] =
    await Promise.all([
      checkers.checkReachability(encoded),
      checkers.checkTermination(encoded),
      checkers.checkDeadlockFreedom(encoded),
      checkers.checkLoopBounds(encoded),
      checkers.checkStateDataFlow(encoded),
      stages.length > 0
        ? checkers.checkModelValidation(stages)
        : Promise.resolve({ verified: true } as PropertyResult),
    ]);

  const valid =
    reachability.verified &&
    termination.verified &&
    deadlockFreedom.verified &&
    loopBounds.verified &&
    stateDataFlow.verified &&
    modelValidation.verified;

  return {
    valid,
    properties: {
      reachability,
      termination,
      deadlockFreedom,
      loopBounds,
      stateDataFlow,
      modelValidation,
    },
  };
}
