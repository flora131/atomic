/**
 * Tests for Ralph Conductor Graph
 *
 * Verifies the conductor graph produced by createRalphConductorGraph():
 *   - Contains exactly 4 agent nodes in the correct linear order
 *   - All nodes have type "agent" (no tool or decision nodes)
 *   - Edges form a linear pipeline: planner → orchestrator → reviewer → debugger
 *   - Start and end nodes are correctly configured
 */

import { describe, expect, test } from "bun:test";
import { createRalphConductorGraph } from "@/services/workflows/ralph/conductor-graph.ts";

describe("createRalphConductorGraph", () => {
  const graph = createRalphConductorGraph();

  // ---------------------------------------------------------------------------
  // Node structure
  // ---------------------------------------------------------------------------

  test("contains exactly 4 nodes", () => {
    expect(graph.nodes.size).toBe(4);
  });

  test("contains planner, orchestrator, reviewer, and debugger nodes", () => {
    expect(graph.nodes.has("planner")).toBe(true);
    expect(graph.nodes.has("orchestrator")).toBe(true);
    expect(graph.nodes.has("reviewer")).toBe(true);
    expect(graph.nodes.has("debugger")).toBe(true);
  });

  test("all nodes have type 'agent'", () => {
    for (const [id, node] of graph.nodes) {
      expect(node.type).toBe("agent");
    }
  });

  test("each node has a matching id", () => {
    for (const [id, node] of graph.nodes) {
      expect(node.id).toBe(id);
    }
  });

  test("each node has a non-empty name and description", () => {
    for (const [_id, node] of graph.nodes) {
      expect(typeof node.name).toBe("string");
      expect(node.name!.length).toBeGreaterThan(0);
      expect(typeof node.description).toBe("string");
      expect(node.description!.length).toBeGreaterThan(0);
    }
  });

  test("node execute functions are no-ops that resolve to empty objects", async () => {
    for (const [_id, node] of graph.nodes) {
      const result = await node.execute({} as any);
      expect(result).toEqual({});
    }
  });

  // ---------------------------------------------------------------------------
  // Edge structure
  // ---------------------------------------------------------------------------

  test("contains exactly 3 edges forming a linear pipeline", () => {
    expect(graph.edges).toHaveLength(3);
  });

  test("edges form planner → orchestrator → reviewer → debugger", () => {
    const edgePairs = graph.edges.map((e) => `${e.from}->${e.to}`);
    expect(edgePairs).toContain("planner->orchestrator");
    expect(edgePairs).toContain("orchestrator->reviewer");
    expect(edgePairs).toContain("reviewer->debugger");
  });

  test("edges are in sequential order", () => {
    expect(graph.edges[0]!.from).toBe("planner");
    expect(graph.edges[0]!.to).toBe("orchestrator");
    expect(graph.edges[1]!.from).toBe("orchestrator");
    expect(graph.edges[1]!.to).toBe("reviewer");
    expect(graph.edges[2]!.from).toBe("reviewer");
    expect(graph.edges[2]!.to).toBe("debugger");
  });

  // ---------------------------------------------------------------------------
  // Start and end configuration
  // ---------------------------------------------------------------------------

  test("startNode is 'planner'", () => {
    expect(graph.startNode).toBe("planner");
  });

  test("endNodes contains only 'debugger'", () => {
    expect(graph.endNodes).toBeInstanceOf(Set);
    expect(graph.endNodes.size).toBe(1);
    expect(graph.endNodes.has("debugger")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Graph consistency
  // ---------------------------------------------------------------------------

  test("all edge references point to existing nodes", () => {
    for (const edge of graph.edges) {
      expect(graph.nodes.has(edge.from)).toBe(true);
      expect(graph.nodes.has(edge.to)).toBe(true);
    }
  });

  test("startNode exists in nodes", () => {
    expect(graph.nodes.has(graph.startNode)).toBe(true);
  });

  test("all endNodes exist in nodes", () => {
    for (const endNode of graph.endNodes) {
      expect(graph.nodes.has(endNode)).toBe(true);
    }
  });

  test("returns a new graph instance on each call", () => {
    const graph2 = createRalphConductorGraph();
    expect(graph2).not.toBe(graph);
    expect(graph2.nodes).not.toBe(graph.nodes);
    expect(graph2.edges).not.toBe(graph.edges);
  });
});
