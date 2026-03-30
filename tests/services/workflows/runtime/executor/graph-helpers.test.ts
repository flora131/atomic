import { describe, expect, test } from "bun:test";
import {
  inferHasSubagentNodes,
  inferHasTaskList,
} from "@/services/workflows/runtime/executor/graph-helpers.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import type { CompiledGraph, GraphConfig, NodeDefinition } from "@/services/workflows/graph/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: NodeDefinition<BaseState>["type"] = "agent",
): NodeDefinition<BaseState> {
  return { id, type, execute: async () => ({}) };
}

function makeCompiledGraph(
  nodeMap: Map<string, NodeDefinition<BaseState>>,
  config: GraphConfig<BaseState> = {},
): CompiledGraph<BaseState> {
  return {
    nodes: nodeMap,
    edges: [],
    startNode: nodeMap.keys().next().value ?? "start",
    endNodes: new Set<string>(),
    config,
  };
}

// ---------------------------------------------------------------------------
// inferHasSubagentNodes
// ---------------------------------------------------------------------------

describe("inferHasSubagentNodes", () => {
  test("returns true when a node has type 'agent'", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["myAgent", makeNode("myAgent", "agent")],
    ]);
    const compiled = makeCompiledGraph(nodeMap);

    expect(inferHasSubagentNodes(compiled)).toBe(true);
  });

  test("returns true when a node id contains 'subagent'", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["run-subagent-task", makeNode("run-subagent-task", "tool")],
    ]);
    const compiled = makeCompiledGraph(nodeMap);

    expect(inferHasSubagentNodes(compiled)).toBe(true);
  });

  test("returns true when node id is exactly 'subagent'", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["subagent", makeNode("subagent", "tool")],
    ]);
    const compiled = makeCompiledGraph(nodeMap);

    expect(inferHasSubagentNodes(compiled)).toBe(true);
  });

  test("returns false when no node has type 'agent' and no id contains 'subagent'", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["decision1", makeNode("decision1", "decision")],
      ["tool1", makeNode("tool1", "tool")],
      ["wait1", makeNode("wait1", "wait")],
    ]);
    const compiled = makeCompiledGraph(nodeMap);

    expect(inferHasSubagentNodes(compiled)).toBe(false);
  });

  test("returns false for empty graph", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>();
    const compiled = makeCompiledGraph(nodeMap);

    expect(inferHasSubagentNodes(compiled)).toBe(false);
  });

  test("returns true when one of multiple nodes is type 'agent'", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["step1", makeNode("step1", "tool")],
      ["step2", makeNode("step2", "agent")],
      ["step3", makeNode("step3", "decision")],
    ]);
    const compiled = makeCompiledGraph(nodeMap);

    expect(inferHasSubagentNodes(compiled)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// inferHasTaskList
// ---------------------------------------------------------------------------

describe("inferHasTaskList", () => {
  test("returns true when config.metadata.hasTaskList is true", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["a", makeNode("a")],
    ]);
    const config: GraphConfig<BaseState> = { metadata: { hasTaskList: true } };
    const compiled = makeCompiledGraph(nodeMap, config);

    expect(inferHasTaskList(compiled)).toBe(true);
  });

  test("returns false when config.metadata.hasTaskList is false", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["a", makeNode("a")],
    ]);
    const config: GraphConfig<BaseState> = { metadata: { hasTaskList: false } };
    const compiled = makeCompiledGraph(nodeMap, config);

    expect(inferHasTaskList(compiled)).toBe(false);
  });

  test("returns false when config.metadata is undefined", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["a", makeNode("a")],
    ]);
    const config: GraphConfig<BaseState> = {};
    const compiled = makeCompiledGraph(nodeMap, config);

    expect(inferHasTaskList(compiled)).toBe(false);
  });

  test("returns false when metadata exists but hasTaskList is not set", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["a", makeNode("a")],
    ]);
    const config: GraphConfig<BaseState> = { metadata: { otherField: "value" } };
    const compiled = makeCompiledGraph(nodeMap, config);

    expect(inferHasTaskList(compiled)).toBe(false);
  });

  test("returns false when hasTaskList is a truthy non-boolean value", () => {
    const nodeMap = new Map<string, NodeDefinition<BaseState>>([
      ["a", makeNode("a")],
    ]);
    const config: GraphConfig<BaseState> = { metadata: { hasTaskList: "yes" } };
    const compiled = makeCompiledGraph(nodeMap, config);

    // Strict equality: "yes" === true is false
    expect(inferHasTaskList(compiled)).toBe(false);
  });
});
