import { describe, expect, test } from "bun:test";
import { asBaseGraph } from "@/services/workflows/graph/contracts/runtime.ts";
import { createCheckpointer } from "@/services/workflows/graph/persistence/checkpointer/factory.ts";
import { MemorySaver } from "@/services/workflows/graph/persistence/checkpointer/memory.ts";
import type { BaseState, CompiledGraph, NodeDefinition } from "@/services/workflows/graph/types.ts";

describe("asBaseGraph", () => {
  test("widens a typed CompiledGraph to BaseState", () => {
    interface MyState extends BaseState {
      counter: number;
    }

    const node: NodeDefinition<MyState> = {
      id: "n1",
      type: "agent",
      execute: async () => ({}),
    };

    const typedGraph: CompiledGraph<MyState> = {
      nodes: new Map([["n1", node]]),
      edges: [],
      startNode: "n1",
      endNodes: new Set(["n1"]),
      config: {},
    };

    const baseGraph = asBaseGraph(typedGraph);

    expect(baseGraph.startNode).toBe("n1");
    expect(baseGraph.nodes.size).toBe(1);
    expect(baseGraph.endNodes.has("n1")).toBe(true);
  });

  test("preserves graph structure after widening", () => {
    const node: NodeDefinition<BaseState> = {
      id: "a",
      type: "tool",
      execute: async () => ({}),
    };

    const graph: CompiledGraph<BaseState> = {
      nodes: new Map([["a", node]]),
      edges: [{ from: "a", to: "a" }],
      startNode: "a",
      endNodes: new Set(["a"]),
      config: { maxConcurrency: 2 },
    };

    const base = asBaseGraph(graph);
    expect(base.edges).toEqual([{ from: "a", to: "a" }]);
    expect(base.config.maxConcurrency).toBe(2);
  });
});

describe("createCheckpointer", () => {
  test("creates a MemorySaver for type memory", () => {
    const cp = createCheckpointer("memory");
    expect(cp).toBeInstanceOf(MemorySaver);
  });

  test("throws for file type without baseDir", () => {
    expect(() => createCheckpointer("file")).toThrow("baseDir");
  });

  test("throws for session type without sessionDir", () => {
    expect(() => createCheckpointer("session")).toThrow("sessionDir");
  });

  test("creates research type with default dir", () => {
    const cp = createCheckpointer("research");
    expect(cp).toBeDefined();
  });

  test("throws for unknown type", () => {
    expect(() => createCheckpointer("invalid" as "memory")).toThrow("Unknown checkpointer type");
  });
});
