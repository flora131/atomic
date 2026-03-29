/**
 * Tests for termination verification.
 *
 * Property: All reachable nodes can reach at least one end node.
 */

import { test, expect, describe } from "bun:test";
import { checkTermination } from "@/services/workflows/verification/termination.ts";
import {
  buildGraph,
  buildLinearGraph,
  buildDiamondGraph,
} from "./test-support.ts";

describe("checkTermination", () => {
  describe("passing cases", () => {
    test("single-node graph that is also the end", async () => {
      const graph = buildGraph({
        nodes: ["A"],
        edges: [],
        start: "A",
        ends: ["A"],
      });
      const result = await checkTermination(graph);
      expect(result.verified).toBe(true);
    });

    test("linear graph — all nodes reach the end", async () => {
      const graph = buildLinearGraph(["A", "B", "C"]);
      const result = await checkTermination(graph);
      expect(result.verified).toBe(true);
    });

    test("diamond graph — all paths converge at end", async () => {
      const graph = buildDiamondGraph();
      const result = await checkTermination(graph);
      expect(result.verified).toBe(true);
    });

    test("graph with multiple end nodes", async () => {
      const graph = buildGraph({
        nodes: ["start", "left", "right"],
        edges: [
          ["start", "left"],
          ["start", "right"],
        ],
        start: "start",
        ends: ["left", "right"],
      });
      const result = await checkTermination(graph);
      expect(result.verified).toBe(true);
    });

    test("graph with cycle that has an exit to end node", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "C"],
        edges: [
          ["A", "B"],
          ["B", "A"],
          ["B", "C"],
        ],
        start: "A",
        ends: ["C"],
      });
      const result = await checkTermination(graph);
      expect(result.verified).toBe(true);
    });
  });

  describe("failing cases", () => {
    test("dead-end node with no outgoing edges and not an end node", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "C"],
        edges: [
          ["A", "B"],
          ["A", "C"],
        ],
        start: "A",
        ends: ["C"],
      });
      // B has no outgoing edges and is not an end node => dead end
      const result = await checkTermination(graph);
      expect(result.verified).toBe(false);
      expect(result.details?.deadEndNodes).toContain("B");
    });

    test("pure cycle with no exit — nodes cannot reach any end", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "C", "end"],
        edges: [
          ["A", "B"],
          ["B", "C"],
          ["C", "A"],
        ],
        start: "A",
        ends: ["end"],
      });
      const result = await checkTermination(graph);
      expect(result.verified).toBe(false);
      const deadEnds = result.details?.deadEndNodes as string[];
      expect(deadEnds).toContain("A");
      expect(deadEnds).toContain("B");
      expect(deadEnds).toContain("C");
    });

    test("branch leading to dead-end node", async () => {
      const graph = buildGraph({
        nodes: ["start", "ok-path", "dead-end", "end"],
        edges: [
          ["start", "ok-path"],
          ["start", "dead-end"],
          ["ok-path", "end"],
        ],
        start: "start",
        ends: ["end"],
      });
      const result = await checkTermination(graph);
      expect(result.verified).toBe(false);
      expect(result.details?.deadEndNodes).toContain("dead-end");
    });
  });

  describe("edge cases", () => {
    test("unreachable node does not cause termination failure", async () => {
      // Node "X" is unreachable from start but has no path to end.
      // Since termination only checks reachable nodes, X should not cause failure.
      const graph = buildGraph({
        nodes: ["A", "B", "X"],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
      });
      const result = await checkTermination(graph);
      // X is unreachable, so it should not appear in deadEndNodes
      expect(result.verified).toBe(true);
    });

    test("start node is the only end node with no edges", async () => {
      const graph = buildGraph({
        nodes: ["start"],
        edges: [],
        start: "start",
        ends: ["start"],
      });
      const result = await checkTermination(graph);
      expect(result.verified).toBe(true);
    });

    test("long chain — all reach end", async () => {
      const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
      const graph = buildLinearGraph(ids);
      const result = await checkTermination(graph);
      expect(result.verified).toBe(true);
    });
  });
});
