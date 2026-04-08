import { test, expect, describe } from "bun:test";
import {
  buildConnector,
  buildMergeConnector,
} from "../../src/components/connectors.ts";
import { NODE_W, NODE_H, V_GAP } from "../../src/components/layout.ts";
import type { LayoutNode } from "../../src/components/layout.ts";
import type { GraphTheme } from "../../src/components/graph-theme.ts";
import type { SessionStatus } from "../../src/components/orchestrator-panel-types.ts";

const theme: GraphTheme = {
  background: "#1e1e2e",
  backgroundElement: "#313244",
  text: "#cdd6f4",
  textMuted: "#a6adc8",
  textDim: "#7f849c",
  primary: "#89b4fa",
  success: "#a6e3a1",
  error: "#f38ba8",
  warning: "#f9e2af",
  info: "#89b4fa",
  border: "#585b70",
  borderActive: "#6c7086",
};

function makeNode(
  overrides: Partial<LayoutNode> & { name: string },
): LayoutNode {
  return {
    status: "pending" as SessionStatus,
    parents: [],
    startedAt: null,
    endedAt: null,
    children: [],
    depth: 0,
    x: 0,
    y: 0,
    ...overrides,
  };
}

describe("buildConnector", () => {
  test("returns null for leaf node (no children)", () => {
    const leaf = makeNode({ name: "leaf" });
    expect(buildConnector(leaf, {}, theme)).toBeNull();
  });

  test("returns null when gap between parent and child is less than 1 row", () => {
    const child = makeNode({ name: "child", depth: 1, x: 10, y: NODE_H });
    const parent = makeNode({
      name: "parent",
      depth: 0,
      x: 10,
      y: 0,
      children: [child],
    });
    // rowH[0] = NODE_H, so parentBottom = 0 + NODE_H = NODE_H, child.y = NODE_H → gap = 0
    expect(buildConnector(parent, { 0: NODE_H }, theme)).toBeNull();
  });

  test("builds straight connector for single child directly below", () => {
    const cx = 10;
    const parentY = 0;
    const childY = parentY + NODE_H + V_GAP;
    const child = makeNode({
      name: "child",
      depth: 1,
      x: cx,
      y: childY,
    });
    const parent = makeNode({
      name: "parent",
      depth: 0,
      x: cx,
      y: parentY,
      children: [child],
    });

    const result = buildConnector(parent, { 0: NODE_H }, theme);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(Array(V_GAP).fill("│").join("\n"));
    expect(result!.col).toBe(cx + Math.floor(NODE_W / 2));
    expect(result!.row).toBe(NODE_H);
    expect(result!.width).toBe(1);
    expect(result!.height).toBe(V_GAP);
    expect(result!.color).toBe(theme.borderActive);
  });

  test("builds branching connector for two children", () => {
    const parentX = 20;
    const leftX = 0;
    const rightX = NODE_W + 6; // H_GAP apart
    const parentY = 0;
    const childY = parentY + NODE_H + V_GAP;

    const left = makeNode({ name: "left", depth: 1, x: leftX, y: childY });
    const right = makeNode({ name: "right", depth: 1, x: rightX, y: childY });
    const parent = makeNode({
      name: "parent",
      depth: 0,
      x: parentX,
      y: parentY,
      children: [left, right],
    });

    const result = buildConnector(parent, { 0: NODE_H }, theme);
    expect(result).not.toBeNull();
    expect(result!.height).toBe(V_GAP);
    // Text should contain horizontal bar characters
    expect(result!.text).toContain("─");
  });

  test("branching connector uses junction characters", () => {
    // Parent centered, two children flanking
    const leftX = 0;
    const rightX = NODE_W * 2;
    const parentX = NODE_W; // centered
    const childY = NODE_H + V_GAP;

    const left = makeNode({ name: "left", depth: 1, x: leftX, y: childY });
    const right = makeNode({ name: "right", depth: 1, x: rightX, y: childY });
    const parent = makeNode({
      name: "parent",
      depth: 0,
      x: parentX,
      y: 0,
      children: [left, right],
    });

    const result = buildConnector(parent, { 0: NODE_H }, theme);
    expect(result).not.toBeNull();
    const text = result!.text;
    // Should contain junction characters from the bar row
    const hasJunctions =
      text.includes("╭") || text.includes("╮") ||
      text.includes("┬") || text.includes("┼") ||
      text.includes("├") || text.includes("┤") ||
      text.includes("╰") || text.includes("╯") ||
      text.includes("┴");
    expect(hasJunctions).toBe(true);
  });

  test("parent at right edge with child at same column produces ┤ junction", () => {
    // parent at rightmost position, one child aligned at parent center (same col)
    // and another child to the left
    const leftX = 0;
    const parentX = NODE_W + 6;
    const childY = NODE_H + V_GAP;

    const left = makeNode({ name: "left", depth: 1, x: leftX, y: childY });
    // right child at same x as parent → same center
    const right = makeNode({ name: "right", depth: 1, x: parentX, y: childY });
    const parent = makeNode({
      name: "parent",
      depth: 0,
      x: parentX,
      y: 0,
      children: [left, right],
    });

    const result = buildConnector(parent, { 0: NODE_H }, theme);
    expect(result).not.toBeNull();
    const lines = result!.text.split("\n");
    const barLine = lines[lines.length - 1]!;
    // Parent center = right child center = parentX + NODE_W/2 (maxCol)
    // childAtParent=true, pcx===maxCol → '┤'
    const pcx = parentX + Math.floor(NODE_W / 2);
    const leftCx = leftX + Math.floor(NODE_W / 2);
    const localParent = pcx - leftCx;
    expect(barLine[localParent]).toBe("┤");
  });

  test("connector with child at same column as parent uses combined junction", () => {
    // Single child directly under parent, but with V_GAP > 1 creating a bar scenario
    // Actually for this we need parent and child at same center with multiple children
    const cx = 10;
    const childY = NODE_H + V_GAP;
    const child1 = makeNode({ name: "c1", depth: 1, x: cx, y: childY });
    const child2 = makeNode({ name: "c2", depth: 1, x: cx + NODE_W + 6, y: childY });
    // Parent at child1's x so parent center == child1 center
    const parent = makeNode({
      name: "parent",
      depth: 0,
      x: cx,
      y: 0,
      children: [child1, child2],
    });

    const result = buildConnector(parent, { 0: NODE_H }, theme);
    expect(result).not.toBeNull();
    // Parent center matches child1 center → uses "├" (left edge with down)
    expect(result!.text).toContain("├");
  });
});

