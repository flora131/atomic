/**
 * Tests for reachability verification.
 *
 * Property: Every node in the graph is reachable from the start node.
 */

import { test, expect, describe } from "bun:test";
import { checkReachability } from "@/services/workflows/verification/reachability.ts";
import {
  buildGraph,
  buildLinearGraph,
  buildDiamondGraph,
} from "./test-support.ts";

describe("checkReachability", () => {
  describe("passing cases", () => {
    test("single-node graph (start is also end)", async () => {
      const graph = buildGraph({
        nodes: ["A"],
        edges: [],
        start: "A",
        ends: ["A"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(true);
    });

    test("linear graph — all nodes reachable", async () => {
      const graph = buildLinearGraph(["A", "B", "C", "D"]);
      const result = await checkReachability(graph);
      expect(result.verified).toBe(true);
    });

    test("diamond graph — all nodes reachable", async () => {
      const graph = buildDiamondGraph();
      const result = await checkReachability(graph);
      expect(result.verified).toBe(true);
    });

    test("graph with cycle — all nodes reachable", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "C"],
        edges: [
          ["A", "B"],
          ["B", "C"],
          ["C", "A"],
        ],
        start: "A",
        ends: ["C"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(true);
    });

    test("graph with multiple paths to same node", async () => {
      const graph = buildGraph({
        nodes: ["start", "left", "right", "merge", "end"],
        edges: [
          ["start", "left"],
          ["start", "right"],
          ["left", "merge"],
          ["right", "merge"],
          ["merge", "end"],
        ],
        start: "start",
        ends: ["end"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(true);
    });
  });

  describe("failing cases", () => {
    test("disconnected node is unreachable", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "orphan"],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(false);
      expect(result.counterexample).toContain("orphan");
      expect(result.details?.unreachableNodes).toContain("orphan");
    });

    test("multiple disconnected nodes reported", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "C", "X", "Y"],
        edges: [
          ["A", "B"],
          ["B", "C"],
        ],
        start: "A",
        ends: ["C"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(false);
      const unreachable = result.details?.unreachableNodes as string[];
      expect(unreachable).toContain("X");
      expect(unreachable).toContain("Y");
    });

    test("node reachable only in reverse direction is unreachable", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "C"],
        edges: [
          ["A", "B"],
          ["C", "B"],
        ],
        start: "A",
        ends: ["B"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(false);
      expect(result.details?.unreachableNodes).toContain("C");
    });

    test("start node not in graph nodes fails", async () => {
      const graph = buildGraph({
        nodes: ["A", "B"],
        edges: [["A", "B"]],
        start: "missing",
        ends: ["B"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(false);
      expect(result.counterexample).toContain("missing");
      expect(result.counterexample).toContain("not found");
    });
  });

  describe("edge cases", () => {
    test("graph with self-loop", async () => {
      const graph = buildGraph({
        nodes: ["A", "B"],
        edges: [
          ["A", "A"],
          ["A", "B"],
        ],
        start: "A",
        ends: ["B"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(true);
    });

    test("two separate components — second is unreachable", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "C", "D"],
        edges: [
          ["A", "B"],
          ["C", "D"],
        ],
        start: "A",
        ends: ["B", "D"],
      });
      const result = await checkReachability(graph);
      expect(result.verified).toBe(false);
      const unreachable = result.details?.unreachableNodes as string[];
      expect(unreachable).toContain("C");
      expect(unreachable).toContain("D");
    });
  });
});

