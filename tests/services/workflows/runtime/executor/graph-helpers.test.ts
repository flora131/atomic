import { describe, expect, test } from "bun:test";
import {
  compileGraphConfig,
  inferHasSubagentNodes,
  inferHasTaskList,
} from "@/services/workflows/runtime/executor/graph-helpers.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import type { CompiledGraph, GraphConfig, NodeDefinition } from "@/services/workflows/graph/types.ts";
import type { WorkflowGraphConfig } from "@/services/workflows/types/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: NodeDefinition<BaseState>["type"] = "agent",
): NodeDefinition<BaseState> {
  return { id, type, execute: async () => ({}) };
}

function makeGraphConfig(
  nodes: NodeDefinition<BaseState>[],
  edges: WorkflowGraphConfig<BaseState>["edges"] = [],
  startNode?: string,
): WorkflowGraphConfig<BaseState> {
  return {
    nodes,
    edges,
    startNode: startNode ?? nodes[0]?.id ?? "start",
  };
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
// compileGraphConfig
// ---------------------------------------------------------------------------

describe("compileGraphConfig", () => {
  test("single node with no edges becomes an end node", () => {
    const graphConfig = makeGraphConfig([makeNode("a")]);

    const compiled = compileGraphConfig(graphConfig);

    expect(compiled.nodes.size).toBe(1);
    expect(compiled.nodes.has("a")).toBe(true);
    expect(compiled.endNodes.has("a")).toBe(true);
    expect(compiled.endNodes.size).toBe(1);
    expect(compiled.startNode).toBe("a");
  });

  test("multiple nodes with chain edges marks only terminal node as end node", () => {
    const graphConfig = makeGraphConfig(
      [makeNode("a"), makeNode("b"), makeNode("c")],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      "a",
    );

    const compiled = compileGraphConfig(graphConfig);

    expect(compiled.nodes.size).toBe(3);
    // Only "c" has no outgoing edge
    expect(compiled.endNodes.has("c")).toBe(true);
    expect(compiled.endNodes.size).toBe(1);
    // Intermediate nodes should not be end nodes
    expect(compiled.endNodes.has("a")).toBe(false);
    expect(compiled.endNodes.has("b")).toBe(false);
    expect(compiled.startNode).toBe("a");
  });

  test("nodes with no outgoing edges are all end nodes", () => {
    // a -> b, a -> c  (b and c are end nodes)
    const graphConfig = makeGraphConfig(
      [makeNode("a"), makeNode("b"), makeNode("c")],
      [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
      ],
      "a",
    );

    const compiled = compileGraphConfig(graphConfig);

    expect(compiled.endNodes.size).toBe(2);
    expect(compiled.endNodes.has("b")).toBe(true);
    expect(compiled.endNodes.has("c")).toBe(true);
    expect(compiled.endNodes.has("a")).toBe(false);
  });

  test("edges are copied (not shared by reference)", () => {
    const edges = [{ from: "a", to: "b" }];
    const graphConfig = makeGraphConfig(
      [makeNode("a"), makeNode("b")],
      edges,
      "a",
    );

    const compiled = compileGraphConfig(graphConfig);

    // Mutating the original edges should not affect the compiled output
    edges.push({ from: "b", to: "a" });
    expect(compiled.edges.length).toBe(1);
  });

  test("preserves startNode from config", () => {
    const graphConfig = makeGraphConfig(
      [makeNode("first"), makeNode("second")],
      [{ from: "first", to: "second" }],
      "second",
    );

    const compiled = compileGraphConfig(graphConfig);

    expect(compiled.startNode).toBe("second");
  });

  test("diamond graph: only the final node is an end node", () => {
    // a -> b, a -> c, b -> d, c -> d
    const graphConfig = makeGraphConfig(
      [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")],
      [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
      "a",
    );

    const compiled = compileGraphConfig(graphConfig);

    expect(compiled.endNodes.size).toBe(1);
    expect(compiled.endNodes.has("d")).toBe(true);
  });

  test("config is an empty object by default", () => {
    const graphConfig = makeGraphConfig([makeNode("a")]);

    const compiled = compileGraphConfig(graphConfig);

    expect(compiled.config).toEqual({});
  });

  test("edges with conditions are preserved in compiled output", () => {
    const condition = (_state: BaseState) => true;
    const graphConfig = makeGraphConfig(
      [makeNode("a"), makeNode("b")],
      [{ from: "a", to: "b", condition, label: "always" }],
      "a",
    );

    const compiled = compileGraphConfig(graphConfig);

    expect(compiled.edges.length).toBe(1);
    expect(compiled.edges[0]!.condition).toBe(condition);
    expect(compiled.edges[0]!.label).toBe("always");
  });

  test("all nodes in nodeMap are retrievable by id", () => {
    const nodes = [makeNode("x"), makeNode("y"), makeNode("z")];
    const graphConfig = makeGraphConfig(nodes, [], "x");

    const compiled = compileGraphConfig(graphConfig);

    for (const node of nodes) {
      expect(compiled.nodes.get(node.id)).toBe(node);
    }
  });
});

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