describe("buildMergeConnector", () => {
  test("returns null for single-parent node", () => {
    const child = makeNode({ name: "child", parents: ["p1"] });
    expect(buildMergeConnector(child, {}, {}, theme)).toBeNull();
  });

  test("returns null when fewer than 2 parents exist in allNodes", () => {
    const child = makeNode({ name: "child", parents: ["p1", "p2"] });
    const allNodes: Record<string, LayoutNode> = {
      child,
      p1: makeNode({ name: "p1" }),
      // p2 is missing
    };
    expect(buildMergeConnector(child, {}, allNodes, theme)).toBeNull();
  });

  test("returns null when gap is less than 1 row", () => {
    const p1 = makeNode({ name: "p1", depth: 0, y: 0 });
    const p2 = makeNode({ name: "p2", depth: 0, y: 0 });
    const child = makeNode({
      name: "child",
      parents: ["p1", "p2"],
      depth: 1,
      y: NODE_H, // parentBottom = NODE_H, child.y = NODE_H → gap = 0
    });
    const allNodes = { p1, p2, child };
    expect(buildMergeConnector(child, { 0: NODE_H }, allNodes, theme)).toBeNull();
  });

  test("builds merge connector for two parents", () => {
    const p1 = makeNode({ name: "p1", depth: 0, x: 0, y: 0 });
    const p2 = makeNode({ name: "p2", depth: 0, x: NODE_W + 6, y: 0 });
    const childY = NODE_H + V_GAP;
    const childX = Math.floor(NODE_W / 2); // centered-ish
    const child = makeNode({
      name: "child",
      parents: ["p1", "p2"],
      depth: 1,
      x: childX,
      y: childY,
    });
    const allNodes = { p1, p2, child };

    const result = buildMergeConnector(child, { 0: NODE_H }, allNodes, theme);
    expect(result).not.toBeNull();
    expect(result!.height).toBe(V_GAP);
    expect(result!.row).toBe(NODE_H);
    expect(result!.color).toBe(theme.borderActive);
    // Should contain horizontal bar
    expect(result!.text).toContain("─");
  });

  test("merge connector contains junction characters", () => {
    const p1 = makeNode({ name: "p1", depth: 0, x: 0, y: 0 });
    const p2 = makeNode({ name: "p2", depth: 0, x: NODE_W * 2, y: 0 });
    const childY = NODE_H + V_GAP;
    const childCx = Math.floor(NODE_W / 2) + NODE_W; // centered between parents
    const child = makeNode({
      name: "child",
      parents: ["p1", "p2"],
      depth: 1,
      x: childCx - Math.floor(NODE_W / 2),
      y: childY,
    });
    const allNodes = { p1, p2, child };

    const result = buildMergeConnector(child, { 0: NODE_H }, allNodes, theme);
    expect(result).not.toBeNull();
    const text = result!.text;
    const hasJunctions =
      text.includes("╭") || text.includes("╮") ||
      text.includes("┬") || text.includes("┼") ||
      text.includes("├") || text.includes("┤") ||
      text.includes("╰") || text.includes("╯") ||
      text.includes("┴");
    expect(hasJunctions).toBe(true);
  });

  test("merge connector with vertical stem to child", () => {
    const p1 = makeNode({ name: "p1", depth: 0, x: 0, y: 0 });
    const p2 = makeNode({ name: "p2", depth: 0, x: NODE_W + 6, y: 0 });
    // Extra gap so stem is visible
    const childY = NODE_H + V_GAP + 2;
    const child = makeNode({
      name: "child",
      parents: ["p1", "p2"],
      depth: 1,
      x: Math.floor((NODE_W + 6) / 2),
      y: childY,
    });
    const allNodes = { p1, p2, child };

    const result = buildMergeConnector(child, { 0: NODE_H }, allNodes, theme);
    expect(result).not.toBeNull();
    // With gap > 1, there should be a vertical stem
    if (result!.height > 1) {
      expect(result!.text).toContain("│");
    }
  });
});
