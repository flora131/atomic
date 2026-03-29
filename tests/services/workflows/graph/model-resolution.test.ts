import { describe, expect, test } from "bun:test";
import { resolveNodeModel } from "@/services/workflows/graph/runtime/model-resolution.ts";
import type {
  BaseState,
  NodeDefinition,
  ExecutionContext,
  GraphConfig,
} from "@/services/workflows/graph/types.ts";

function makeNode(model?: string): NodeDefinition<BaseState> {
  return {
    id: "test_node",
    type: "agent",
    model,
    execute: async () => ({}),
  };
}

function makeConfig(defaultModel?: string): GraphConfig<BaseState> {
  return { defaultModel };
}

function makeParentContext(model?: string): ExecutionContext<BaseState> {
  return {
    state: { executionId: "exec_1", lastUpdated: "", outputs: {} },
    config: {},
    errors: [],
    model,
  };
}

describe("resolveNodeModel", () => {
  test("returns explicit node model", () => {
    const result = resolveNodeModel(
      makeNode("gpt-4"),
      makeConfig("fallback"),
      makeParentContext("parent"),
    );
    expect(result).toBe("gpt-4");
  });

  test("returns undefined when node model is undefined and no fallbacks", () => {
    const result = resolveNodeModel(makeNode(undefined), makeConfig(), undefined);
    expect(result).toBeUndefined();
  });

  test("inherit falls through to parent context model", () => {
    const result = resolveNodeModel(
      makeNode("inherit"),
      makeConfig("config-model"),
      makeParentContext("parent-model"),
    );
    expect(result).toBe("parent-model");
  });

  test("undefined node model falls through to parent context model", () => {
    const result = resolveNodeModel(
      makeNode(undefined),
      makeConfig("config-model"),
      makeParentContext("parent-model"),
    );
    expect(result).toBe("parent-model");
  });

  test("falls through to config defaultModel when no parent context", () => {
    const result = resolveNodeModel(
      makeNode(undefined),
      makeConfig("config-model"),
      undefined,
    );
    expect(result).toBe("config-model");
  });

  test("inherit in config defaultModel is ignored", () => {
    const result = resolveNodeModel(
      makeNode(undefined),
      makeConfig("inherit"),
      undefined,
    );
    expect(result).toBeUndefined();
  });

  test("node model takes precedence over parent and config", () => {
    const result = resolveNodeModel(
      makeNode("node-model"),
      makeConfig("config-model"),
      makeParentContext("parent-model"),
    );
    expect(result).toBe("node-model");
  });

  test("parent model takes precedence over config", () => {
    const result = resolveNodeModel(
      makeNode(undefined),
      makeConfig("config-model"),
      makeParentContext("parent-model"),
    );
    expect(result).toBe("parent-model");
  });

  test("returns undefined when all levels are undefined", () => {
    const result = resolveNodeModel(
      makeNode(undefined),
      makeConfig(undefined),
      makeParentContext(undefined),
    );
    expect(result).toBeUndefined();
  });
});
