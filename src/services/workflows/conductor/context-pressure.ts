/**
 * Context Pressure Monitoring
 *
 * Pure functions for monitoring context window usage during workflow
 * stage execution.
 *
 * The conductor calls these functions after each stage's streaming completes
 * to capture usage snapshots and compute pressure levels.
 *
 * All functions are stateless — the conductor manages the mutable accumulator.
 *
 * @see src/services/workflows/conductor/types.ts for type definitions.
 */

import type { ContextUsage, Session } from "@/services/agents/types.ts";
import { computeCompactionThresholdPercent } from "@/services/workflows/graph/types.ts";
import type {
  AccumulatedContextPressure,
  ContextPressureConfig,
  ContextPressureLevel,
  ContextPressureSnapshot,
} from "@/services/workflows/conductor/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default elevated threshold (40% — matches BACKGROUND_COMPACTION_THRESHOLD). */
export const DEFAULT_ELEVATED_THRESHOLD = 40;

/** Default critical threshold (60% — matches BUFFER_EXHAUSTION_THRESHOLD). */
export const DEFAULT_CRITICAL_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// Factory — Default Config
// ---------------------------------------------------------------------------

/**
 * Create a `ContextPressureConfig` with sensible defaults.
 *
 * Thresholds align with the existing graph-level constants:
 * - `BACKGROUND_COMPACTION_THRESHOLD` (0.4 → 40%) for elevated,
 *   capped at runtime by min(0.4T, 100K) via `computeCompactionThresholdPercent`
 * - `BUFFER_EXHAUSTION_THRESHOLD` (0.6 → 60%) for critical
 */
export function createDefaultContextPressureConfig(
  overrides?: Partial<ContextPressureConfig>,
): ContextPressureConfig {
  return {
    elevatedThreshold: overrides?.elevatedThreshold ?? DEFAULT_ELEVATED_THRESHOLD,
    criticalThreshold: overrides?.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Snapshot Capture
// ---------------------------------------------------------------------------

/**
 * Compute the pressure level from a usage percentage and config thresholds.
 *
 * When `maxTokens` is provided, the elevated threshold is capped by
 * `min(0.4T, 100K)` to limit the absolute token budget on large windows.
 */
export function computePressureLevel(
  usagePercentage: number,
  config: ContextPressureConfig,
  maxTokens?: number,
): ContextPressureLevel {
  if (usagePercentage >= config.criticalThreshold) {
    return "critical";
  }
  const effectiveElevated = maxTokens && maxTokens > 0
    ? Math.min(config.elevatedThreshold, computeCompactionThresholdPercent(maxTokens))
    : config.elevatedThreshold;
  if (usagePercentage >= effectiveElevated) {
    return "elevated";
  }
  return "normal";
}

/**
 * Capture a context pressure snapshot from a `ContextUsage` reading.
 *
 * Converts the raw usage data from `session.getContextUsage()` into
 * a `ContextPressureSnapshot` with a computed pressure level.
 */
export function createSnapshot(
  usage: ContextUsage,
  config: ContextPressureConfig,
): ContextPressureSnapshot {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    maxTokens: usage.maxTokens,
    usagePercentage: usage.usagePercentage,
    level: computePressureLevel(usage.usagePercentage, config, usage.maxTokens),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Safely capture a context pressure snapshot from a session.
 *
 * Calls `session.getContextUsage()` and converts the result.
 * Returns `null` if the call fails (e.g., no query has completed yet).
 */
export async function takeContextSnapshot(
  session: Session,
  config: ContextPressureConfig,
): Promise<ContextPressureSnapshot | null> {
  try {
    const usage = await session.getContextUsage();
    return createSnapshot(usage, config);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Accumulated Pressure
// ---------------------------------------------------------------------------

/**
 * Create an empty `AccumulatedContextPressure` for the start of a workflow.
 */
export function createEmptyAccumulatedPressure(): AccumulatedContextPressure {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    stageSnapshots: new Map(),
  };
}

/**
 * Accumulate a stage's context snapshot into the running total.
 *
 * Returns a new `AccumulatedContextPressure` with the stage's tokens
 * added and the snapshot stored under the stage ID.
 */
export function accumulateStageSnapshot(
  current: AccumulatedContextPressure,
  stageId: string,
  snapshot: ContextPressureSnapshot,
): AccumulatedContextPressure {
  const newSnapshots = new Map(current.stageSnapshots);
  newSnapshots.set(stageId, snapshot);
  return {
    totalInputTokens: current.totalInputTokens + snapshot.inputTokens,
    totalOutputTokens: current.totalOutputTokens + snapshot.outputTokens,
    stageSnapshots: newSnapshots,
  };
}
