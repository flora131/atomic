import { describe, expect, test } from "bun:test";
import { ZodError, z } from "zod";
import {
  SchemaValidationError,
  NodeExecutionError,
} from "@/services/workflows/graph/errors.ts";
import type { ErrorFeedback } from "@/services/workflows/graph/errors.ts";

describe("SchemaValidationError", () => {
  function makeZodError(): ZodError {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 42 });
    if (result.success) throw new Error("Expected ZodError");
    return result.error;
  }

  test("is an instance of Error", () => {
    const zodError = makeZodError();
    const err = new SchemaValidationError("bad input", zodError);
    expect(err).toBeInstanceOf(Error);
  });

  test("has name SchemaValidationError", () => {
    const zodError = makeZodError();
    const err = new SchemaValidationError("bad input", zodError);
    expect(err.name).toBe("SchemaValidationError");
  });

  test("stores the ZodError", () => {
    const zodError = makeZodError();
    const err = new SchemaValidationError("bad input", zodError);
    expect(err.zodError).toBe(zodError);
  });

  test("preserves the message", () => {
    const zodError = makeZodError();
    const err = new SchemaValidationError("custom message", zodError);
    expect(err.message).toBe("custom message");
  });

  test("can be caught as Error", () => {
    const zodError = makeZodError();
    try {
      throw new SchemaValidationError("fail", zodError);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as SchemaValidationError).zodError).toBe(zodError);
    }
  });
});

describe("NodeExecutionError", () => {
  test("is an instance of Error", () => {
    const err = new NodeExecutionError("node failed", "node_1");
    expect(err).toBeInstanceOf(Error);
  });

  test("has name NodeExecutionError", () => {
    const err = new NodeExecutionError("node failed", "node_1");
    expect(err.name).toBe("NodeExecutionError");
  });

  test("stores the nodeId", () => {
    const err = new NodeExecutionError("node failed", "my_node");
    expect(err.nodeId).toBe("my_node");
  });

  test("stores the cause when provided", () => {
    const cause = new Error("root cause");
    const err = new NodeExecutionError("node failed", "node_1", cause);
    expect(err.cause).toBe(cause);
  });

  test("preserves the message", () => {
    const err = new NodeExecutionError("custom msg", "node_1");
    expect(err.message).toBe("custom msg");
  });

  test("cause is undefined when not provided", () => {
    const err = new NodeExecutionError("node failed", "node_1");
    expect(err.cause).toBeUndefined();
  });
});

describe("ErrorFeedback interface", () => {
  test("accepts a valid ErrorFeedback object", () => {
    const feedback: ErrorFeedback = {
      failedNodeId: "node_1",
      errorMessage: "validation error",
      errorType: "SchemaValidationError",
      attempt: 1,
      maxAttempts: 3,
    };
    expect(feedback.failedNodeId).toBe("node_1");
    expect(feedback.attempt).toBe(1);
  });

  test("accepts optional previousOutput field", () => {
    const feedback: ErrorFeedback = {
      failedNodeId: "node_1",
      errorMessage: "runtime error",
      errorType: "NodeExecutionError",
      attempt: 2,
      maxAttempts: 3,
      previousOutput: { result: "bad data" },
    };
    expect(feedback.previousOutput).toEqual({ result: "bad data" });
  });
});
