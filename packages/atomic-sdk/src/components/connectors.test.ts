import { test, expect, describe } from "bun:test";
import { buildConnector, buildMergeConnector } from "./connectors.ts";
import type { ConnectorResult } from "./connectors.ts";
import type { LayoutNode } from "./layout.ts";
import { NODE_W, NODE_H } from "./layout.ts";
import type { GraphTheme } from "./graph-theme.ts";
import type { SessionStatus } from "./orchestrator-panel-types.ts";

// ─── Mock Theme ──────────────────────────────────────────────────────────────

const mockTheme: GraphTheme = {
  background: "#000000",
  backgroundElement: "#111111",
  text: "#ffffff",
  textMuted: "#aaaaaa",
  textDim: "#666666",
  primary: "#0088ff",
  success: "#00cc44",
  error: "#ff2244",
  warning: "#ffaa00",
  info: "#00aaff",
  mauve: "#cc88ff",
  border: "#334455",
  borderActive: "#aabbcc",
};

// ─── Helper: make LayoutNode ─────────────────────────────────────────────────

function makeNode(
  overrides: Partial<LayoutNode> & { name: string },
): LayoutNode {
  return {
    status: "pending" as SessionStatus,
    parents: [],
    children: [],
    depth: 0,
    x: 0,
    y: 0,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

// Helper: center x of a node
function cx(node: LayoutNode): number {
  return node.x + Math.floor(NODE_W / 2);
}

// ─── buildConnector ──────────────────────────────────────────────────────────

describe("buildConnector", () => {
  test("returns null when parent has no children", () => {
    const parent = makeNode({ name: "root" });
    const result = buildConnector(parent, { 0: NODE_H }, mockTheme);
    expect(result).toBeNull();
  });

  test("single child directly below (aligned centers) produces straight vertical connector", () => {
    // parent center x = 0 + 18 = 18
    // child center x  = 0 + 18 = 18  (same)
    const child = makeNode({ name: "child", x: 0, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 0,
      y: 0,
      depth: 0,
      children: [child],
    });
    const rowH = { 0: NODE_H };
    // parentBottom = 0 + 4 = 4; firstChildRow = 7; numRows = 3
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    expect(r.col).toBe(cx(parent));      // 18
    expect(r.row).toBe(4);               // parentBottom
    expect(r.width).toBe(1);
    expect(r.height).toBe(3);            // numRows
    expect(r.text).toBe("│\n│\n│");
    expect(r.color).toBe(mockTheme.borderActive);
  });

  test("single child with offset center produces horizontal bar with junctions", () => {
    // parent: x=0 → pcx=18
    // child:  x=42 → cx=60 (not aligned)
    const child = makeNode({ name: "child", x: 42, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 0,
      y: 0,
      depth: 0,
      children: [child],
    });
    const rowH = { 0: NODE_H };
    // parentBottom=4, numRows=3, barRow=2
    // allCols=[18,60], minCol=18, maxCol=60, width=43
    // parent at minCol, not childAtParent → '╰'
    // child at maxCol → '╮'
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    expect(r.col).toBe(18);
    expect(r.row).toBe(4);
    expect(r.width).toBe(43);
    expect(r.height).toBe(3);
    expect(r.color).toBe(mockTheme.borderActive);

    const lines = r.text.split("\n");
    expect(lines.length).toBe(3);
    // stem rows: '│' at col 0, rest spaces
    expect(lines[0]![0]).toBe("│");
    expect(lines[1]![0]).toBe("│");
    // bar row: '╰' at left, '╮' at right
    expect(lines[2]![0]).toBe("╰");
    expect(lines[2]![42]).toBe("╮");
    // bar row filled with '─' between junctions
    expect(lines[2]![1]).toBe("─");
    expect(lines[2]![41]).toBe("─");
  });

  test("two children produces horizontal bar connecting both with correct width", () => {
    // parent: x=0 → pcx=18
    // child1: x=0 → cx=18 (same as parent)
    // child2: x=42 → cx=60
    const child1 = makeNode({ name: "c1", x: 0, y: 7, depth: 1 });
    const child2 = makeNode({ name: "c2", x: 42, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 0,
      y: 0,
      depth: 0,
      children: [child1, child2],
    });
    const rowH = { 0: NODE_H };
    // allCols=[18,18,60], minCol=18, maxCol=60, width=43
    // childAtParent=true (child1.cx=18=pcx)
    // parent at minCol + childAtParent → '├'
    // child2 at maxCol → '╮'
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    expect(r.col).toBe(18);
    expect(r.row).toBe(4);
    expect(r.width).toBe(43);
    expect(r.height).toBe(3);

    const lines = r.text.split("\n");
    const barLine = lines[2]!;
    expect(barLine[0]).toBe("├");
    expect(barLine[42]).toBe("╮");
  });

  test("three children produces wider bar with correct junction characters", () => {
    // parent: x=42 → pcx=60
    // child1: x=0 → cx=18
    // child2: x=42 → cx=60 (same as parent)
    // child3: x=84 → cx=102
    const child1 = makeNode({ name: "c1", x: 0, y: 7, depth: 1 });
    const child2 = makeNode({ name: "c2", x: 42, y: 7, depth: 1 });
    const child3 = makeNode({ name: "c3", x: 84, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 42,
      y: 0,
      depth: 0,
      children: [child1, child2, child3],
    });
    const rowH = { 0: NODE_H };
    // allCols=[60,18,60,102], minCol=18, maxCol=102, width=85
    // childAtParent=true (child2.cx=60=pcx)
    // parent: pcx=60, not at minCol/maxCol → '┼'
    // child1: cx=18=minCol → '╭'
    // child2: cx=60=pcx → skip (cx===pcx)
    // child3: cx=102=maxCol → '╮'
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    expect(r.col).toBe(18);
    expect(r.row).toBe(4);
    expect(r.width).toBe(85);
    expect(r.height).toBe(3);

    const lines = r.text.split("\n");
    const barLine = lines[2]!;
    // child1 junction at local col 0 (cx=18, minCol=18)
    expect(barLine[0]).toBe("╭");
    // parent junction at local col 42 (pcx=60, minCol=18)
    expect(barLine[42]).toBe("┼");
    // child3 junction at local col 84 (cx=102, minCol=18)
    expect(barLine[84]).toBe("╮");
  });

  test("parent at left edge of bar gets ╰ junction", () => {
    // parent: x=0 → pcx=18 (leftmost)
    // child1: x=42 → cx=60
    // child2: x=84 → cx=102
    const child1 = makeNode({ name: "c1", x: 42, y: 7, depth: 1 });
    const child2 = makeNode({ name: "c2", x: 84, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 0,
      y: 0,
      depth: 0,
      children: [child1, child2],
    });
    const rowH = { 0: NODE_H };
    // allCols=[18,60,102], minCol=18=pcx, childAtParent=false → '╰'
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    const barLine = r.text.split("\n")[2]!;
    expect(barLine[0]).toBe("╰");
  });

  test("parent at right edge of bar gets ╯ junction", () => {
    // parent: x=84 → pcx=102 (rightmost)
    // child1: x=0 → cx=18
    // child2: x=42 → cx=60
    const child1 = makeNode({ name: "c1", x: 0, y: 7, depth: 1 });
    const child2 = makeNode({ name: "c2", x: 42, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 84,
      y: 0,
      depth: 0,
      children: [child1, child2],
    });
    const rowH = { 0: NODE_H };
    // allCols=[102,18,60], minCol=18, maxCol=102=pcx, childAtParent=false → '╯'
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    const barLine = r.text.split("\n")[2]!;
    // maxCol - minCol = 84 → local position of pcx = 102 - 18 = 84
    expect(barLine[84]).toBe("╯");
  });

  test("parent in middle of bar gets ┴ junction", () => {
    // parent: x=42 → pcx=60 (middle)
    // child1: x=0 → cx=18
    // child2: x=84 → cx=102
    const child1 = makeNode({ name: "c1", x: 0, y: 7, depth: 1 });
    const child2 = makeNode({ name: "c2", x: 84, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 42,
      y: 0,
      depth: 0,
      children: [child1, child2],
    });
    const rowH = { 0: NODE_H };
    // allCols=[60,18,102], minCol=18, maxCol=102
    // pcx=60: not minCol, not maxCol → childAtParent=false → '┴'
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    const barLine = r.text.split("\n")[2]!;
    // local col of pcx=60: 60-18=42
    expect(barLine[42]).toBe("┴");
  });

  test("child at same column as parent produces ┼ junction", () => {
    // parent: x=42 → pcx=60
    // child1: x=0 → cx=18
    // child2: x=42 → cx=60 (same as parent)
    // child3: x=84 → cx=102
    // childAtParent=true, pcx not at edges → '┼'
    const child1 = makeNode({ name: "c1", x: 0, y: 7, depth: 1 });
    const child2 = makeNode({ name: "c2", x: 42, y: 7, depth: 1 });
    const child3 = makeNode({ name: "c3", x: 84, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 42,
      y: 0,
      depth: 0,
      children: [child1, child2, child3],
    });
    const rowH = { 0: NODE_H };
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    const barLine = r.text.split("\n")[2]!;
    // local col of pcx=60: 60-18=42
    expect(barLine[42]).toBe("┼");
  });

  test("connector color matches theme.borderActive", () => {
    const child = makeNode({ name: "child", x: 0, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 0,
      y: 0,
      depth: 0,
      children: [child],
    });
    const result = buildConnector(parent, { 0: NODE_H }, mockTheme);

    expect(result).not.toBeNull();
    expect((result as ConnectorResult).color).toBe("#aabbcc");
  });

  test("returns null when numRows is less than 1 (children too close to parent)", () => {
    // child.y < parentBottom
    const child = makeNode({ name: "child", x: 0, y: 3, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 0,
      y: 0,
      depth: 0,
      children: [child],
    });
    // rowH[0]=4, parentBottom=4, firstChildRow=3 → numRows=-1 < 1
    const result = buildConnector(parent, { 0: NODE_H }, mockTheme);
    expect(result).toBeNull();
  });

  test("uses rowH override for node height when present", () => {
    // rowH[0]=6 overrides NODE_H=4
    const child = makeNode({ name: "child", x: 0, y: 10, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 0,
      y: 0,
      depth: 0,
      children: [child],
    });
    const rowH = { 0: 6 };
    // parentBottom = 0 + 6 = 6; firstChildRow=10; numRows=4
    const result = buildConnector(parent, rowH, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    expect(r.row).toBe(6);
    expect(r.height).toBe(4);
    expect(r.text).toBe("│\n│\n│\n│");
  });

  test("falls back to NODE_H when depth not in rowH", () => {
    const child = makeNode({ name: "child", x: 0, y: 7, depth: 1 });
    const parent = makeNode({
      name: "parent",
      x: 0,
      y: 0,
      depth: 0,
      children: [child],
    });
    // rowH is empty — should fall back to NODE_H=4
    const result = buildConnector(parent, {}, mockTheme);

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    // parentBottom = 0 + NODE_H = 4; numRows = 7 - 4 = 3
    expect(r.row).toBe(4);
    expect(r.height).toBe(3);
  });
});

// ─── buildMergeConnector ─────────────────────────────────────────────────────

describe("buildMergeConnector", () => {
  test("returns null when child has zero parents", () => {
    const child = makeNode({ name: "child", x: 42, y: 14, depth: 1, parents: [] });
    const result = buildMergeConnector(child, { 0: NODE_H }, {}, mockTheme);
    expect(result).toBeNull();
  });

  test("returns null when child has a single parent", () => {
    const child = makeNode({ name: "child", x: 42, y: 14, depth: 1, parents: ["a"] });
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const result = buildMergeConnector(
      child,
      { 0: NODE_H },
      { a: parentA },
      mockTheme,
    );
    expect(result).toBeNull();
  });

  test("returns null when fewer than 2 parent nodes found in allNodes", () => {
    // child claims two parents, but only one is present in allNodes
    const child = makeNode({
      name: "child",
      x: 42,
      y: 14,
      depth: 1,
      parents: ["a", "missing"],
    });
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const result = buildMergeConnector(
      child,
      { 0: NODE_H },
      { a: parentA },
      mockTheme,
    );
    expect(result).toBeNull();
  });

  test("two parents above produces horizontal bar with parent junctions and vertical stem to child", () => {
    // parentA: x=0 → cx=18
    // parentB: x=84 → cx=102
    // child: x=42 → cx=60
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const parentB = makeNode({ name: "b", x: 84, y: 0, depth: 0 });
    const child = makeNode({
      name: "child",
      x: 42,
      y: 14,
      depth: 1,
      parents: ["a", "b"],
    });
    const rowH = { 0: NODE_H };
    // parentBottom = max(0+4, 0+4) = 4; childTop=14; numRows=10
    // allCols=[18,102,60], minCol=18, maxCol=102, width=85
    // barRow=0
    // cx=18: hasUp=true, hasDown=false, isLeft=true → '╰'
    // cx=102: hasUp=true, hasDown=false, isRight=true → '╯'
    // cx=60: hasUp=false, hasDown=true, not at edges → '┬'
    const result = buildMergeConnector(
      child,
      rowH,
      { a: parentA, b: parentB },
      mockTheme,
    );

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    expect(r.col).toBe(18);
    expect(r.row).toBe(4);
    expect(r.width).toBe(85);
    expect(r.height).toBe(10);
    expect(r.color).toBe(mockTheme.borderActive);

    const lines = r.text.split("\n");
    expect(lines.length).toBe(10);

    const barLine = lines[0]!;
    // parentA junction at local col 0
    expect(barLine[0]).toBe("╰");
    // parentB junction at local col 84
    expect(barLine[84]).toBe("╯");
    // child junction at local col 42 (60-18=42)
    expect(barLine[42]).toBe("┬");

    // Vertical stem in rows 1..9 at local col 42 (childCx=60-18=42)
    for (let r2 = 1; r2 < 10; r2++) {
      expect(lines[r2]![42]).toBe("│");
    }
  });

  test("child at same column as a parent produces ├ or ┤ junction", () => {
    // parentA: x=0 → cx=18 (same as child)
    // parentB: x=84 → cx=102
    // child: x=0 → cx=18
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const parentB = makeNode({ name: "b", x: 84, y: 0, depth: 0 });
    const child = makeNode({
      name: "child",
      x: 0,
      y: 14,
      depth: 1,
      parents: ["a", "b"],
    });
    const rowH = { 0: NODE_H };
    // parentCxs=[18,102], childCx=18
    // allCols=[18,102,18], minCol=18, maxCol=102, width=85
    // parentSet={18,102}
    // cx=18: hasUp=true, hasDown=true, isLeft=true → '├'
    // cx=102: hasUp=true, hasDown=false, isRight=true → '╯'
    // cx=18 again: same result → '├'
    const result = buildMergeConnector(
      child,
      rowH,
      { a: parentA, b: parentB },
      mockTheme,
    );

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    const barLine = r.text.split("\n")[0]!;
    // local col of cx=18: 0
    expect(barLine[0]).toBe("├");
    // local col of cx=102: 84
    expect(barLine[84]).toBe("╯");
  });

  test("three parents produces wider bar with correct junction characters", () => {
    // parentA: x=0 → cx=18
    // parentB: x=42 → cx=60 (same as child)
    // parentC: x=84 → cx=102
    // child: x=42 → cx=60
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const parentB = makeNode({ name: "b", x: 42, y: 0, depth: 0 });
    const parentC = makeNode({ name: "c", x: 84, y: 0, depth: 0 });
    const child = makeNode({
      name: "child",
      x: 42,
      y: 14,
      depth: 1,
      parents: ["a", "b", "c"],
    });
    const rowH = { 0: NODE_H };
    // parentCxs=[18,60,102], childCx=60
    // allCols=[18,60,102,60], minCol=18, maxCol=102, width=85
    // parentSet={18,60,102}
    // cx=18: hasUp=true, hasDown=false, isLeft=true → '╰'
    // cx=60: hasUp=true, hasDown=true, not edges → '┼'
    // cx=102: hasUp=true, hasDown=false, isRight=true → '╯'
    const result = buildMergeConnector(
      child,
      rowH,
      { a: parentA, b: parentB, c: parentC },
      mockTheme,
    );

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    expect(r.col).toBe(18);
    expect(r.width).toBe(85);

    const barLine = r.text.split("\n")[0]!;
    expect(barLine[0]).toBe("╰");
    // local col of cx=60: 60-18=42
    expect(barLine[42]).toBe("┼");
    expect(barLine[84]).toBe("╯");
  });

  test("correct positioning: row equals max parent bottom, height equals childTop minus parentBottom", () => {
    // parentA at y=0, depth=0, rowH[0]=6 → bottom at 6
    // parentB at y=2, depth=0, rowH[0]=6 → bottom at 8 (max)
    // child.y = 20 → numRows = 20 - 8 = 12
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const parentB = makeNode({ name: "b", x: 84, y: 2, depth: 0 });
    const child = makeNode({
      name: "child",
      x: 42,
      y: 20,
      depth: 1,
      parents: ["a", "b"],
    });
    const rowH = { 0: 6 };

    const result = buildMergeConnector(
      child,
      rowH,
      { a: parentA, b: parentB },
      mockTheme,
    );

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    // parentBottom = max(0+6, 2+6) = 8
    expect(r.row).toBe(8);
    // height = 20 - 8 = 12
    expect(r.height).toBe(12);
  });

  test("connector color matches theme.borderActive", () => {
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const parentB = makeNode({ name: "b", x: 84, y: 0, depth: 0 });
    const child = makeNode({
      name: "child",
      x: 42,
      y: 14,
      depth: 1,
      parents: ["a", "b"],
    });
    const result = buildMergeConnector(
      child,
      { 0: NODE_H },
      { a: parentA, b: parentB },
      mockTheme,
    );

    expect(result).not.toBeNull();
    expect((result as ConnectorResult).color).toBe("#aabbcc");
  });

  test("returns null when numRows is less than 1 (child too close to parents)", () => {
    // parents bottom at 4, child.y=3 → numRows=-1
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const parentB = makeNode({ name: "b", x: 84, y: 0, depth: 0 });
    const child = makeNode({
      name: "child",
      x: 42,
      y: 3,
      depth: 1,
      parents: ["a", "b"],
    });
    const result = buildMergeConnector(
      child,
      { 0: NODE_H },
      { a: parentA, b: parentB },
      mockTheme,
    );
    expect(result).toBeNull();
  });

  test("uses NODE_H as fallback when depth not in rowH", () => {
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const parentB = makeNode({ name: "b", x: 84, y: 0, depth: 0 });
    const child = makeNode({
      name: "child",
      x: 42,
      y: 14,
      depth: 1,
      parents: ["a", "b"],
    });
    // empty rowH — falls back to NODE_H=4
    const result = buildMergeConnector(
      child,
      {},
      { a: parentA, b: parentB },
      mockTheme,
    );

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    // parentBottom = 0 + NODE_H = 4
    expect(r.row).toBe(4);
    expect(r.height).toBe(10); // 14 - 4
  });

  test("child at same column as rightmost parent produces ┤ junction at right edge", () => {
    // parentA: x=0 → cx=18
    // parentB: x=84 → cx=102 (same as child)
    // child: x=84 → cx=102
    const parentA = makeNode({ name: "a", x: 0, y: 0, depth: 0 });
    const parentB = makeNode({ name: "b", x: 84, y: 0, depth: 0 });
    const child = makeNode({
      name: "child",
      x: 84,
      y: 14,
      depth: 1,
      parents: ["a", "b"],
    });
    const rowH = { 0: NODE_H };
    // parentCxs=[18,102], childCx=102
    // allCols=[18,102,102], minCol=18, maxCol=102, width=85
    // cx=18: hasUp=true, hasDown=false, isLeft=true → '╰'
    // cx=102: hasUp=true, hasDown=true, isRight=true → '┤'
    const result = buildMergeConnector(
      child,
      rowH,
      { a: parentA, b: parentB },
      mockTheme,
    );

    expect(result).not.toBeNull();
    const r = result as ConnectorResult;
    const barLine = r.text.split("\n")[0]!;
    expect(barLine[0]).toBe("╰");
    expect(barLine[84]).toBe("┤");
  });
});

// ─── Integration tests: connectors with computeLayout-produced nodes ──────

describe("integration with computeLayout", () => {
  test("connector from orchestrator to reclassified orphan child", () => {
    const { computeLayout } = require("./layout.ts");
    const layout = computeLayout([
      { name: "orchestrator", status: "running", parents: [], startedAt: null, endedAt: null },
      { name: "orphan", status: "pending", parents: ["nonexistent"], startedAt: null, endedAt: null },
    ]);
    const orch = layout.map["orchestrator"];
    expect(orch.children).toHaveLength(1);
    const conn = buildConnector(orch, layout.rowH, mockTheme);
    expect(conn).not.toBeNull();
    expect(conn!.height).toBeGreaterThan(0);
  });

  test("connector from parent to reclassified merge-to-single-parent node", () => {
    const { computeLayout } = require("./layout.ts");
    const layout = computeLayout([
      { name: "orchestrator", status: "running", parents: [], startedAt: null, endedAt: null },
      { name: "A", status: "pending", parents: ["orchestrator"], startedAt: null, endedAt: null },
      { name: "M", status: "pending", parents: ["A", "nonexistent"], startedAt: null, endedAt: null },
    ]);
    const nodeA = layout.map["A"];
    expect(nodeA.children).toHaveLength(1);
    expect(nodeA.children[0].name).toBe("M");
    const conn = buildConnector(nodeA, layout.rowH, mockTheme);
    expect(conn).not.toBeNull();
  });

  test("merge connector still works for valid merge nodes", () => {
    const { computeLayout } = require("./layout.ts");
    const layout = computeLayout([
      { name: "A", status: "pending", parents: [], startedAt: null, endedAt: null },
      { name: "B", status: "pending", parents: [], startedAt: null, endedAt: null },
      { name: "M", status: "pending", parents: ["A", "B"], startedAt: null, endedAt: null },
    ]);
    const nodeM = layout.map["M"];
    expect(nodeM.parents).toEqual(["A", "B"]);
    const mergeConn = buildMergeConnector(nodeM, layout.rowH, layout.map, mockTheme);
    expect(mergeConn).not.toBeNull();
    expect(mergeConn!.height).toBeGreaterThan(0);
  });
});
