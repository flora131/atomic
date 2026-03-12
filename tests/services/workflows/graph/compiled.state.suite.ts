import { describe, expect, test } from "bun:test";
import {
  initializeExecutionState,
  mergeState,
} from "@/services/workflows/graph/compiled.ts";
import type { TestState } from "./compiled.fixtures.ts";

describe("initializeExecutionState", () => {
  test("creates a new state with executionId and timestamp", () => {
    const executionId = "test-exec-123";
    const state = initializeExecutionState<TestState>(executionId);

    expect(state.executionId).toBe(executionId);
    expect(state.lastUpdated).toBeDefined();
    expect(state.outputs).toEqual({});
  });

  test("merges initial state values", () => {
    const executionId = "test-exec-123";
    const initial: Partial<TestState> = {
      counter: 42,
      messages: ["hello"],
    };

    const state = initializeExecutionState<TestState>(executionId, initial);

    expect(state.executionId).toBe(executionId);
    expect(state.counter).toBe(42);
    expect(state.messages).toEqual(["hello"]);
    expect(state.outputs).toEqual({});
  });

  test("preserves initial outputs and merges with base", () => {
    const executionId = "test-exec-123";
    const initial: Partial<TestState> = {
      outputs: { node1: "value1" },
    };

    const state = initializeExecutionState<TestState>(executionId, initial);

    expect(state.outputs).toEqual({ node1: "value1" });
  });

  test("does not allow overwriting executionId", () => {
    const executionId = "test-exec-123";
    const initial: Partial<TestState> = {
      executionId: "wrong-id" as string,
    };

    const state = initializeExecutionState<TestState>(executionId, initial);

    expect(state.executionId).toBe(executionId);
  });
});

describe("mergeState", () => {
  test("merges partial state updates", () => {
    const current: TestState = {
      executionId: "exec-1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: { node1: "value1" },
      counter: 10,
    };

    const update: Partial<TestState> = {
      counter: 20,
      flag: true,
    };

    const merged = mergeState(current, update);

    expect(merged.counter).toBe(20);
    expect(merged.flag).toBe(true);
    expect(merged.executionId).toBe("exec-1");
    expect(merged.outputs).toEqual({ node1: "value1" });
    expect(merged.lastUpdated).not.toBe(current.lastUpdated);
  });

  test("merges outputs correctly", () => {
    const current: TestState = {
      executionId: "exec-1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: { node1: "value1", node2: "value2" },
    };

    const update: Partial<TestState> = {
      outputs: { node2: "updated", node3: "new" },
    };

    const merged = mergeState(current, update);

    expect(merged.outputs).toEqual({
      node1: "value1",
      node2: "updated",
      node3: "new",
    });
  });

  test("updates lastUpdated timestamp", () => {
    const current: TestState = {
      executionId: "exec-1",
      lastUpdated: "2024-01-01T00:00:00.000Z",
      outputs: {},
    };

    const merged = mergeState(current, {});

    expect(merged.lastUpdated).not.toBe(current.lastUpdated);
    expect(new Date(merged.lastUpdated).getTime()).toBeGreaterThan(
      new Date(current.lastUpdated).getTime(),
    );
  });
});
