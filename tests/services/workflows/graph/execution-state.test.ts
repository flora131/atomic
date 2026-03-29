import { describe, expect, test } from "bun:test";
import {
  generateExecutionId,
  executionNow,
  isLoopNode,
  initializeExecutionState,
  mergeState,
} from "@/services/workflows/graph/runtime/execution-state.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";

describe("generateExecutionId", () => {
  test("starts with exec_ prefix", () => {
    const id = generateExecutionId();
    expect(id.startsWith("exec_")).toBe(true);
  });

  test("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateExecutionId()));
    expect(ids.size).toBe(20);
  });

  test("contains a timestamp component", () => {
    const before = Date.now();
    const id = generateExecutionId();
    const after = Date.now();

    const parts = id.split("_");
    const timestamp = Number(parts[1]);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe("executionNow", () => {
  test("returns an ISO 8601 string", () => {
    const now = executionNow();
    expect(() => new Date(now)).not.toThrow();
    expect(new Date(now).toISOString()).toBe(now);
  });
});

describe("isLoopNode", () => {
  test("returns true for loop_start nodes", () => {
    expect(isLoopNode("my_loop_start")).toBe(true);
  });

  test("returns true for loop_check nodes", () => {
    expect(isLoopNode("check_loop_check")).toBe(true);
  });

  test("returns false for non-loop nodes", () => {
    expect(isLoopNode("agent_1")).toBe(false);
    expect(isLoopNode("decision_node")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isLoopNode("")).toBe(false);
  });

  test("returns false for substring that does not match", () => {
    expect(isLoopNode("loop")).toBe(false);
    expect(isLoopNode("start_loop")).toBe(false);
  });
});

describe("initializeExecutionState", () => {
  test("creates state with the provided executionId", () => {
    const state = initializeExecutionState("exec_123");
    expect(state.executionId).toBe("exec_123");
  });

  test("initializes empty outputs", () => {
    const state = initializeExecutionState("exec_123");
    expect(state.outputs).toEqual({});
  });

  test("sets lastUpdated to a valid ISO timestamp", () => {
    const state = initializeExecutionState("exec_123");
    expect(() => new Date(state.lastUpdated)).not.toThrow();
  });

  test("merges initial state overrides", () => {
    interface TestState extends BaseState {
      counter: number;
    }
    const state = initializeExecutionState<TestState>("exec_123", {
      counter: 42,
    });
    expect(state.counter).toBe(42);
  });

  test("merges outputs from initial overrides", () => {
    const state = initializeExecutionState("exec_123", {
      outputs: { node_1: "result" },
    });
    expect(state.outputs.node_1).toBe("result");
  });

  test("executionId parameter takes precedence over initial override", () => {
    const state = initializeExecutionState("exec_999", {
      executionId: "exec_override",
    });
    expect(state.executionId).toBe("exec_999");
  });
});

describe("mergeState", () => {
  test("merges update into current state", () => {
    interface TestState extends BaseState {
      counter: number;
    }
    const current: TestState = {
      executionId: "exec_1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: {},
      counter: 1,
    };

    const merged = mergeState(current, { counter: 2 });
    expect(merged.counter).toBe(2);
    expect(merged.executionId).toBe("exec_1");
  });

  test("updates lastUpdated on merge", () => {
    const current: BaseState = {
      executionId: "exec_1",
      lastUpdated: "2000-01-01T00:00:00.000Z",
      outputs: {},
    };

    const merged = mergeState(current, {});
    expect(merged.lastUpdated).not.toBe("2000-01-01T00:00:00.000Z");
  });

  test("merges outputs when update contains outputs", () => {
    const current: BaseState = {
      executionId: "exec_1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: { a: 1 },
    };

    const merged = mergeState(current, { outputs: { b: 2 } });
    expect(merged.outputs).toEqual({ a: 1, b: 2 });
  });

  test("preserves existing outputs when update has no outputs", () => {
    const current: BaseState = {
      executionId: "exec_1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: { a: 1, b: 2 },
    };

    const merged = mergeState(current, {});
    expect(merged.outputs).toEqual({ a: 1, b: 2 });
  });

  test("does not mutate the original state", () => {
    const current: BaseState = {
      executionId: "exec_1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: { a: 1 },
    };

    const originalOutputs = { ...current.outputs };
    mergeState(current, { outputs: { b: 2 } });

    expect(current.outputs).toEqual(originalOutputs);
  });
});
