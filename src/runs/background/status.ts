/**
 * Status / kill / resume control helpers for in-flight workflow runs.
 *
 * These helpers operate against the singleton store and are consumed by:
 *   - The `workflow` tool execute handler (action: "status" | "kill" | "resume")
 *   - The /workflow slash command
 *
 * cross-ref: spec §5.5, §8.1 Phase D
 */

import type { Store } from "../../shared/store.js";
import type { RunSnapshot, RunStatus } from "../../shared/store-types.js";
import type { WorkflowPersistencePort } from "../../shared/types.js";
import type { CancellationRegistry } from "./cancellation-registry.js";
import { store as defaultStore } from "../../shared/store.js";
import { appendRunEnd } from "../../shared/persistence-session-entries.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunStatusEntry {
  readonly runId: string;
  readonly name: string;
  readonly status: RunStatus;
  readonly startedAt: number;
  readonly durationMs?: number;
  readonly stageCount: number;
}

export type KillResult =
  | { ok: true; runId: string; previousStatus: RunStatus }
  | { ok: false; runId: string; reason: "not_found" | "already_ended" };

export type ResumeResult =
  | { ok: true; runId: string; snapshot: RunSnapshot }
  | { ok: false; runId: string; reason: "not_found" };

/**
 * Per-run detail returned by {@link inspectRun}. A read-only view over the
 * store snapshot suitable for the "▎ RUN" detail surface — same data the
 * resume snapshot carries, plus a normalised `mode` field derived from
 * stage shape so renderers don't have to recompute it.
 */
export interface RunDetail {
  readonly runId: string;
  readonly name: string;
  readonly status: RunStatus;
  readonly mode: "single" | "chain";
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly stages: readonly RunSnapshot["stages"][number][];
  readonly result?: Record<string, unknown>;
  readonly error?: string;
}

export type InspectRunResult =
  | { ok: true; runId: string; detail: RunDetail }
  | { ok: false; runId: string; reason: "not_found" };

// ---------------------------------------------------------------------------
// statusRuns
// ---------------------------------------------------------------------------

/**
 * Returns a summary of all in-flight (not-yet-ended) runs in the store.
 * If `all` is true, returns completed/failed runs too.
 */
export function statusRuns(opts?: { all?: boolean; store?: Store }): RunStatusEntry[] {
  const activeStore = opts?.store ?? defaultStore;
  const runs = activeStore.runs();
  const result: RunStatusEntry[] = [];

  for (const run of runs) {
    if (!opts?.all && run.endedAt !== undefined) continue;
    result.push({
      runId: run.id,
      name: run.name,
      status: run.status,
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      stageCount: run.stages.length,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// killRun
// ---------------------------------------------------------------------------

/**
 * Marks a run as "killed" in the store and appends a `workflow.run.end` entry
 * with status "killed" when persistence is provided.
 *
 * Checks run existence and terminal state BEFORE aborting the executor so that
 * "not_found" / "already_ended" rejections are cheap and side-effect-free.
 *
 * If the run has already ended (completed/failed/killed), returns ok:false with
 * reason "already_ended". If the runId is unknown, returns ok:false "not_found".
 */
export function killRun(
  runId: string,
  opts?: { store?: Store; cancellation?: CancellationRegistry; persistence?: WorkflowPersistencePort },
): KillResult {
  const activeStore = opts?.store ?? defaultStore;

  // Read run state BEFORE aborting — reject early without side-effects
  const runs = activeStore.runs();
  const run = runs.find((r) => r.id === runId);

  if (!run) {
    return { ok: false, runId, reason: "not_found" };
  }
  if (run.endedAt !== undefined) {
    return { ok: false, runId, reason: "already_ended" };
  }

  const previousStatus = run.status;

  // Abort active executor (no-op if not registered)
  opts?.cancellation?.abort(runId, "workflow killed");

  const recorded = activeStore.recordRunEnd(runId, "killed", undefined, "workflow killed");
  if (recorded && opts?.persistence) {
    appendRunEnd(opts.persistence, { runId, status: "killed", ts: Date.now() });
  }

  return { ok: true, runId, previousStatus };
}

/**
 * Kills all in-flight runs. Returns array of KillResult for each run acted on.
 * Appends one `workflow.run.end` with status "killed" per successful kill when
 * persistence is provided.
 */
export function killAllRuns(opts?: {
  store?: Store;
  cancellation?: CancellationRegistry;
  persistence?: WorkflowPersistencePort;
}): KillResult[] {
  const activeStore = opts?.store ?? defaultStore;
  const inFlight = activeStore.runs().filter((r) => r.endedAt === undefined);
  return inFlight.map((r) =>
    killRun(r.id, { store: activeStore, cancellation: opts?.cancellation, persistence: opts?.persistence }),
  );
}

// ---------------------------------------------------------------------------
// resumeRun
// ---------------------------------------------------------------------------

/**
 * Looks up a run by ID and returns a deep-copy snapshot for display.
 * "Resume" means reopen/display the run's current state — not re-execute.
 *
 * Works for both in-flight (active) and ended runs. Callers use the snapshot
 * to drive UI display (e.g. re-summon the graph overlay) regardless of whether
 * the run is still running or has completed/failed/killed.
 *
 * Returns ok:false "not_found" only when the runId is unknown to the store.
 * Read-only: does not mutate store, cancellation, persistence, or job tracker.
 */
export function resumeRun(
  runId: string,
  opts?: { store?: Store },
): ResumeResult {
  const activeStore = opts?.store ?? defaultStore;
  const runs = activeStore.runs();
  const run = runs.find((r) => r.id === runId);

  if (!run) {
    return { ok: false, runId, reason: "not_found" };
  }

  // Return a deep copy of the snapshot for safe consumption
  const snapshot: RunSnapshot = JSON.parse(JSON.stringify(run)) as RunSnapshot;
  return { ok: true, runId, snapshot };
}

// ---------------------------------------------------------------------------
// inspectRun
// ---------------------------------------------------------------------------

/**
 * Look up a single run by id (full UUID or unique prefix) and return a
 * normalised {@link RunDetail} for the per-run text/TUI surfaces.
 *
 * Returns ok:false "not_found" when no run matches, "ambiguous" when a
 * prefix matches multiple. Read-only: does not mutate the store.
 */
export function inspectRun(
  runId: string,
  opts?: { store?: Store },
): InspectRunResult {
  const activeStore = opts?.store ?? defaultStore;
  const runs = activeStore.runs();

  const exact = runs.find((r) => r.id === runId);
  const candidate = exact ?? (runs.length > 0 ? runs.find((r) => r.id.startsWith(runId)) : undefined);

  if (!candidate) {
    return { ok: false, runId, reason: "not_found" };
  }

  // Deep copy so callers cannot mutate the store via the snapshot.
  const copy = JSON.parse(JSON.stringify(candidate)) as RunSnapshot;

  const detail: RunDetail = {
    runId: copy.id,
    name: copy.name,
    status: copy.status,
    mode: copy.stages.length > 1 ? "chain" : "single",
    startedAt: copy.startedAt,
    endedAt: copy.endedAt,
    durationMs: copy.durationMs,
    inputs: copy.inputs,
    stages: copy.stages,
    result: copy.result,
    error: copy.error,
  };

  return { ok: true, runId: copy.id, detail };
}
