import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { SchemaValidationError } from "./errors.ts";
import { StateValidator } from "./state-validator.ts";
import type { BaseState, GraphConfig } from "./types.ts";

interface TestState extends BaseState {
  counter?: number;
  messages?: string[];
}

const testStateSchema: z.ZodType<TestState> = z.object({
  executionId: z.string(),
  lastUpdated: z.string(),
  outputs: z.record(z.string(), z.unknown()),
  counter: z.number().optional(),
  messages: z.array(z.string()).optional(),
});

describe("StateValidator", () => {
  test("returns state unchanged when no schema is configured", () => {
    const validator = new StateValidator<TestState>();
    const state: TestState = {
      executionId: "exec-1",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      outputs: {},
      counter: 1,
    };

    expect(validator.validate(state)).toBe(state);
  });

  test("accepts valid state when schema is configured", () => {
    const validator = new StateValidator<TestState>({ outputSchema: testStateSchema });
    const state: TestState = {
      executionId: "exec-1",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      outputs: {},
      counter: 1,
    };

    const result = validator.validate(state);
    expect(result).toEqual(state);
  });

  test("throws SchemaValidationError for invalid state", () => {
    const validator = new StateValidator<TestState>({
      outputSchema: testStateSchema.refine(
        (state) => state.counter === undefined || state.counter >= 2,
        { message: "counter must be >= 2", path: ["counter"] }
      ),
    });
    const invalidState: TestState = {
      executionId: "exec-1",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      outputs: {},
      counter: 1,
    };

    expect(() => validator.validate(invalidState)).toThrow(SchemaValidationError);
    expect(() => validator.validate(invalidState)).toThrow(
      "State validation failed: counter: counter must be >= 2"
    );
  });

  test("validates node input schemas", () => {
    const validator = new StateValidator<TestState>();
    const inputSchema = testStateSchema.refine(
      (state) => state.counter === undefined || state.counter >= 2,
      { message: "counter must be >= 2", path: ["counter"] }
    );
    const invalidState: TestState = {
      executionId: "exec-1",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      outputs: {},
      counter: 1,
    };

    expect(() => validator.validateNodeInput("node-a", invalidState, inputSchema)).toThrow(
      SchemaValidationError
    );
    expect(() => validator.validateNodeInput("node-a", invalidState, inputSchema)).toThrow(
      'Node "node-a" input validation failed: counter: counter must be >= 2'
    );
  });

  test("returns validated state for valid node input", () => {
    const validator = new StateValidator<TestState>();
    const inputSchema = testStateSchema.refine(
      (state) => state.counter === undefined || state.counter >= 2,
      { message: "counter must be >= 2", path: ["counter"] }
    );
    const validState: TestState = {
      executionId: "exec-1",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      outputs: {},
      counter: 2,
    };

    expect(validator.validateNodeInput("node-a", validState, inputSchema)).toEqual(validState);
  });

  test("validates node output schemas", () => {
    const validator = new StateValidator<TestState>();
    const outputSchema = testStateSchema.refine(
      (state) => state.counter === undefined || state.counter >= 2,
      { message: "counter must be >= 2", path: ["counter"] }
    );
    const invalidState: TestState = {
      executionId: "exec-1",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      outputs: {},
      counter: 1,
    };

    expect(() => validator.validateNodeOutput("node-b", invalidState, outputSchema)).toThrow(
      SchemaValidationError
    );
    expect(() => validator.validateNodeOutput("node-b", invalidState, outputSchema)).toThrow(
      'Node "node-b" output validation failed: counter: counter must be >= 2'
    );
  });

  test("returns validated state for valid node output", () => {
    const validator = new StateValidator<TestState>();
    const outputSchema = testStateSchema.refine(
      (state) => state.counter === undefined || state.counter >= 2,
      { message: "counter must be >= 2", path: ["counter"] }
    );
    const validState: TestState = {
      executionId: "exec-1",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      outputs: {},
      counter: 3,
    };

    expect(validator.validateNodeOutput("node-b", validState, outputSchema)).toEqual(validState);
  });

  test("creates a validator from GraphConfig", () => {
    const config: GraphConfig<TestState> = {
      outputSchema: testStateSchema,
    };
    const validator = StateValidator.fromGraphConfig(config);
    const state: TestState = {
      executionId: "exec-1",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      outputs: {},
    };

    expect(validator.validate(state)).toEqual(state);
  });
});
