import { describe, expect, test } from "bun:test";
import { executeGraph } from "@/services/workflows/graph/compiled.ts";
import { createNode, graph } from "@/services/workflows/graph/builder.ts";
import { SchemaValidationError } from "@/services/workflows/graph/errors.ts";
import { testStateSchema, type TestState } from "./compiled.fixtures.ts";

describe("GraphExecutor - State Validation", () => {
  test("accepts execution when node inputSchema is satisfied", async () => {
    const node = createNode<TestState>(
      "validated-input",
      "tool",
      async (ctx) => {
        return { stateUpdate: { counter: (ctx.state.counter ?? 0) + 1 } };
      },
      {
        inputSchema: testStateSchema.refine(
          (state) => typeof state.counter === "number" && state.counter >= 1,
          { message: "counter must be >= 1", path: ["counter"] },
        ),
      },
    );

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow, { initialState: { counter: 1 } });

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(2);
  });

  test("fails execution when node inputSchema is violated", async () => {
    let executed = false;

    const node = createNode<TestState>(
      "invalid-input",
      "tool",
      async () => {
        executed = true;
        return { stateUpdate: { counter: 5 } };
      },
      {
        inputSchema: testStateSchema.refine(
          (state) => typeof state.counter === "number" && state.counter >= 1,
          { message: "counter must be >= 1", path: ["counter"] },
        ),
        retry: {
          maxAttempts: 1,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
      },
    );

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(executed).toBe(false);
    expect(result.snapshot.errors[0]?.error).toBeInstanceOf(SchemaValidationError);
  });

  test("fails execution when node outputSchema is violated", async () => {
    const node = createNode<TestState>(
      "invalid-node-output",
      "tool",
      async () => {
        return { stateUpdate: { counter: 1 } };
      },
      {
        outputSchema: testStateSchema.refine(
          (state) => state.counter === undefined || state.counter >= 2,
          { message: "counter must be >= 2", path: ["counter"] },
        ),
        retry: {
          maxAttempts: 1,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
      },
    );

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(result.snapshot.errors[0]?.error).toBeInstanceOf(SchemaValidationError);
  });

  test("accepts valid state updates when outputSchema is configured", async () => {
    const node = createNode<TestState>("valid", "tool", async () => {
      return { stateUpdate: { counter: 2 } };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile({ outputSchema: testStateSchema });

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(2);
  });

  test("fails execution when state update violates outputSchema", async () => {
    const node = createNode<TestState>(
      "invalid",
      "tool",
      async () => {
        return { stateUpdate: { counter: 1 } };
      },
      {
        retry: {
          maxAttempts: 1,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
      },
    );

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile({
        outputSchema: testStateSchema.refine(
          (state) => state.counter === undefined || state.counter >= 2,
          { message: "counter must be >= 2", path: ["counter"] },
        ),
      });

    const result = await executeGraph(workflow);

    expect(result.status).toBe("failed");
    expect(result.snapshot.errors[0]?.error).toBeInstanceOf(SchemaValidationError);
  });
});
