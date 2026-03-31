/**
 * Context Pressure Monitoring
 *
 * Pure functions for monitoring context window usage during workflow
 * stage execution and determining when continuation sessions are needed.
 *
 * The conductor calls these functions after each stage's streaming completes
 * to capture usage snapshots, compute pressure levels, and decide whether
 * a continuation session should be created.
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
  ContinuationRecord,
} from "@/services/workflows/conductor/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default elevated threshold (40% — matches BACKGROUND_COMPACTION_THRESHOLD). */
export const DEFAULT_ELEVATED_THRESHOLD = 40;

/** Default critical threshold (60% — matches BUFFER_EXHAUSTION_THRESHOLD). */
export const DEFAULT_CRITICAL_THRESHOLD = 60;

/** Default maximum continuations per stage. */
export const DEFAULT_MAX_CONTINUATIONS_PER_STAGE = 3;

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
    maxContinuationsPerStage: overrides?.maxContinuationsPerStage ?? DEFAULT_MAX_CONTINUATIONS_PER_STAGE,
    enableContinuation: overrides?.enableContinuation ?? true,
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
// Continuation Decision
// ---------------------------------------------------------------------------

/**
 * Determine whether a continuation session should be created for a stage.
 *
 * A continuation is triggered when:
 * 1. The snapshot indicates critical pressure
 * 2. Continuation is enabled in the config
 * 3. The stage hasn't exceeded its maximum continuation count
 *
 * @param snapshot - The current context pressure snapshot.
 * @param config - The context pressure configuration.
 * @param currentContinuations - Number of continuations already created for this stage.
 * @returns `true` if a continuation session should be created.
 */
export function shouldContinueSession(
  snapshot: ContextPressureSnapshot,
  config: ContextPressureConfig,
  currentContinuations: number,
): boolean {
  if (!config.enableContinuation) {
    return false;
  }

  if (snapshot.level !== "critical") {
    return false;
  }

  if (currentContinuations >= config.maxContinuationsPerStage) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Continuation Prompt
// ---------------------------------------------------------------------------

/**
 * Build a continuation prompt for a new session that continues a stage's work.
 *
 * The prompt includes:
 * - The original stage prompt for context
 * - A summary of the partial response from the previous session
 * - An instruction to continue from where the previous session left off
 */
export function buildContinuationPrompt(
  originalPrompt: string,
  partialResponse: string,
  continuationIndex: number,
): string {
  const truncatedResponse = truncateForContinuation(partialResponse);

  return [
    "# Continuation Session",
    "",
    `This is continuation #${continuationIndex + 1} of a stage that exceeded its context window.`,
    "The previous session's work is summarized below. Continue from where it left off.",
    "",
    "## Original Prompt",
    "",
    originalPrompt,
    "",
    "## Previous Session Output (Summary)",
    "",
    truncatedResponse,
    "",
    "## Instructions",
    "",
    "Continue the task from where the previous session stopped.",
    "Do not repeat work that was already completed.",
    "Focus on the remaining items that have not been addressed.",
  ].join("\n");
}

/**
 * Truncate a partial response to a reasonable size for inclusion
 * in a continuation prompt. Preserves the end of the response
 * (most recent work) over the beginning.
 */
function truncateForContinuation(response: string, maxChars = 8000): string {
  if (response.length <= maxChars) {
    return response;
  }

  const suffix = response.slice(-maxChars);
  const firstNewline = suffix.indexOf("\n");
  const cleanSuffix = firstNewline >= 0 ? suffix.slice(firstNewline + 1) : suffix;

  return `[...truncated ${response.length - cleanSuffix.length} characters...]\n\n${cleanSuffix}`;
}

// ---------------------------------------------------------------------------
// Continuation Record Factory
// ---------------------------------------------------------------------------

/**
 * Create a `ContinuationRecord` capturing the state at a continuation point.
 */
export function createContinuationRecord(
  stageId: string,
  continuationIndex: number,
  triggerSnapshot: ContextPressureSnapshot,
  partialResponse: string,
): ContinuationRecord {
  return {
    stageId,
    continuationIndex,
    triggerSnapshot,
    partialResponse,
    timestamp: new Date().toISOString(),
  };
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
    totalContinuations: 0,
    stageSnapshots: new Map(),
    continuations: [],
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
    totalContinuations: current.totalContinuations,
    stageSnapshots: newSnapshots,
    continuations: current.continuations,
  };
}

/**
 * Record a continuation in the accumulated pressure state.
 *
 * Returns a new `AccumulatedContextPressure` with the continuation
 * appended and the total count incremented.
 */
export function accumulateContinuation(
  current: AccumulatedContextPressure,
  record: ContinuationRecord,
): AccumulatedContextPressure {
  return {
    totalInputTokens: current.totalInputTokens,
    totalOutputTokens: current.totalOutputTokens,
    totalContinuations: current.totalContinuations + 1,
    stageSnapshots: current.stageSnapshots,
    continuations: [...current.continuations, record],
  };
}
