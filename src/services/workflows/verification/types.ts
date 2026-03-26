/**
 * Workflow Verification Types
 *
 * Type definitions for the formal verification engine.
 * The verifier checks structural properties of compiled workflow graphs:
 * reachability, termination, deadlock-freedom, loop bounds, and state data-flow.
 */

/** Result of verifying a single structural property. */
export interface PropertyResult {
  /** Whether this property was successfully verified. */
  verified: boolean;
  /** Human-readable description of the violation (when not verified). */
  counterexample?: string;
  /** Additional structured details (e.g., unreachable node IDs). */
  details?: Record<string, unknown>;
}

/** Aggregate result of all property verifications for a workflow. */
export interface VerificationResult {
  /** True only when ALL properties are verified. */
  valid: boolean;
  /** Per-property verification results. */
  properties: {
    reachability: PropertyResult;
    termination: PropertyResult;
    deadlockFreedom: PropertyResult;
    loopBounds: PropertyResult;
    stateDataFlow: PropertyResult;
    modelValidation?: PropertyResult;
    typeChecking?: PropertyResult;
  };
}

/** Error thrown when a workflow fails verification. */
export class WorkflowVerificationError extends Error {
  readonly result: VerificationResult;
  readonly workflowId: string;

  constructor(workflowId: string, result: VerificationResult) {
    const failedProps = Object.entries(result.properties)
      .filter(([, prop]) => prop !== undefined && !prop.verified)
      .map(([name]) => name);
    super(
      `Workflow "${workflowId}" failed verification: ${failedProps.join(", ")}`,
    );
    this.name = "WorkflowVerificationError";
    this.result = result;
    this.workflowId = workflowId;
  }
}

/**
 * Node metadata extracted from a CompiledGraph for verification.
 * Used by the graph encoder to build verification constraints.
 */
export interface VerificationNode {
  id: string;
  type: string;
  reads?: string[];
  outputs?: string[];
}

/**
 * Edge metadata extracted from a CompiledGraph for verification.
 * Used by the graph encoder to build verification constraints.
 */
export interface VerificationEdge {
  from: string;
  to: string;
  hasCondition: boolean;
  /** Group ID for edges from the same if/elseIf/else block */
  conditionGroup?: string;
}

/**
 * Loop metadata extracted from the graph for verification.
 */
export interface VerificationLoop {
  /** Entry node of the loop */
  entryNode: string;
  /** Exit node of the loop */
  exitNode: string;
  /** Maximum iterations declared */
  maxIterations: number;
  /** Node IDs within the loop body */
  bodyNodes: string[];
}

/**
 * Encoded graph representation ready for constraint generation.
 */
export interface EncodedGraph {
  nodes: VerificationNode[];
  edges: VerificationEdge[];
  startNode: string;
  endNodes: string[];
  loops: VerificationLoop[];
  stateFields: string[];
}
