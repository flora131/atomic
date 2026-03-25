/**
 * Tests for deadlock-freedom verification.
 *
 * Property: Every reachable non-end node has at least one outgoing edge,
 * and conditional edges form exhaustive decision groups.
 */

import { test, expect, describe } from "bun:test";
import { checkDeadlockFreedom } from "@/services/workflows/verification/deadlock-freedom.ts";
import type { VerificationEdge } from "@/services/workflows/verification/types.ts";
import { buildGraph, buildLinearGraph, buildDiamondGraph } from "./test-support.ts";

describe("checkDeadlockFreedom", () => {
  describe("passing cases", () => {
    test("single end node — no non-end nodes to check", async () => {
      const graph = buildGraph({
        nodes: ["A"],
        edges: [],
        start: "A",
        ends: ["A"],
      });
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(true);
    });

    test("linear graph — all non-end nodes have unconditional outgoing edges", async () => {
      const graph = buildLinearGraph(["A", "B", "C"]);
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(true);
    });

    test("diamond graph — unconditional edges", async () => {
      const graph = buildDiamondGraph();
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(true);
    });

    test("node with at least one unconditional edge among conditional ones", async () => {
      const edges: VerificationEdge[] = [
        { from: "A", to: "B", hasCondition: true },
        { from: "A", to: "C", hasCondition: false }, // unconditional fallback
        { from: "B", to: "end", hasCondition: false },
        { from: "C", to: "end", hasCondition: false },
      ];
      const graph = buildGraph({
        nodes: ["A", "B", "C", "end"],
        edges,
        start: "A",
        ends: ["end"],
      });
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(true);
    });

    test("exhaustive condition group with 2+ edges in same group", async () => {
      const edges: VerificationEdge[] = [
        { from: "A", to: "B", hasCondition: true, conditionGroup: "g1" },
        { from: "A", to: "C", hasCondition: true, conditionGroup: "g1" },
        { from: "B", to: "end", hasCondition: false },
        { from: "C", to: "end", hasCondition: false },
      ];
      const graph = buildGraph({
        nodes: ["A", "B", "C", "end"],
        edges,
        start: "A",
        ends: ["end"],
      });
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(true);
    });

    test("condition group with unconditional (else) branch", async () => {
      const edges: VerificationEdge[] = [
        { from: "A", to: "B", hasCondition: true, conditionGroup: "g1" },
        { from: "A", to: "C", hasCondition: false, conditionGroup: "g1" }, // else branch
        { from: "B", to: "end", hasCondition: false },
        { from: "C", to: "end", hasCondition: false },
      ];
      const graph = buildGraph({
        nodes: ["A", "B", "C", "end"],
        edges,
        start: "A",
        ends: ["end"],
      });
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(true);
    });
  });

  describe("failing cases", () => {
    test("non-end node with no outgoing edges deadlocks", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "end"],
        edges: [
          ["A", "B"],
          ["A", "end"],
        ],
        start: "A",
        ends: ["end"],
      });
      // B has no outgoing edges and is not an end node
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(false);
      expect(result.details?.deadlockedNodes).toContain("B");
    });

    test("single ungrouped conditional edge without fallback", async () => {
      const edges: VerificationEdge[] = [
        { from: "A", to: "B", hasCondition: true }, // no group, no fallback
        { from: "B", to: "end", hasCondition: false },
      ];
      const graph = buildGraph({
        nodes: ["A", "B", "end"],
        edges,
        start: "A",
        ends: ["end"],
      });
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(false);
      expect(result.details?.deadlockedNodes).toContain("A");
    });

    test("single conditional edge in a group of size 1 (non-exhaustive)", async () => {
      const edges: VerificationEdge[] = [
        { from: "A", to: "B", hasCondition: true, conditionGroup: "g1" },
        { from: "B", to: "end", hasCondition: false },
      ];
      const graph = buildGraph({
        nodes: ["A", "B", "end"],
        edges,
        start: "A",
        ends: ["end"],
      });
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(false);
      expect(result.details?.deadlockedNodes).toContain("A");
    });

    test("multiple deadlocked nodes reported", async () => {
      const graph = buildGraph({
        nodes: ["A", "B", "C", "end"],
        edges: [
          ["A", "B"],
          ["A", "C"],
          ["A", "end"],
        ],
        start: "A",
        ends: ["end"],
      });
      // Both B and C have no outgoing edges
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(false);
      const deadlocked = result.details?.deadlockedNodes as string[];
      expect(deadlocked).toContain("B");
      expect(deadlocked).toContain("C");
    });
  });

  describe("edge cases", () => {
    test("end nodes are excluded from deadlock check", async () => {
      const graph = buildGraph({
        nodes: ["A", "end1", "end2"],
        edges: [
          ["A", "end1"],
          ["A", "end2"],
        ],
        start: "A",
        ends: ["end1", "end2"],
      });
      // end1 and end2 have no outgoing edges but are end nodes => OK
      const result = await checkDeadlockFreedom(graph);
      expect(result.verified).toBe(true);
    });

    test("node with mixed grouped and ungrouped conditional edges", async () => {
      // All edges conditional, group is exhaustive (2 edges), so no deadlock
      const edges: VerificationEdge[] = [
        { from: "A", to: "B", hasCondition: true, conditionGroup: "g1" },
        { from: "A", to: "C", hasCondition: true, conditionGroup: "g1" },
        { from: "A", to: "D", hasCondition: true }, // ungrouped
        { from: "B", to: "end", hasCondition: false },
        { from: "C", to: "end", hasCondition: false },
        { from: "D", to: "end", hasCondition: false },
      ];
      const graph = buildGraph({
        nodes: ["A", "B", "C", "D", "end"],
        edges,
        start: "A",
        ends: ["end"],
      });
      const result = await checkDeadlockFreedom(graph);
      // g1 has 2 edges => exhaustive => no deadlock
      expect(result.verified).toBe(true);
    });
  });
});
