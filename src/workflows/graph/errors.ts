/**
 * Graph Execution Error Types
 *
 * Custom error classes for graph node execution failures.
 * Both error types trigger the ancestor agent retry mechanism:
 * - SchemaValidationError: Input contract violation (args don't match Zod schema)
 * - NodeExecutionError: Runtime failures from tool handlers or sub-agents
 */

import type { ZodError } from "zod";

/**
 * Thrown when a node's input fails Zod schema validation.
 * Triggers ancestor agent retry so the LLM can re-generate conforming output.
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: ZodError,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/**
 * Wraps runtime failures from tool handlers and sub-agent execution.
 * Triggers ancestor agent retry with structured error context.
 */
export class NodeExecutionError extends Error {
  constructor(
    message: string,
    public readonly nodeId: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = "NodeExecutionError";
  }
}

/**
 * Error feedback injected into ancestor agent context on downstream failure.
 */
export interface ErrorFeedback {
  /** The node that failed */
  failedNodeId: string;
  /** The error message from the failed node */
  errorMessage: string;
  /** The error type (e.g., "SchemaValidationError", "NodeExecutionError") */
  errorType: string;
  /** Which retry attempt this is (1-indexed) */
  attempt: number;
  /** Max attempts before workflow failure */
  maxAttempts: number;
  /** The output the agent produced that led to the failure (if available) */
  previousOutput?: unknown;
}
