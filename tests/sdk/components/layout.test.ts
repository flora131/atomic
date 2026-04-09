import { test, expect, describe } from "bun:test";
import {
  computeLayout,
  NODE_W,
  NODE_H,
  H_GAP,
  V_GAP,
  PAD,
} from "@/sdk/components/layout.ts";
import type { SessionData } from "@/sdk/components/orchestrator-panel-types.ts";

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

  // ── dependsOn-style ralph chain ──────────────────────────────────────────
  //
  // When the executor wires up `dependsOn`, the parents array on each
  // SessionData ends up pointing at the prior stage instead of the root
  // "orchestrator". These tests assert that the layout treats that shape
  // as a linear chain (not a fan-out of siblings under the root), which is
  // the visual behavior users see after the fix.
  describe("ralph-style dependsOn chain", () => {
    test("single-iteration chain: plan → orch → review → debug", () => {
      const result = computeLayout([
        makeSession("orchestrator"),
        makeSession("planner-1", ["orchestrator"]),
        makeSession("orchestrator-1", ["planner-1"]),
        makeSession("reviewer-1", ["orchestrator-1"]),
        makeSession("debugger-1", ["reviewer-1"]),
      ]);
      expect(result.map["orchestrator"]!.depth).toBe(0);
      expect(result.map["planner-1"]!.depth).toBe(1);
      expect(result.map["orchestrator-1"]!.depth).toBe(2);
      expect(result.map["reviewer-1"]!.depth).toBe(3);
      expect(result.map["debugger-1"]!.depth).toBe(4);

      // Every node in a single chain lines up on the same x column.
      const rootX = result.map["orchestrator"]!.x;
      for (const n of ["planner-1", "orchestrator-1", "reviewer-1", "debugger-1"]) {
        expect(result.map[n]!.x).toBe(rootX);
      }

      // y increases monotonically as we descend the chain.
      const ys = [
        result.map["orchestrator"]!.y,
        result.map["planner-1"]!.y,
        result.map["orchestrator-1"]!.y,
        result.map["reviewer-1"]!.y,
        result.map["debugger-1"]!.y,
      ];
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
      }
    });

    test("multi-iteration chain: debugger-1 → planner-2 continues the spine", () => {
      const result = computeLayout([
        makeSession("orchestrator"),
        makeSession("planner-1", ["orchestrator"]),
        makeSession("orchestrator-1", ["planner-1"]),
        makeSession("reviewer-1", ["orchestrator-1"]),
        makeSession("debugger-1", ["reviewer-1"]),
        makeSession("planner-2", ["debugger-1"]),
        makeSession("orchestrator-2", ["planner-2"]),
      ]);
      expect(result.map["planner-2"]!.depth).toBe(5);
      expect(result.map["orchestrator-2"]!.depth).toBe(6);
      // Still a single column.
      const rootX = result.map["orchestrator"]!.x;
      expect(result.map["planner-2"]!.x).toBe(rootX);
      expect(result.map["orchestrator-2"]!.x).toBe(rootX);
    });

    test("confirmation-pass branch stays on the spine", () => {
      // reviewer-1-confirm depends on reviewer-1 directly (no sibling split).
      const result = computeLayout([
        makeSession("orchestrator"),
        makeSession("planner-1", ["orchestrator"]),
        makeSession("orchestrator-1", ["planner-1"]),
        makeSession("reviewer-1", ["orchestrator-1"]),
        makeSession("reviewer-1-confirm", ["reviewer-1"]),
      ]);
      expect(result.map["reviewer-1-confirm"]!.depth).toBe(4);
      // No fan-out: reviewer-1 has exactly one child (reviewer-1-confirm)
      expect(result.map["reviewer-1"]!.children).toHaveLength(1);
      expect(result.map["reviewer-1"]!.children[0]!.name).toBe("reviewer-1-confirm");
    });

    test("ralph chain never produces sibling fan-outs under orchestrator", () => {
      // Regression for the bug where planner-1 and orchestrator-1 appeared
      // side by side under orchestrator because both used the default parent.
      const result = computeLayout([
        makeSession("orchestrator"),
        makeSession("planner-1", ["orchestrator"]),
        makeSession("orchestrator-1", ["planner-1"]),
      ]);
      // orchestrator has exactly one child (planner-1), not two.
      expect(result.map["orchestrator"]!.children).toHaveLength(1);
      expect(result.map["orchestrator"]!.children[0]!.name).toBe("planner-1");
      expect(result.map["planner-1"]!.children).toHaveLength(1);
      expect(result.map["planner-1"]!.children[0]!.name).toBe("orchestrator-1");
    });
  });
});
