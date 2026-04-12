/**
 * Determine how many parallel explorer sub-agents to spawn for the
 * deep-research-codebase workflow, based on lines of code in the codebase.
 *
 * The heuristic balances coverage against coordination overhead:
 *   - Too few explorers leave parts of the codebase under-investigated.
 *   - Too many explorers flood the aggregator with redundant findings,
 *     burn tokens on coordination, and exhaust tmux/process budgets.
 *
 * Tier choices were anchored to the rough sizes of common project shapes:
 *
 *   <    5,000 LOC →  2 explorers   scripts, single-purpose tools
 *   <   25,000 LOC →  3 explorers   small libraries, CLI utilities
 *   <  100,000 LOC →  5 explorers   medium applications
 *   <  500,000 LOC →  7 explorers   large applications, small monorepos
 *   <2,000,000 LOC →  9 explorers   large monorepos
 *   ≥2,000,000 LOC → 12 explorers   massive monorepos (hard cap)
 *
 * The hard cap of 12 prevents runaway parallelism: each explorer is a
 * Claude tmux pane plus an LLM session, so the cost grows linearly in
 * tokens, processes, and walltime as well as in aggregator context.
 */
export function calculateExplorerCount(loc: number): number {
  if (!Number.isFinite(loc) || loc <= 0) return 2;
  if (loc < 5_000) return 2;
  if (loc < 25_000) return 3;
  if (loc < 100_000) return 5;
  if (loc < 500_000) return 7;
  if (loc < 2_000_000) return 9;
  return 12;
}

/** Human-readable rationale for the heuristic decision — surfaced in logs/prompts. */
export function explainHeuristic(loc: number, count: number): string {
  return `Codebase: ${loc.toLocaleString()} LOC → spawning ${count} parallel explorer${
    count === 1 ? "" : "s"
  }.`;
}
