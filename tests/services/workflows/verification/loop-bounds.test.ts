/**
 * Tests for loop bounds verification.
 *
 * Property: Every loop has a declared maxIterations > 0.
 */

import { test, expect, describe } from "bun:test";
import { checkLoopBounds } from "@/services/workflows/verification/loop-bounds.ts";
import { buildGraph } from "./test-support.ts";
import type { VerificationLoop } from "@/services/workflows/verification/types.ts";

describe("checkLoopBounds", () => {
  describe("passing cases", () => {
    test("graph with no loops passes", async () => {
      const graph = buildGraph({
        nodes: ["A", "B"],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(true);
    });

    test("single loop with positive maxIterations passes", async () => {
      const loop: VerificationLoop = {
        entryNode: "loop-start",
        exitNode: "loop-end",
        maxIterations: 5,
        bodyNodes: ["step"],
      };
      const graph = buildGraph({
        nodes: ["A", "loop-start", "step", "loop-end", "B"],
        edges: [
          ["A", "loop-start"],
          ["loop-start", "step"],
          ["step", "loop-start"],
          ["loop-start", "loop-end"],
          ["loop-end", "B"],
        ],
        start: "A",
        ends: ["B"],
        loops: [loop],
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(true);
    });

    test("multiple loops all with positive bounds pass", async () => {
      const loops: VerificationLoop[] = [
        { entryNode: "L1", exitNode: "E1", maxIterations: 3, bodyNodes: ["b1"] },
        { entryNode: "L2", exitNode: "E2", maxIterations: 10, bodyNodes: ["b2"] },
        { entryNode: "L3", exitNode: "E3", maxIterations: 1, bodyNodes: ["b3"] },
      ];
      const graph = buildGraph({
        nodes: ["A", "end"],
        edges: [["A", "end"]],
        start: "A",
        ends: ["end"],
        loops,
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(true);
    });

    test("loop with maxIterations of exactly 1 passes", async () => {
      const loop: VerificationLoop = {
        entryNode: "L",
        exitNode: "E",
        maxIterations: 1,
        bodyNodes: [],
      };
      const graph = buildGraph({
        nodes: ["A", "L", "E"],
        edges: [["A", "E"]],
        start: "A",
        ends: ["E"],
        loops: [loop],
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(true);
    });

    test("large maxIterations value passes", async () => {
      const loop: VerificationLoop = {
        entryNode: "L",
        exitNode: "E",
        maxIterations: 999999,
        bodyNodes: [],
      };
      const graph = buildGraph({
        nodes: ["A", "E"],
        edges: [["A", "E"]],
        start: "A",
        ends: ["E"],
        loops: [loop],
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(true);
    });
  });

  describe("failing cases", () => {
    test("loop with maxIterations of 0 fails", async () => {
      const loop: VerificationLoop = {
        entryNode: "L",
        exitNode: "E",
        maxIterations: 0,
        bodyNodes: ["body"],
      };
      const graph = buildGraph({
        nodes: ["A", "L", "E", "body"],
        edges: [["A", "E"]],
        start: "A",
        ends: ["E"],
        loops: [loop],
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(false);
      expect(result.counterexample).toContain("L");
      expect(result.counterexample).toContain("maxIterations=0");
    });

    test("loop with negative maxIterations fails", async () => {
      const loop: VerificationLoop = {
        entryNode: "loop",
        exitNode: "exit",
        maxIterations: -1,
        bodyNodes: [],
      };
      const graph = buildGraph({
        nodes: ["A", "loop", "exit"],
        edges: [["A", "exit"]],
        start: "A",
        ends: ["exit"],
        loops: [loop],
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(false);
      expect(result.counterexample).toContain("loop");
      expect(result.counterexample).toContain("-1");
    });

    test("multiple unbounded loops all reported", async () => {
      const loops: VerificationLoop[] = [
        { entryNode: "L1", exitNode: "E1", maxIterations: 0, bodyNodes: [] },
        { entryNode: "L2", exitNode: "E2", maxIterations: -5, bodyNodes: [] },
      ];
      const graph = buildGraph({
        nodes: ["A", "end"],
        edges: [["A", "end"]],
        start: "A",
        ends: ["end"],
        loops,
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(false);
      const unbounded = result.details?.unboundedLoops as Array<{
        entryNode: string;
        maxIterations: number;
      }>;
      expect(unbounded).toHaveLength(2);
      expect(unbounded.map((l) => l.entryNode)).toContain("L1");
      expect(unbounded.map((l) => l.entryNode)).toContain("L2");
    });

    test("mix of bounded and unbounded loops fails for unbounded only", async () => {
      const loops: VerificationLoop[] = [
        { entryNode: "ok-loop", exitNode: "ok-exit", maxIterations: 10, bodyNodes: [] },
        { entryNode: "bad-loop", exitNode: "bad-exit", maxIterations: 0, bodyNodes: [] },
      ];
      const graph = buildGraph({
        nodes: ["A", "end"],
        edges: [["A", "end"]],
        start: "A",
        ends: ["end"],
        loops,
      });
      const result = await checkLoopBounds(graph);
      expect(result.verified).toBe(false);
      const unbounded = result.details?.unboundedLoops as Array<{
        entryNode: string;
        maxIterations: number;
      }>;
      expect(unbounded).toHaveLength(1);
      expect(unbounded[0]!.entryNode).toBe("bad-loop");
    });
  });
});
