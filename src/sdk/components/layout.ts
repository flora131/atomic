// ─── Layout ───────────────────────────────────────

import type { SessionData, SessionStatus } from "./orchestrator-panel-types.ts";

// ─── Layout Constants ─────────────────────────────

export const NODE_W = 36;
export const NODE_H = 4;
export const H_GAP = 6;
export const V_GAP = 3;
export const PAD = 3;

// ─── Layout Types ─────────────────────────────────

export interface LayoutNode {
  name: string;
  status: SessionStatus;
  parents: string[];
  error?: string;
  startedAt: number | null;
  endedAt: number | null;
  children: LayoutNode[];
  depth: number;
  x: number;
  y: number;
}

export interface LayoutResult {
  roots: LayoutNode[];
  map: Record<string, LayoutNode>;
  rowH: Record<number, number>;
  width: number;
  height: number;
}

// ─── Layout Helpers ──────────────────────────────

/** Shift a node and all its tree descendants by `dx` pixels horizontally. */
function shiftSubtree(n: LayoutNode, dx: number): void {
  n.x += dx;
  for (const c of n.children) shiftSubtree(c, dx);
}

/**
 * Walk every depth level and push overlapping nodes apart.
 * Merge-node shifts can cause a sub-tree to land on top of nodes that
 * were already placed by the root-tree pass.  This resolves those
 * collisions by nudging the rightmost overlapping node (and its
 * descendants) to the right.
 */
function resolveOverlaps(map: Record<string, LayoutNode>): void {
  const byDepth: Record<number, LayoutNode[]> = {};
  for (const n of Object.values(map)) {
    (byDepth[n.depth] ??= []).push(n);
  }

  const depths = Object.keys(byDepth).map(Number).sort((a, b) => a - b);
  for (const d of depths) {
    const nodes = byDepth[d]!;
    if (nodes.length < 2) continue;
    nodes.sort((a, b) => a.x - b.x);
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1]!;
      const curr = nodes[i]!;
      const minX = prev.x + NODE_W + H_GAP;
      if (curr.x < minX) {
        shiftSubtree(curr, minX - curr.x);
      }
    }
  }
}

// ─── Layout Computation ───────────────────────────

/**
 * Compute effective parents for each session by filtering out references
 * to sessions that don't exist in the map and deduplicating.  Orphaned
 * sessions (all parents missing) fall back to the "orchestrator" node
 * when one is present, instead of becoming disconnected roots.
 */
function normalizeParents(
  sessions: SessionData[],
  map: Record<string, LayoutNode>,
): Map<string, string[]> {
  const hasOrchestrator = "orchestrator" in map;
  const effective = new Map<string, string[]>();

  for (const s of sessions) {
    const valid = [...new Set(s.parents)].filter((p) => p in map);
    if (valid.length > 0) {
      effective.set(s.name, valid);
    } else if (hasOrchestrator && s.name !== "orchestrator") {
      effective.set(s.name, ["orchestrator"]);
    } else {
      effective.set(s.name, []);
    }
  }
  return effective;
}

export function computeLayout(sessions: SessionData[]): LayoutResult {
  const map: Record<string, LayoutNode> = {};
  const roots: LayoutNode[] = [];
  const mergeNodes: LayoutNode[] = [];

  for (const s of sessions) {
    map[s.name] = {
      name: s.name,
      status: s.status,
      parents: s.parents,
      error: s.error,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      children: [],
      depth: 0,
      x: 0,
      y: 0,
    };
  }

  // Normalize parents: filter missing refs, dedupe, orchestrator fallback
  const effective = normalizeParents(sessions, map);

  // Classify using effective parents (preserves LayoutNode.parents as raw metadata)
  for (const s of sessions) {
    const ep = effective.get(s.name) ?? [];
    if (ep.length > 1) {
      mergeNodes.push(map[s.name]!);
    } else if (ep.length === 1 && map[ep[0]!]) {
      map[ep[0]!]!.children.push(map[s.name]!);
    } else {
      roots.push(map[s.name]!);
    }
  }

  // Memoized depth resolution — handles tree children, merge nodes,
  // indirect dependencies, and arbitrary session ordering.
  const depthCache = new Map<string, number>();
  function resolveDepth(name: string): number {
    if (depthCache.has(name)) return depthCache.get(name)!;
    depthCache.set(name, 0); // guard against cycles
    const ep = effective.get(name) ?? [];
    if (ep.length === 0) return 0;
    const maxParentDepth = Math.max(...ep.map((p) => resolveDepth(p)));
    const depth = maxParentDepth + 1;
    depthCache.set(name, depth);
    return depth;
  }
  for (const s of sessions) {
    map[s.name]!.depth = resolveDepth(s.name);
  }

  const rowH: Record<number, number> = {};
  for (const n of Object.values(map)) {
    rowH[n.depth] = Math.max(rowH[n.depth] ?? 0, NODE_H);
  }

  function yAt(d: number): number {
    let y = 0;
    for (let i = 0; i < d; i++) y += (rowH[i] ?? NODE_H) + V_GAP;
    return y;
  }

  let cursor = 0;

  function place(n: LayoutNode) {
    if (n.children.length === 0) {
      n.x = cursor;
      n.y = yAt(n.depth);
      cursor += NODE_W + H_GAP;
    } else {
      for (const c of n.children) place(c);
      const first = n.children[0]!;
      const last = n.children[n.children.length - 1]!;
      n.x = Math.round((first.x + last.x) / 2);
      n.y = yAt(n.depth);
    }
  }

  let firstRoot = true;
  for (const r of roots) {
    if (!firstRoot) cursor += H_GAP;
    place(r);
    firstRoot = false;
  }

  // Place merge nodes centered under all effective parents (and their sub-trees)
  for (const m of mergeNodes) {
    const ep = effective.get(m.name) ?? [];
    const parentCenters = ep.map((p) => (map[p]?.x ?? 0) + Math.floor(NODE_W / 2));
    const avgCenter = Math.round(parentCenters.reduce((a, b) => a + b, 0) / parentCenters.length);

    if (m.children.length > 0) {
      // Place sub-tree first, then shift to center under parents
      place(m);
      const currentCenter = m.x + Math.floor(NODE_W / 2);
      const dx = avgCenter - currentCenter;
      shiftSubtree(m, dx);
    } else {
      m.x = avgCenter - Math.floor(NODE_W / 2);
      m.y = yAt(m.depth);
    }
  }

  // Resolve horizontal overlaps that merge-node shifts may have introduced.
  // Process depths in ascending order so child shifts cascade correctly.
  resolveOverlaps(map);

  for (const n of Object.values(map)) {
    n.x += PAD;
    n.y += PAD;
  }

  let maxX = 0;
  let maxY = 0;
  for (const n of Object.values(map)) {
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + NODE_H);
  }

  return { roots, map, rowH, width: maxX + PAD, height: maxY + PAD };
}
