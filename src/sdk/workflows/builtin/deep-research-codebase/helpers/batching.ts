/**
 * Batching primitives for the deep-research-codebase workflow.
 *
 * The workflow caps SDK-level fan-out by grouping specialist invocations into
 * "batch sessions" — one `ctx.stage()` per batch. Inside each batch session,
 * the default Claude Code agent dispatches up to MAX_TASKS_PER_BATCH
 * sub-agents in parallel via the Task tool. This keeps the parallel SDK
 * subprocess count proportional to (specialists / 10) rather than to
 * specialists itself, which scales linearly with codebase size.
 *
 * The per-message Task fan-out cap is empirical: there's no documented hard
 * limit, but ~10 parallel sub-agents per single message is the reliable
 * ceiling before rate limits, context contention, and degraded coordination
 * kick in. Lower this if you see batch sessions stalling or returning
 * partial completions; raise it only after measuring.
 */

import type { PartitionUnit } from "./scout.ts";

/** Maximum Task-tool sub-agent dispatches per single batch session. */
export const MAX_TASKS_PER_BATCH = 10;

/** Specialist kinds that share Layer 1 (no inter-task dependencies). */
export type Layer1Kind = "locator" | "pattern-finder";

/** Specialist kinds that share Layer 2 (depend on Layer 1 locator output). */
export type Layer2Kind = "analyzer" | "online-researcher";

/** Maps a specialist kind to the Claude agent name it dispatches as. */
export const SUBAGENT_TYPE: Record<Layer1Kind | Layer2Kind, string> = {
  locator: "codebase-locator",
  "pattern-finder": "codebase-pattern-finder",
  analyzer: "codebase-analyzer",
  "online-researcher": "codebase-online-researcher",
};

export type Layer1Task = {
  kind: Layer1Kind;
  partitionIndex: number;
  partition: PartitionUnit[];
  /** Absolute path the sub-agent must write its verbatim findings to. */
  outputPath: string;
};

export type Layer2Task = {
  kind: Layer2Kind;
  partitionIndex: number;
  partition: PartitionUnit[];
  outputPath: string;
  /** Verbatim locator text for this partition, embedded into the prompt. */
  locatorOutput: string;
};

/** Split a flat task list into fixed-size chunks (last chunk may be smaller). */
export function chunkBatches<T>(
  items: T[],
  size: number = MAX_TASKS_PER_BATCH,
): T[][] {
  if (size <= 0) throw new Error("chunkBatches: size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
