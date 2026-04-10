import { test, expect, describe } from "bun:test";
import {
  computeLayout,
  NODE_W,
  NODE_H,
  H_GAP,
  V_GAP,
  PAD,
} from "./layout.ts";
import type { SessionData, SessionStatus } from "./orchestrator-panel-types.ts";

// ─── Helpers ──────────────────────────────────────

function session(
  name: string,
  parents: string[] = [],
  status: SessionStatus = "pending",
  extra?: { error?: string; startedAt?: number; endedAt?: number },
): SessionData {
  return {
    name,
    status,
    parents,
    error: extra?.error,
    startedAt: extra?.startedAt ?? null,
    endedAt: extra?.endedAt ?? null,
  };
}

/**
 * y coordinate for a node at depth d, assuming all rows have height NODE_H.
 * yAt(d) = sum_{i=0}^{d-1} (NODE_H + V_GAP)
 */
function yAt(depth: number): number {
  let y = 0;
  for (let i = 0; i < depth; i++) y += NODE_H + V_GAP;
  return y;
}

// ─── Tests ────────────────────────────────────────

describe("computeLayout", () => {
  // ─── 1. Empty input ───────────────────────────

  describe("empty input", () => {
    test("returns empty roots array", () => {
      const result = computeLayout([]);
      expect(result.roots).toHaveLength(0);
    });

    test("returns empty map", () => {
      const result = computeLayout([]);
      expect(Object.keys(result.map)).toHaveLength(0);
    });

    test("returns zero-like dimensions (PAD on each side with no nodes)", () => {
      const result = computeLayout([]);
      // maxX=0, maxY=0 → width=0+PAD, height=0+PAD
      expect(result.width).toBe(PAD);
      expect(result.height).toBe(PAD);
    });

    test("returns empty rowH", () => {
      const result = computeLayout([]);
      expect(Object.keys(result.rowH)).toHaveLength(0);
    });
  });

  // ─── 2. Single node ───────────────────────────

  describe("single node", () => {
    test("produces one root", () => {
      const result = computeLayout([session("A")]);
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0]!.name).toBe("A");
    });

    test("node is in map", () => {
      const result = computeLayout([session("A")]);
      expect(result.map["A"]).toBeDefined();
    });

    test("node depth is 0", () => {
      const result = computeLayout([session("A")]);
      expect(result.map["A"]!.depth).toBe(0);
    });

    test("node is at (PAD, PAD)", () => {
      const result = computeLayout([session("A")]);
      // cursor=0, leaf → x=0; yAt(0)=0; then +PAD
      expect(result.map["A"]!.x).toBe(PAD);
      expect(result.map["A"]!.y).toBe(PAD);
    });

    test("width = NODE_W + 2*PAD", () => {
      const result = computeLayout([session("A")]);
      // maxX = PAD + NODE_W, width = maxX + PAD = NODE_W + 2*PAD
      expect(result.width).toBe(NODE_W + 2 * PAD);
    });

    test("height = NODE_H + 2*PAD", () => {
      const result = computeLayout([session("A")]);
      expect(result.height).toBe(NODE_H + 2 * PAD);
    });

    test("rowH has exactly depth 0 = NODE_H", () => {
      const result = computeLayout([session("A")]);
      expect(result.rowH[0]).toBe(NODE_H);
      expect(Object.keys(result.rowH)).toHaveLength(1);
    });
  });

  // ─── 3. Linear chain A → B → C ───────────────

  describe("linear chain (A → B → C)", () => {
    function makeLinear() {
      return computeLayout([
        session("A"),
        session("B", ["A"]),
        session("C", ["B"]),
      ]);
    }

    test("one root (A)", () => {
      expect(makeLinear().roots).toHaveLength(1);
      expect(makeLinear().roots[0]!.name).toBe("A");
    });

    test("depths are 0, 1, 2", () => {
      const r = makeLinear();
      expect(r.map["A"]!.depth).toBe(0);
      expect(r.map["B"]!.depth).toBe(1);
      expect(r.map["C"]!.depth).toBe(2);
    });

    test("all nodes share the same x (single chain, no branching)", () => {
      const r = makeLinear();
      expect(r.map["A"]!.x).toBe(r.map["B"]!.x);
      expect(r.map["B"]!.x).toBe(r.map["C"]!.x);
    });

    test("all nodes are at x = PAD", () => {
      const r = makeLinear();
      // C (leaf) placed at cursor=0 → x=0+PAD=PAD; B centered over C → x=PAD; A centered over B → x=PAD
      expect(r.map["A"]!.x).toBe(PAD);
    });

    test("y values increase by NODE_H + V_GAP each level", () => {
      const r = makeLinear();
      const step = NODE_H + V_GAP;
      expect(r.map["A"]!.y).toBe(yAt(0) + PAD);
      expect(r.map["B"]!.y).toBe(yAt(1) + PAD);
      expect(r.map["C"]!.y).toBe(yAt(2) + PAD);
      expect(r.map["B"]!.y - r.map["A"]!.y).toBe(step);
      expect(r.map["C"]!.y - r.map["B"]!.y).toBe(step);
    });

    test("rowH has entry for each depth = NODE_H", () => {
      const r = makeLinear();
      expect(r.rowH[0]).toBe(NODE_H);
      expect(r.rowH[1]).toBe(NODE_H);
      expect(r.rowH[2]).toBe(NODE_H);
    });

    test("children's y > parent's y", () => {
      const r = makeLinear();
      expect(r.map["B"]!.y).toBeGreaterThan(r.map["A"]!.y);
      expect(r.map["C"]!.y).toBeGreaterThan(r.map["B"]!.y);
    });
  });

  // ─── 4. Fan-out: A → [B, C] ──────────────────

  describe("fan-out: A → [B, C]", () => {
    function makeFanOut() {
      return computeLayout([
        session("A"),
        session("B", ["A"]),
        session("C", ["A"]),
      ]);
    }

    test("one root (A), two children at depth 1", () => {
      const r = makeFanOut();
      expect(r.roots).toHaveLength(1);
      expect(r.map["B"]!.depth).toBe(1);
      expect(r.map["C"]!.depth).toBe(1);
    });

    test("B and C share the same y", () => {
      const r = makeFanOut();
      expect(r.map["B"]!.y).toBe(r.map["C"]!.y);
    });

    test("B and C y = yAt(1) + PAD", () => {
      const r = makeFanOut();
      expect(r.map["B"]!.y).toBe(yAt(1) + PAD);
    });

    test("B is at x = PAD (leftmost leaf)", () => {
      const r = makeFanOut();
      // B placed first, cursor starts at 0 → x=0+PAD=PAD
      expect(r.map["B"]!.x).toBe(PAD);
    });

    test("C is at x = PAD + NODE_W + H_GAP (second leaf)", () => {
      const r = makeFanOut();
      expect(r.map["C"]!.x).toBe(PAD + NODE_W + H_GAP);
    });

    test("A is horizontally centered above B and C", () => {
      const r = makeFanOut();
      const expectedX = Math.round((r.map["B"]!.x + r.map["C"]!.x) / 2);
      expect(r.map["A"]!.x).toBe(expectedX);
    });

    test("A center aligns with midpoint between B center and C center", () => {
      const r = makeFanOut();
      const aMid = r.map["A"]!.x + Math.floor(NODE_W / 2);
      const bMid = r.map["B"]!.x + Math.floor(NODE_W / 2);
      const cMid = r.map["C"]!.x + Math.floor(NODE_W / 2);
      expect(aMid).toBe(Math.round((bMid + cMid) / 2));
    });

    test("A y < B y (parent above children)", () => {
      const r = makeFanOut();
      expect(r.map["A"]!.y).toBeLessThan(r.map["B"]!.y);
    });

    test("all x values include PAD offset (x >= PAD)", () => {
      const r = makeFanOut();
      for (const node of Object.values(r.map)) {
        expect(node.x).toBeGreaterThanOrEqual(PAD);
      }
    });
  });

  // ─── 5. Fan-out three children: A → [B, C, D] ─

  describe("fan-out three children: A → [B, C, D]", () => {
    function makeFanOut3() {
      return computeLayout([
        session("A"),
        session("B", ["A"]),
        session("C", ["A"]),
        session("D", ["A"]),
      ]);
    }

    test("B, C, D at depth 1 with same y", () => {
      const r = makeFanOut3();
      expect(r.map["B"]!.depth).toBe(1);
      expect(r.map["C"]!.depth).toBe(1);
      expect(r.map["D"]!.depth).toBe(1);
      expect(r.map["B"]!.y).toBe(r.map["C"]!.y);
      expect(r.map["C"]!.y).toBe(r.map["D"]!.y);
    });

    test("children are separated by NODE_W + H_GAP horizontally", () => {
      const r = makeFanOut3();
      expect(r.map["C"]!.x - r.map["B"]!.x).toBe(NODE_W + H_GAP);
      expect(r.map["D"]!.x - r.map["C"]!.x).toBe(NODE_W + H_GAP);
    });

    test("B at x = PAD, C at PAD + NODE_W + H_GAP, D at PAD + 2*(NODE_W + H_GAP)", () => {
      const r = makeFanOut3();
      expect(r.map["B"]!.x).toBe(PAD);
      expect(r.map["C"]!.x).toBe(PAD + NODE_W + H_GAP);
      expect(r.map["D"]!.x).toBe(PAD + 2 * (NODE_W + H_GAP));
    });

    test("A centered above B and D (outermost children)", () => {
      const r = makeFanOut3();
      // place(A) uses first child (B) and last child (D) to center
      const expectedX = Math.round((r.map["B"]!.x + r.map["D"]!.x) / 2);
      expect(r.map["A"]!.x).toBe(expectedX);
    });

    test("A x = PAD + NODE_W + H_GAP (centered over 3 equally spaced children)", () => {
      const r = makeFanOut3();
      // B=0, C=42, D=84 before PAD → A center = round((0+84)/2)=42 → A.x=42+PAD=45
      expect(r.map["A"]!.x).toBe(PAD + NODE_W + H_GAP);
    });
  });

  // ─── 6. Fan-in / merge node: A → C, B → C ────

  describe("fan-in / merge node: A → C, B → C", () => {
    function makeFanIn() {
      return computeLayout([
        session("A"),
        session("B"),
        session("C", ["A", "B"]),
      ]);
    }

    test("A and B are roots, C is a merge node (not in roots)", () => {
      const r = makeFanIn();
      expect(r.roots).toHaveLength(2);
      expect(r.roots.map((n) => n.name)).toContain("A");
      expect(r.roots.map((n) => n.name)).toContain("B");
    });

    test("C depth is max(parent depths) + 1 = 1", () => {
      const r = makeFanIn();
      expect(r.map["C"]!.depth).toBe(1);
    });

    test("A and B have depth 0", () => {
      const r = makeFanIn();
      expect(r.map["A"]!.depth).toBe(0);
      expect(r.map["B"]!.depth).toBe(0);
    });

    test("A and B share the same y = PAD", () => {
      const r = makeFanIn();
      expect(r.map["A"]!.y).toBe(PAD);
      expect(r.map["B"]!.y).toBe(PAD);
    });

    test("B x > A x (roots placed with gap between them)", () => {
      const r = makeFanIn();
      // A placed at cursor=0 → x=PAD; place(A) advances cursor by NODE_W+H_GAP=42;
      // gap before B: cursor += H_GAP → cursor=48; B leaf: x=48+PAD=51
      expect(r.map["A"]!.x).toBe(PAD);
      expect(r.map["B"]!.x).toBe(PAD + NODE_W + 2 * H_GAP);
    });

    test("C is centered horizontally under A and B", () => {
      const r = makeFanIn();
      const aCenterX = r.map["A"]!.x + Math.floor(NODE_W / 2);
      const bCenterX = r.map["B"]!.x + Math.floor(NODE_W / 2);
      const expectedMid = Math.round((aCenterX + bCenterX) / 2);
      const cCenterX = r.map["C"]!.x + Math.floor(NODE_W / 2);
      expect(cCenterX).toBe(expectedMid);
    });

    test("C y = yAt(1) + PAD", () => {
      const r = makeFanIn();
      expect(r.map["C"]!.y).toBe(yAt(1) + PAD);
    });

    test("C y > A y (merge node below parents)", () => {
      const r = makeFanIn();
      expect(r.map["C"]!.y).toBeGreaterThan(r.map["A"]!.y);
    });

    test("C children array is empty (leaf merge node)", () => {
      const r = makeFanIn();
      expect(r.map["C"]!.children).toHaveLength(0);
    });

    test("C parents array preserved", () => {
      const r = makeFanIn();
      expect(r.map["C"]!.parents).toEqual(["A", "B"]);
    });
  });

  // ─── 7. Diamond: A → [B, C], [B, C] → D ──────

  describe("diamond: A → [B, C], [B, C] → D", () => {
    function makeDiamond() {
      return computeLayout([
        session("A"),
        session("B", ["A"]),
        session("C", ["A"]),
        session("D", ["B", "C"]),
      ]);
    }

    test("one root (A)", () => {
      const r = makeDiamond();
      expect(r.roots).toHaveLength(1);
      expect(r.roots[0]!.name).toBe("A");
    });

    test("depths: A=0, B=1, C=1, D=2", () => {
      const r = makeDiamond();
      expect(r.map["A"]!.depth).toBe(0);
      expect(r.map["B"]!.depth).toBe(1);
      expect(r.map["C"]!.depth).toBe(1);
      expect(r.map["D"]!.depth).toBe(2);
    });

    test("D depth = max(B.depth, C.depth) + 1 = 2", () => {
      const r = makeDiamond();
      expect(r.map["D"]!.depth).toBe(2);
    });

    test("B and C at same y", () => {
      const r = makeDiamond();
      expect(r.map["B"]!.y).toBe(r.map["C"]!.y);
    });

    test("y ordering: A < B < D", () => {
      const r = makeDiamond();
      expect(r.map["A"]!.y).toBeLessThan(r.map["B"]!.y);
      expect(r.map["B"]!.y).toBeLessThan(r.map["D"]!.y);
    });

    test("D is centered under B and C (merge node positioning)", () => {
      const r = makeDiamond();
      const bCenterX = r.map["B"]!.x + Math.floor(NODE_W / 2);
      const cCenterX = r.map["C"]!.x + Math.floor(NODE_W / 2);
      const expectedMid = Math.round((bCenterX + cCenterX) / 2);
      const dCenterX = r.map["D"]!.x + Math.floor(NODE_W / 2);
      expect(dCenterX).toBe(expectedMid);
    });

    test("A is centered above B and C", () => {
      const r = makeDiamond();
      const expectedAx = Math.round((r.map["B"]!.x + r.map["C"]!.x) / 2);
      expect(r.map["A"]!.x).toBe(expectedAx);
    });

    test("exact positions: A=(24,3), B=(3,10), C=(45,10), D=(24,17)", () => {
      // B at cursor=0 → x=0+PAD=3; C at cursor=42 → x=42+PAD=45
      // A: round((0+42)/2)+PAD=21+3=24
      // D: centers=[0+18, 42+18]=[18,60], avg=round(39)=39, x=39-18=21, +PAD=24
      const r = makeDiamond();
      expect(r.map["A"]!.x).toBe(24);
      expect(r.map["A"]!.y).toBe(3);
      expect(r.map["B"]!.x).toBe(3);
      expect(r.map["B"]!.y).toBe(10);
      expect(r.map["C"]!.x).toBe(45);
      expect(r.map["C"]!.y).toBe(10);
      expect(r.map["D"]!.x).toBe(24);
      expect(r.map["D"]!.y).toBe(17);
    });

    test("D children is empty", () => {
      const r = makeDiamond();
      expect(r.map["D"]!.children).toHaveLength(0);
    });

    test("rowH has entries for depths 0, 1, 2", () => {
      const r = makeDiamond();
      expect(r.rowH[0]).toBe(NODE_H);
      expect(r.rowH[1]).toBe(NODE_H);
      expect(r.rowH[2]).toBe(NODE_H);
    });
  });

  // ─── 8. Multiple independent roots ────────────

  describe("multiple independent roots: A, B", () => {
    function makeMultiRoot() {
      return computeLayout([session("A"), session("B")]);
    }

    test("both are roots", () => {
      const r = makeMultiRoot();
      expect(r.roots).toHaveLength(2);
    });

    test("root order matches insertion order", () => {
      const r = makeMultiRoot();
      expect(r.roots[0]!.name).toBe("A");
      expect(r.roots[1]!.name).toBe("B");
    });

    test("both at depth 0", () => {
      const r = makeMultiRoot();
      expect(r.map["A"]!.depth).toBe(0);
      expect(r.map["B"]!.depth).toBe(0);
    });

    test("both at same y = PAD", () => {
      const r = makeMultiRoot();
      expect(r.map["A"]!.y).toBe(PAD);
      expect(r.map["B"]!.y).toBe(PAD);
    });

    test("A at x = PAD (first root placed at cursor=0)", () => {
      const r = makeMultiRoot();
      expect(r.map["A"]!.x).toBe(PAD);
    });

    test("B at x = PAD + NODE_W + 2*H_GAP (gap inserted between roots)", () => {
      const r = makeMultiRoot();
      // After A: cursor=NODE_W+H_GAP=42; gap before B: cursor+=H_GAP → 48; B leaf: x=48+PAD=51
      expect(r.map["B"]!.x).toBe(PAD + NODE_W + 2 * H_GAP);
    });

    test("B x > A x", () => {
      const r = makeMultiRoot();
      expect(r.map["B"]!.x).toBeGreaterThan(r.map["A"]!.x);
    });

    test("horizontal separation between leaf roots = NODE_W + 2*H_GAP", () => {
      const r = makeMultiRoot();
      // place(A): A leaf at cursor=0, cursor → NODE_W+H_GAP=42
      // gap before B: cursor += H_GAP → 48
      // place(B): B leaf at cursor=48
      // Separation (before PAD): 48 - 0 = NODE_W + 2*H_GAP
      expect(r.map["B"]!.x - r.map["A"]!.x).toBe(NODE_W + 2 * H_GAP);
    });

    test("three independent roots are each separated by NODE_W + 2*H_GAP", () => {
      const r = computeLayout([session("X"), session("Y"), session("Z")]);
      expect(r.roots).toHaveLength(3);
      // X at 0, cursor→42; gap→48; Y at 48, cursor→90; gap→96; Z at 96
      // After PAD: X=PAD, Y=48+PAD, Z=96+PAD
      expect(r.map["X"]!.x).toBe(PAD);
      expect(r.map["Y"]!.x - r.map["X"]!.x).toBe(NODE_W + 2 * H_GAP);
      expect(r.map["Z"]!.x - r.map["Y"]!.x).toBe(NODE_W + 2 * H_GAP);
    });
  });

  // ─── 9. Deep chain: A → B → C → D → E ────────

  describe("deep chain: A → B → C → D → E", () => {
    function makeDeepChain() {
      return computeLayout([
        session("A"),
        session("B", ["A"]),
        session("C", ["B"]),
        session("D", ["C"]),
        session("E", ["D"]),
      ]);
    }

    test("depths 0 through 4", () => {
      const r = makeDeepChain();
      expect(r.map["A"]!.depth).toBe(0);
      expect(r.map["B"]!.depth).toBe(1);
      expect(r.map["C"]!.depth).toBe(2);
      expect(r.map["D"]!.depth).toBe(3);
      expect(r.map["E"]!.depth).toBe(4);
    });

    test("all nodes share x = PAD (single chain)", () => {
      const r = makeDeepChain();
      for (const name of ["A", "B", "C", "D", "E"]) {
        expect(r.map[name]!.x).toBe(PAD);
      }
    });

    test("y increases by NODE_H + V_GAP each level", () => {
      const r = makeDeepChain();
      const step = NODE_H + V_GAP;
      expect(r.map["A"]!.y).toBe(PAD + yAt(0));
      expect(r.map["B"]!.y).toBe(PAD + yAt(1));
      expect(r.map["C"]!.y).toBe(PAD + yAt(2));
      expect(r.map["D"]!.y).toBe(PAD + yAt(3));
      expect(r.map["E"]!.y).toBe(PAD + yAt(4));
      // Consecutive differences
      expect(r.map["B"]!.y - r.map["A"]!.y).toBe(step);
      expect(r.map["C"]!.y - r.map["B"]!.y).toBe(step);
      expect(r.map["D"]!.y - r.map["C"]!.y).toBe(step);
      expect(r.map["E"]!.y - r.map["D"]!.y).toBe(step);
    });

    test("exact y values: 3, 10, 17, 24, 31", () => {
      const r = makeDeepChain();
      expect(r.map["A"]!.y).toBe(3);
      expect(r.map["B"]!.y).toBe(10);
      expect(r.map["C"]!.y).toBe(17);
      expect(r.map["D"]!.y).toBe(24);
      expect(r.map["E"]!.y).toBe(31);
    });

    test("rowH has 5 entries all equal to NODE_H", () => {
      const r = makeDeepChain();
      for (let d = 0; d < 5; d++) {
        expect(r.rowH[d]).toBe(NODE_H);
      }
      expect(Object.keys(r.rowH)).toHaveLength(5);
    });

    test("height = E.y + NODE_H + PAD", () => {
      const r = makeDeepChain();
      const e = r.map["E"]!;
      expect(r.height).toBe(e.y + NODE_H + PAD);
    });

    test("width = A.x + NODE_W + PAD (single column)", () => {
      const r = makeDeepChain();
      expect(r.width).toBe(PAD + NODE_W + PAD);
    });
  });

  // ─── 10. Merge node with children ─────────────

  describe("merge node with children: A → C, B → C → D", () => {
    // A and B are roots; C is merge node (parents=[A,B]) with child D
    function makeMergeWithChild() {
      return computeLayout([
        session("A"),
        session("B"),
        session("C", ["A", "B"]),
        session("D", ["C"]),
      ]);
    }

    test("A and B are roots, C is merge node not in roots", () => {
      const r = makeMergeWithChild();
      expect(r.roots).toHaveLength(2);
      const rootNames = r.roots.map((n) => n.name);
      expect(rootNames).toContain("A");
      expect(rootNames).toContain("B");
      expect(rootNames).not.toContain("C");
    });

    test("depths: A=0, B=0, C=1, D=2", () => {
      const r = makeMergeWithChild();
      expect(r.map["A"]!.depth).toBe(0);
      expect(r.map["B"]!.depth).toBe(0);
      expect(r.map["C"]!.depth).toBe(1);
      expect(r.map["D"]!.depth).toBe(2);
    });

    test("C center is horizontally aligned with midpoint of A and B centers", () => {
      const r = makeMergeWithChild();
      const aCenterX = r.map["A"]!.x + Math.floor(NODE_W / 2);
      const bCenterX = r.map["B"]!.x + Math.floor(NODE_W / 2);
      const expectedMid = Math.round((aCenterX + bCenterX) / 2);
      const cCenterX = r.map["C"]!.x + Math.floor(NODE_W / 2);
      expect(cCenterX).toBe(expectedMid);
    });

    test("D is directly below C (same x as C after shift)", () => {
      const r = makeMergeWithChild();
      // D is a single child of C → centered over D means D.x = C.x after shift
      expect(r.map["D"]!.x).toBe(r.map["C"]!.x);
    });

    test("D y = yAt(2) + PAD", () => {
      const r = makeMergeWithChild();
      expect(r.map["D"]!.y).toBe(yAt(2) + PAD);
    });

    test("exact positions: A=(3,3), B=(51,3), C=(27,10), D=(27,17)", () => {
      // A placed at cursor=0 → x=PAD=3; after A: cursor=42; gap: cursor=48; B at 48 → x=51
      // C merge, has child D:
      //   place(C) → place(D) at cursor=90 → D.x=90; C centered: x=90; currentCenter=108
      //   parentCenters=[18,66], avg=42; dx=42-108=-66
      //   C.x=90-66=24 → +PAD=27; D.x=90-66=24 → +PAD=27
      const r = makeMergeWithChild();
      expect(r.map["A"]!.x).toBe(3);
      expect(r.map["A"]!.y).toBe(3);
      expect(r.map["B"]!.x).toBe(51);
      expect(r.map["B"]!.y).toBe(3);
      expect(r.map["C"]!.x).toBe(27);
      expect(r.map["C"]!.y).toBe(10);
      expect(r.map["D"]!.x).toBe(27);
      expect(r.map["D"]!.y).toBe(17);
    });

    test("all x values are >= PAD", () => {
      const r = makeMergeWithChild();
      for (const node of Object.values(r.map)) {
        expect(node.x).toBeGreaterThanOrEqual(PAD);
      }
    });

    test("width >= rightmost node x + NODE_W + PAD", () => {
      const r = makeMergeWithChild();
      const rightmost = Math.max(...Object.values(r.map).map((n) => n.x + NODE_W));
      expect(r.width).toBe(rightmost + PAD);
    });

    test("height >= bottommost node y + NODE_H + PAD", () => {
      const r = makeMergeWithChild();
      const bottommost = Math.max(...Object.values(r.map).map((n) => n.y + NODE_H));
      expect(r.height).toBe(bottommost + PAD);
    });
  });

  // ─── 11. Collision detection: merge-node shift causes overlap ─

  describe("collision detection: A→B, C, [A,C]→M→M1", () => {
    // A has child B; C is a standalone root; M is a merge node (parents=[A,C])
    // with child M1.  Without collision detection, shifting M to center under
    // A and C would cause M to overlap with B at depth 1.
    function makeOverlap() {
      return computeLayout([
        session("A"),
        session("B", ["A"]),
        session("C"),
        session("M", ["A", "C"]),
        session("M1", ["M"]),
      ]);
    }

    test("no nodes at the same depth overlap horizontally", () => {
      const r = makeOverlap();
      const byDepth: Record<number, Array<{ name: string; x: number }>> = {};
      for (const n of Object.values(r.map)) {
        (byDepth[n.depth] ??= []).push({ name: n.name, x: n.x });
      }
      for (const nodes of Object.values(byDepth)) {
        nodes.sort((a, b) => a.x - b.x);
        for (let i = 1; i < nodes.length; i++) {
          const prev = nodes[i - 1]!;
          const curr = nodes[i]!;
          expect(curr.x).toBeGreaterThanOrEqual(
            prev.x + NODE_W + H_GAP,
          );
        }
      }
    });

    test("M and B are both at depth 1 but do not overlap", () => {
      const r = makeOverlap();
      expect(r.map["B"]!.depth).toBe(1);
      expect(r.map["M"]!.depth).toBe(1);
      const gap = Math.abs(r.map["M"]!.x - r.map["B"]!.x);
      expect(gap).toBeGreaterThanOrEqual(NODE_W + H_GAP);
    });

    test("M1 is a child of M (depth 2)", () => {
      const r = makeOverlap();
      expect(r.map["M1"]!.depth).toBe(2);
    });

    test("all x values are >= PAD after collision resolution", () => {
      const r = makeOverlap();
      for (const node of Object.values(r.map)) {
        expect(node.x).toBeGreaterThanOrEqual(PAD);
      }
    });
  });

  // ─── 12. Status and error propagation ─────────

  describe("status and error propagation", () => {
    test("preserves 'pending' status", () => {
      const r = computeLayout([session("A", [], "pending")]);
      expect(r.map["A"]!.status).toBe("pending");
    });

    test("preserves 'running' status", () => {
      const r = computeLayout([session("A", [], "running")]);
      expect(r.map["A"]!.status).toBe("running");
    });

    test("preserves 'complete' status", () => {
      const r = computeLayout([session("A", [], "complete")]);
      expect(r.map["A"]!.status).toBe("complete");
    });

    test("preserves 'error' status", () => {
      const r = computeLayout([session("A", [], "error")]);
      expect(r.map["A"]!.status).toBe("error");
    });

    test("preserves error message", () => {
      const r = computeLayout([
        session("A", [], "error", { error: "something went wrong" }),
      ]);
      expect(r.map["A"]!.error).toBe("something went wrong");
    });

    test("error is undefined when not provided", () => {
      const r = computeLayout([session("A")]);
      expect(r.map["A"]!.error).toBeUndefined();
    });

    test("preserves startedAt timestamp", () => {
      const r = computeLayout([
        session("A", [], "running", { startedAt: 1700000000000 }),
      ]);
      expect(r.map["A"]!.startedAt).toBe(1700000000000);
    });

    test("preserves endedAt timestamp", () => {
      const r = computeLayout([
        session("A", [], "complete", { startedAt: 100, endedAt: 200 }),
      ]);
      expect(r.map["A"]!.endedAt).toBe(200);
    });

    test("startedAt and endedAt are null when not provided", () => {
      const r = computeLayout([session("A")]);
      expect(r.map["A"]!.startedAt).toBeNull();
      expect(r.map["A"]!.endedAt).toBeNull();
    });

    test("preserves all fields on a node with mixed statuses in the graph", () => {
      const sessions: SessionData[] = [
        { name: "start", status: "complete", parents: [], startedAt: 1000, endedAt: 2000 },
        { name: "mid", status: "running", parents: ["start"], startedAt: 2001, endedAt: null },
        { name: "end", status: "error", parents: ["mid"], error: "timed out", startedAt: 3000, endedAt: 3500 },
      ];
      const r = computeLayout(sessions);

      expect(r.map["start"]!.status).toBe("complete");
      expect(r.map["start"]!.startedAt).toBe(1000);
      expect(r.map["start"]!.endedAt).toBe(2000);
      expect(r.map["start"]!.error).toBeUndefined();

      expect(r.map["mid"]!.status).toBe("running");
      expect(r.map["mid"]!.startedAt).toBe(2001);
      expect(r.map["mid"]!.endedAt).toBeNull();

      expect(r.map["end"]!.status).toBe("error");
      expect(r.map["end"]!.error).toBe("timed out");
      expect(r.map["end"]!.startedAt).toBe(3000);
      expect(r.map["end"]!.endedAt).toBe(3500);
    });

    test("preserves parents array on layout nodes", () => {
      const r = computeLayout([
        session("A"),
        session("B"),
        session("C", ["A", "B"]),
      ]);
      expect(r.map["C"]!.parents).toEqual(["A", "B"]);
    });

    test("preserves name on layout nodes", () => {
      const r = computeLayout([session("my-session-name")]);
      expect(r.map["my-session-name"]!.name).toBe("my-session-name");
    });
  });

  // ─── Invariants applying to all layouts ───────

  describe("layout invariants", () => {
    const TOPOLOGIES = [
      {
        name: "single node",
        sessions: () => [session("A")],
      },
      {
        name: "linear chain",
        sessions: () => [session("A"), session("B", ["A"]), session("C", ["B"])],
      },
      {
        name: "fan-out",
        sessions: () => [session("A"), session("B", ["A"]), session("C", ["A"])],
      },
      {
        name: "fan-in merge",
        sessions: () => [session("A"), session("B"), session("C", ["A", "B"])],
      },
      {
        name: "diamond",
        sessions: () => [
          session("A"),
          session("B", ["A"]),
          session("C", ["A"]),
          session("D", ["B", "C"]),
        ],
      },
      {
        name: "multiple roots",
        sessions: () => [session("X"), session("Y"), session("Z")],
      },
      {
        name: "merge-node overlap (A→B, C, [A,C]→M→M1)",
        sessions: () => [
          session("A"),
          session("B", ["A"]),
          session("C"),
          session("M", ["A", "C"]),
          session("M1", ["M"]),
        ],
      },
    ];

    for (const topo of TOPOLOGIES) {
      test(`[${topo.name}] all x values are >= PAD`, () => {
        const r = computeLayout(topo.sessions());
        for (const node of Object.values(r.map)) {
          expect(node.x).toBeGreaterThanOrEqual(PAD);
        }
      });

      test(`[${topo.name}] all y values are >= PAD`, () => {
        const r = computeLayout(topo.sessions());
        for (const node of Object.values(r.map)) {
          expect(node.y).toBeGreaterThanOrEqual(PAD);
        }
      });

      test(`[${topo.name}] width = max(node.x + NODE_W) + PAD`, () => {
        const r = computeLayout(topo.sessions());
        const rightmost = Math.max(...Object.values(r.map).map((n) => n.x + NODE_W));
        expect(r.width).toBe(rightmost + PAD);
      });

      test(`[${topo.name}] height = max(node.y + NODE_H) + PAD`, () => {
        const r = computeLayout(topo.sessions());
        const bottommost = Math.max(...Object.values(r.map).map((n) => n.y + NODE_H));
        expect(r.height).toBe(bottommost + PAD);
      });

      test(`[${topo.name}] nodes at same depth share the same y`, () => {
        const r = computeLayout(topo.sessions());
        const byDepth: Record<number, number[]> = {};
        for (const node of Object.values(r.map)) {
          (byDepth[node.depth] ??= []).push(node.y);
        }
        for (const ys of Object.values(byDepth)) {
          const first = ys[0]!;
          for (const y of ys) expect(y).toBe(first);
        }
      });

      test(`[${topo.name}] rowH[d] = NODE_H for all used depths`, () => {
        const r = computeLayout(topo.sessions());
        for (const d of Object.keys(r.rowH)) {
          expect(r.rowH[Number(d)]).toBe(NODE_H);
        }
      });

      test(`[${topo.name}] no horizontal overlap between nodes at same depth`, () => {
        const r = computeLayout(topo.sessions());
        const byDepth: Record<number, number[]> = {};
        for (const node of Object.values(r.map)) {
          (byDepth[node.depth] ??= []).push(node.x);
        }
        for (const xs of Object.values(byDepth)) {
          xs.sort((a, b) => a - b);
          for (let i = 1; i < xs.length; i++) {
            expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(NODE_W + H_GAP);
          }
        }
      });
    }
  });

  // ─── Edge cases: parent normalization ─────────

  describe("missing parent fallback", () => {
    test("session with missing parent falls back to orchestrator child", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("orphan", ["nonexistent"]),
      ]);
      // orphan should be a child of orchestrator, not a root
      expect(r.roots).toHaveLength(1);
      expect(r.roots[0]!.name).toBe("orchestrator");
      expect(r.map["orchestrator"]!.children).toHaveLength(1);
      expect(r.map["orchestrator"]!.children[0]!.name).toBe("orphan");
      expect(r.map["orphan"]!.depth).toBe(1);
    });

    test("session with missing parent and no orchestrator becomes root", () => {
      const r = computeLayout([
        session("A"),
        session("orphan", ["nonexistent"]),
      ]);
      // Without orchestrator, orphan becomes a root alongside A
      expect(r.roots).toHaveLength(2);
      expect(r.roots.map((n) => n.name)).toContain("orphan");
    });

    test("preserves raw parents array on LayoutNode even when normalized", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("orphan", ["nonexistent"]),
      ]);
      // raw parents metadata should be unchanged
      expect(r.map["orphan"]!.parents).toEqual(["nonexistent"]);
    });

    test("multiple orphans all fall back to orchestrator", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("a", ["ghost-1"]),
        session("b", ["ghost-2"]),
      ]);
      expect(r.roots).toHaveLength(1);
      expect(r.map["orchestrator"]!.children).toHaveLength(2);
      expect(r.map["a"]!.depth).toBe(1);
      expect(r.map["b"]!.depth).toBe(1);
    });

    test("valid parent takes priority over orchestrator fallback", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("step-1", ["orchestrator"]),
        session("child", ["step-1"]),
      ]);
      // child should be under step-1, not orchestrator
      expect(r.map["step-1"]!.children).toHaveLength(1);
      expect(r.map["step-1"]!.children[0]!.name).toBe("child");
      expect(r.map["child"]!.depth).toBe(2);
    });

    test("orchestrator itself does not get reparented to itself", () => {
      const r = computeLayout([session("orchestrator")]);
      expect(r.roots).toHaveLength(1);
      expect(r.roots[0]!.name).toBe("orchestrator");
      expect(r.map["orchestrator"]!.children).toHaveLength(0);
    });
  });

  describe("merge node with missing parents", () => {
    test("merge with one missing parent reclassified as single-parent child", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("A", ["orchestrator"]),
        session("M", ["A", "nonexistent"]),
      ]);
      // M should become a single-parent child of A (not a merge node)
      expect(r.map["A"]!.children).toHaveLength(1);
      expect(r.map["A"]!.children[0]!.name).toBe("M");
      expect(r.map["M"]!.depth).toBe(2);
    });

    test("merge with all missing parents falls back to orchestrator child", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("M", ["ghost-1", "ghost-2"]),
      ]);
      // All parents missing → falls back to orchestrator
      expect(r.map["orchestrator"]!.children).toHaveLength(1);
      expect(r.map["orchestrator"]!.children[0]!.name).toBe("M");
      expect(r.map["M"]!.depth).toBe(1);
    });

    test("merge with duplicate parents after filtering is deduplicated", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("A", ["orchestrator"]),
        session("M", ["A", "A"]),
      ]);
      // Duplicate "A" deduplicated → single parent → tree child of A
      expect(r.map["A"]!.children).toHaveLength(1);
      expect(r.map["A"]!.children[0]!.name).toBe("M");
    });
  });

  describe("chained merge node ordering", () => {
    test("merge nodes in reverse order get correct depths", () => {
      // M2 depends on M1, but M2 appears first in the sessions array
      const r = computeLayout([
        session("A"),
        session("B"),
        session("C"),
        session("M2", ["M1", "C"]),  // M2 before M1 in array
        session("M1", ["A", "B"]),
      ]);
      expect(r.map["M1"]!.depth).toBe(1);
      expect(r.map["M2"]!.depth).toBe(2); // must be deeper than M1
    });

    test("indirect merge dependency: A,B → M1 → X; C,X → M2", () => {
      const r = computeLayout([
        session("A"),
        session("B"),
        session("C"),
        session("M1", ["A", "B"]),
        session("X", ["M1"]),
        session("M2", ["C", "X"]),
      ]);
      expect(r.map["M1"]!.depth).toBe(1);
      expect(r.map["X"]!.depth).toBe(2);
      expect(r.map["M2"]!.depth).toBe(3);
    });

    test("indirect merge dependency in forward session order", () => {
      const r = computeLayout([
        session("A"),
        session("B"),
        session("C"),
        session("M1", ["A", "B"]),
        session("X", ["M1"]),
        session("M2", ["C", "X"]),
      ]);
      expect(r.map["M1"]!.depth).toBe(1);
      expect(r.map["X"]!.depth).toBe(2);
      expect(r.map["M2"]!.depth).toBe(3);
    });
  });

  describe("deeply nested tree", () => {
    test("four levels of nesting with orchestrator", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("step-1", ["orchestrator"]),
        session("step-2", ["step-1"]),
        session("step-3", ["step-2"]),
        session("step-4", ["step-3"]),
      ]);
      expect(r.map["orchestrator"]!.depth).toBe(0);
      expect(r.map["step-1"]!.depth).toBe(1);
      expect(r.map["step-2"]!.depth).toBe(2);
      expect(r.map["step-3"]!.depth).toBe(3);
      expect(r.map["step-4"]!.depth).toBe(4);
      // All share x (single chain)
      const x0 = r.map["orchestrator"]!.x;
      for (const name of ["step-1", "step-2", "step-3", "step-4"]) {
        expect(r.map[name]!.x).toBe(x0);
      }
    });
  });

  describe("merge node as single parent", () => {
    test("child of merge node is placed correctly", () => {
      const r = computeLayout([
        session("A"),
        session("B"),
        session("M", ["A", "B"]),
        session("child", ["M"]),
      ]);
      expect(r.map["M"]!.depth).toBe(1);
      expect(r.map["child"]!.depth).toBe(2);
      // child should be directly below M
      expect(r.map["child"]!.x).toBe(r.map["M"]!.x);
    });
  });

  describe("wide fan-out from non-root node", () => {
    test("multiple children of a mid-tree node", () => {
      const r = computeLayout([
        session("orchestrator"),
        session("parent", ["orchestrator"]),
        session("c1", ["parent"]),
        session("c2", ["parent"]),
        session("c3", ["parent"]),
      ]);
      expect(r.map["parent"]!.depth).toBe(1);
      expect(r.map["c1"]!.depth).toBe(2);
      expect(r.map["c2"]!.depth).toBe(2);
      expect(r.map["c3"]!.depth).toBe(2);
      // parent centered over children
      const parentX = r.map["parent"]!.x;
      const c1X = r.map["c1"]!.x;
      const c3X = r.map["c3"]!.x;
      expect(parentX).toBe(Math.round((c1X + c3X) / 2));
    });
  });

  // ─── Extended invariants for new topologies ───

  describe("layout invariants (extended edge cases)", () => {
    const EDGE_TOPOLOGIES = [
      {
        name: "missing parent → orchestrator fallback",
        sessions: () => [
          session("orchestrator"),
          session("orphan", ["nonexistent"]),
        ],
      },
      {
        name: "merge with missing parent reclassified",
        sessions: () => [
          session("orchestrator"),
          session("A", ["orchestrator"]),
          session("M", ["A", "nonexistent"]),
        ],
      },
      {
        name: "chained merges in reverse order",
        sessions: () => [
          session("A"),
          session("B"),
          session("C"),
          session("M2", ["M1", "C"]),
          session("M1", ["A", "B"]),
        ],
      },
      {
        name: "indirect merge dependency",
        sessions: () => [
          session("A"),
          session("B"),
          session("C"),
          session("M1", ["A", "B"]),
          session("X", ["M1"]),
          session("M2", ["C", "X"]),
        ],
      },
      {
        name: "deeply nested (5 levels)",
        sessions: () => [
          session("orchestrator"),
          session("s1", ["orchestrator"]),
          session("s2", ["s1"]),
          session("s3", ["s2"]),
          session("s4", ["s3"]),
        ],
      },
      {
        name: "wide fan-out from non-root",
        sessions: () => [
          session("orchestrator"),
          session("parent", ["orchestrator"]),
          session("c1", ["parent"]),
          session("c2", ["parent"]),
          session("c3", ["parent"]),
        ],
      },
    ];

    for (const topo of EDGE_TOPOLOGIES) {
      test(`[${topo.name}] all x values are >= PAD`, () => {
        const r = computeLayout(topo.sessions());
        for (const node of Object.values(r.map)) {
          expect(node.x).toBeGreaterThanOrEqual(PAD);
        }
      });

      test(`[${topo.name}] all y values are >= PAD`, () => {
        const r = computeLayout(topo.sessions());
        for (const node of Object.values(r.map)) {
          expect(node.y).toBeGreaterThanOrEqual(PAD);
        }
      });

      test(`[${topo.name}] width = max(node.x + NODE_W) + PAD`, () => {
        const r = computeLayout(topo.sessions());
        const rightmost = Math.max(...Object.values(r.map).map((n) => n.x + NODE_W));
        expect(r.width).toBe(rightmost + PAD);
      });

      test(`[${topo.name}] height = max(node.y + NODE_H) + PAD`, () => {
        const r = computeLayout(topo.sessions());
        const bottommost = Math.max(...Object.values(r.map).map((n) => n.y + NODE_H));
        expect(r.height).toBe(bottommost + PAD);
      });

      test(`[${topo.name}] nodes at same depth share the same y`, () => {
        const r = computeLayout(topo.sessions());
        const byDepth: Record<number, number[]> = {};
        for (const node of Object.values(r.map)) {
          (byDepth[node.depth] ??= []).push(node.y);
        }
        for (const ys of Object.values(byDepth)) {
          const first = ys[0]!;
          for (const y of ys) expect(y).toBe(first);
        }
      });

      test(`[${topo.name}] no horizontal overlap between nodes at same depth`, () => {
        const r = computeLayout(topo.sessions());
        const byDepth: Record<number, number[]> = {};
        for (const node of Object.values(r.map)) {
          (byDepth[node.depth] ??= []).push(node.x);
        }
        for (const xs of Object.values(byDepth)) {
          xs.sort((a, b) => a - b);
          for (let i = 1; i < xs.length; i++) {
            expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(NODE_W + H_GAP);
          }
        }
      });
    }
  });
});
