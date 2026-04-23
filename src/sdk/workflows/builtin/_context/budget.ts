/**
 * Thresholds and budget utilities shared by builtin workflows.
 *
 * All thresholds are **heuristics** — tuned from practical observation of
 * Ralph and deep-research-codebase runs, not derived from a model-specific
 * benchmark. Keep them together here so a single change in policy updates
 * every consumer.
 */

/** Approx chars-per-token for English + code mix. Used for budget guards only. */
export const CHARS_PER_TOKEN = 4;

/** Estimate token count from a string. Deliberately conservative. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Fraction of effective window at which compaction should trigger. */
export const COMPACT_TRIGGER_FRACTION = 0.7;

/**
 * Aggregator pre-flight: when the sum of per-partition scratch-file sizes
 * exceeds this many chars, compact each oversized scratch before the
 * aggregator reads them. Empirically chosen — ~150K chars ≈ 37K tokens.
 */
export const SCRATCH_COMPACT_THRESHOLD = 150_000;

/**
 * Debugger report fallback cap. When `extractMarkdownBlock` can't find a
 * fenced ```markdown block, we keep head+tail up to this many chars to
 * avoid injecting a 30K-token raw transcript into the next planner prompt.
 */
export const MAX_DEBUGGER_REPORT_CHARS = 8_000;

/** Changeset-masking trigger: above this char count we start compacting. */
export const CHANGESET_MASK_THRESHOLD = 8_000;

/** Max diff-stat entries retained verbatim after masking. */
export const DIFF_STAT_TOP_N = 20;

/** Max staged-modification `uncommitted` entries retained verbatim. */
export const UNCOMMITTED_STAGED_TOP_N = 30;

/** History-brief cap for deep-research-codebase explorer injection. */
export const HISTORY_BRIEF_MAX_WORDS = 150;
