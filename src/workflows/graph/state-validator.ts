import type { z } from "zod";

import { SchemaValidationError } from "./errors.ts";
import type { BaseState, GraphConfig, NodeId } from "./types.ts";

/**
 * Runtime validation options used by {@link StateValidator}.
 */
export interface StateValidatorConfig<TState extends BaseState = BaseState> {
  outputSchema?: z.ZodType<TState>;
}

function formatValidationIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>
): string {
  return issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Validates graph state against node and graph output schemas.
 */
export class StateValidator<TState extends BaseState = BaseState> {
  constructor(private readonly config: StateValidatorConfig<TState> = {}) {}

  validateNodeInput(nodeId: NodeId, state: TState, inputSchema?: z.ZodType<TState>): TState {
    if (!inputSchema) {
      return state;
    }

    const parsed = inputSchema.safeParse(state);
    if (!parsed.success) {
      throw new SchemaValidationError(
        `Node "${nodeId}" input validation failed: ${formatValidationIssues(parsed.error.issues)}`,
        parsed.error
      );
    }

    return parsed.data;
  }

  validateNodeOutput(nodeId: NodeId, state: TState, outputSchema?: z.ZodType<TState>): TState {
    if (!outputSchema) {
      return state;
    }

    const parsed = outputSchema.safeParse(state);
    if (!parsed.success) {
      throw new SchemaValidationError(
        `Node "${nodeId}" output validation failed: ${formatValidationIssues(parsed.error.issues)}`,
        parsed.error
      );
    }

    return parsed.data;
  }

  validate(state: TState): TState {
    if (!this.config.outputSchema) {
      return state;
    }

    const parsed = this.config.outputSchema.safeParse(state);
    if (!parsed.success) {
      throw new SchemaValidationError(
        `State validation failed: ${formatValidationIssues(parsed.error.issues)}`,
        parsed.error
      );
    }

    return parsed.data;
  }

  static fromGraphConfig<TState extends BaseState>(
    config: GraphConfig<TState>
  ): StateValidator<TState> {
    return new StateValidator<TState>({ outputSchema: config.outputSchema });
  }
}
