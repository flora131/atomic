/** Target LOC per explorer sub-agent. */
const LOC_PER_EXPLORER = 2_500;

/**
 * Determine how many parallel explorer sub-agents to spawn for the
 * deep-research-codebase workflow, based on lines of code in the codebase.
 *
 * Scales linearly: one explorer per `LOC_PER_EXPLORER` (2.5K) lines of code,
 * with a floor of 2 for tiny or empty codebases. The actual number of
 * spawned explorers is still bounded by the number of partition units
 * the scout finds (see `partitionUnits` in ./scout.ts), so we never get
 * more explorers than the natural granularity of the codebase allows.
 */
export function calculateExplorerCount(loc: number): number {
  if (!Number.isFinite(loc) || loc <= 0) return 2;
  return Math.max(2, Math.ceil(loc / LOC_PER_EXPLORER));
}

/** Human-readable rationale for the heuristic decision — surfaced in logs/prompts. */
export function explainHeuristic(loc: number, count: number): string {
  return `Codebase: ${loc.toLocaleString()} LOC → spawning ${count} parallel explorer${
    count === 1 ? "" : "s"
  }.`;
}
