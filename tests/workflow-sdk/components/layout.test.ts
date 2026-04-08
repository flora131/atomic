import { test, expect, describe } from "bun:test";
import {
  computeLayout,
  NODE_W,
  NODE_H,
  H_GAP,
  V_GAP,
  PAD,
} from "../../../packages/workflow-sdk/src/components/layout.ts";
import type { SessionData } from "../../../packages/workflow-sdk/src/components/orchestrator-panel-types.ts";

function makeSession(
  name: string,
  parents: string[] = [],
  status: "pending" | "running" | "complete" | "error" = "pending",
): SessionData {
  return { name, status, parents, startedAt: null, endedAt: null };
}

describe("computeLayout", () => {
  test("handles empty sessions", () => {
    const result = computeLayout([]);
    expect(result.roots).toHaveLength(0);
    expect(Object.keys(result.map)).toHaveLength(0);
    expect(result.width).toBe(PAD);
    expect(result.height).toBe(PAD);
  });

  test("single root node", () => {
    const result = computeLayout([makeSession("root")]);
    expect(result.roots).toHaveLength(1);
    expect(result.map["root"]).toBeDefined();
    expect(result.map["root"]!.depth).toBe(0);
    expect(result.map["root"]!.x).toBe(PAD); // cursor starts at 0, +PAD offset
    expect(result.map["root"]!.y).toBe(PAD);
  });

  test("single parent with one child", () => {
    const result = computeLayout([
      makeSession("parent"),
      makeSession("child", ["parent"]),
    ]);
    expect(result.roots).toHaveLength(1);
    expect(result.map["parent"]!.depth).toBe(0);
    expect(result.map["child"]!.depth).toBe(1);
    // Parent should be centered over child (same x since only 1 child)
    expect(result.map["parent"]!.x).toBe(result.map["child"]!.x);
  });

  test("single parent with two children", () => {
    const result = computeLayout([
      makeSession("root"),
      makeSession("left", ["root"]),
      makeSession("right", ["root"]),
    ]);
    expect(result.roots).toHaveLength(1);
    expect(result.map["left"]!.depth).toBe(1);
    expect(result.map["right"]!.depth).toBe(1);
    // Parent x is midpoint of children
    const parentX = result.map["root"]!.x;
    const leftX = result.map["left"]!.x;
    const rightX = result.map["right"]!.x;
    expect(parentX).toBe(Math.round((leftX + rightX) / 2));
    // Children should be horizontally separated by NODE_W + H_GAP
    expect(rightX - leftX).toBe(NODE_W + H_GAP);
  });

  test("child y is offset from parent by NODE_H + V_GAP", () => {
    const result = computeLayout([
      makeSession("parent"),
      makeSession("child", ["parent"]),
    ]);
    const parentY = result.map["parent"]!.y;
    const childY = result.map["child"]!.y;
    expect(childY - parentY).toBe(NODE_H + V_GAP);
  });

  test("merge node with two parents", () => {
    const result = computeLayout([
      makeSession("root"),
      makeSession("a", ["root"]),
      makeSession("b", ["root"]),
      makeSession("merge", ["a", "b"]),
    ]);
    const mergeNode = result.map["merge"]!;
    // Merge depth should be max(parent depths) + 1
    expect(mergeNode.depth).toBe(2);
    // Should be positioned centered under parents
    const aCx = result.map["a"]!.x + Math.floor(NODE_W / 2);
    const bCx = result.map["b"]!.x + Math.floor(NODE_W / 2);
    const avgCenter = Math.round((aCx + bCx) / 2);
    expect(mergeNode.x + Math.floor(NODE_W / 2)).toBe(avgCenter);
  });

  test("merge node with children gets sub-tree placed then shifted", () => {
    const result = computeLayout([
      makeSession("root"),
      makeSession("a", ["root"]),
      makeSession("b", ["root"]),
      makeSession("merge", ["a", "b"]),
      makeSession("after-merge", ["merge"]),
    ]);
    expect(result.map["after-merge"]!.depth).toBe(3);
    // after-merge should be directly under merge
    expect(result.map["after-merge"]!.x).toBe(result.map["merge"]!.x);
  });

  test("multiple independent roots", () => {
    const result = computeLayout([
      makeSession("r1"),
      makeSession("r2"),
    ]);
    expect(result.roots).toHaveLength(2);
    // Second root should be offset from first
    expect(result.map["r2"]!.x).toBeGreaterThan(result.map["r1"]!.x);
  });

  test("preserves status and error in layout nodes", () => {
    const sessions: SessionData[] = [
      { name: "s1", status: "error", parents: [], error: "boom", startedAt: 100, endedAt: 200 },
    ];
    const result = computeLayout(sessions);
    expect(result.map["s1"]!.status).toBe("error");
    expect(result.map["s1"]!.error).toBe("boom");
    expect(result.map["s1"]!.startedAt).toBe(100);
    expect(result.map["s1"]!.endedAt).toBe(200);
  });

  test("width and height encompass all nodes plus padding", () => {
    const result = computeLayout([
      makeSession("root"),
      makeSession("child", ["root"]),
    ]);
    const maxNodeRight = Math.max(
      ...Object.values(result.map).map((n) => n.x + NODE_W),
    );
    const maxNodeBottom = Math.max(
      ...Object.values(result.map).map((n) => n.y + NODE_H),
    );
    expect(result.width).toBe(maxNodeRight + PAD);
    expect(result.height).toBe(maxNodeBottom + PAD);
  });

  test("rowH has entries for each used depth", () => {
    const result = computeLayout([
      makeSession("root"),
      makeSession("child", ["root"]),
      makeSession("grandchild", ["child"]),
    ]);
    expect(result.rowH[0]).toBe(NODE_H);
    expect(result.rowH[1]).toBe(NODE_H);
    expect(result.rowH[2]).toBe(NODE_H);
  });

  test("deep tree with three levels", () => {
    const result = computeLayout([
      makeSession("a"),
      makeSession("b", ["a"]),
      makeSession("c", ["b"]),
    ]);
    expect(result.map["a"]!.depth).toBe(0);
    expect(result.map["b"]!.depth).toBe(1);
    expect(result.map["c"]!.depth).toBe(2);
    // All should have same x (single chain)
    expect(result.map["a"]!.x).toBe(result.map["b"]!.x);
    expect(result.map["b"]!.x).toBe(result.map["c"]!.x);
  });
});
