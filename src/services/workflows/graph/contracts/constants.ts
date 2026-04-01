import type { RetryConfig } from "@/services/workflows/graph/contracts/core.ts";
import type { GraphConfig } from "@/services/workflows/graph/contracts/runtime.ts";

export const BACKGROUND_COMPACTION_THRESHOLD = 0.4;
export const COMPACTION_MAX_TOKENS = 100_000;
export const BUFFER_EXHAUSTION_THRESHOLD = 0.6;

/**
 * Compute the compaction threshold as a fraction of the context window.
 *
 * Formula: min(0.4, 100 000 / maxTokens).
 * This caps the absolute token budget at 100K tokens regardless of window size.
 */
export function computeCompactionThreshold(maxTokens: number): number {
  if (maxTokens <= 0) return BACKGROUND_COMPACTION_THRESHOLD;
  return Math.min(
    BACKGROUND_COMPACTION_THRESHOLD,
    COMPACTION_MAX_TOKENS / maxTokens,
  );
}

/**
 * Compute the compaction threshold as a percentage (0–100) of the context window.
 *
 * Formula: min(0.4 × maxTokens, 100 000) expressed as a percentage of maxTokens.
 */
export function computeCompactionThresholdPercent(maxTokens: number): number {
  return computeCompactionThreshold(maxTokens) * 100;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

export const DEFAULT_GRAPH_CONFIG: Partial<GraphConfig> = {
  maxConcurrency: 1,
  autoCheckpoint: true,
};
