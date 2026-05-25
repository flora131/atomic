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
import type { RunSnapshot, RunStatus, StageSnapshot } from "../../shared/store-types.js";
import type { WorkflowPersistencePort } from "../../shared/types.js";
import type { CancellationRegistry } from "./cancellation-registry.js";
import type { StageControlRegistry } from "../foreground/stage-control-registry.js";
import { store as defaultStore } from "../../shared/store.js";
import { stageControlRegistry as defaultStageControlRegistry } from "../foreground/stage-control-registry.js";
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

export type DestroyRunResult =
  | { ok: true; runId: string; previousStatus: RunStatus; wasInFlight: boolean }
  | { ok: false; runId: string; reason: "not_found" };

export type ResumeResult =
  | {
      ok: true;
      runId: string;
      snapshot: RunSnapshot;
      resumed: readonly StageSnapshot[];
      mode?: "snapshot" | "paused" | "not_resumable";
      message?: string;
    }
  | { ok: false; runId: string; reason: "not_found" };

export type PauseResult =
  | {
      ok: true;
      runId: string;
      paused: readonly StageSnapshot[];
    }
  | {
      ok: false;
      runId: string;
      reason: "not_found" | "already_ended" | "no_active_stages" | "stage_not_found";
    };

export type InterruptRunResult = PauseResult;

/**
 * Per-run detail returned by {@link inspectRun}. A read-only view over the
 * store snapshot suitable for the "  RUN" detail surface — same data the
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
  readonly pausedDurationMs?: number;
  readonly pausedAt?: number;
  readonly resumedAt?: number;
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
// destroyRun
// ---------------------------------------------------------------------------

/**
 * Destructively kills a workflow run and removes it from live history/status.
 *
 * In-flight runs are aborted and persisted with a terminal `killed` entry so
 * session restore will not resurrect them. Ended runs are simply removed from
 * the live store without appending a duplicate terminal event.
 */
export function destroyRun(
  runId: string,
  opts?: { store?: Store; cancellation?: CancellationRegistry; persistence?: WorkflowPersistencePort },
): DestroyRunResult {
  const activeStore = opts?.store ?? defaultStore;
  const run = activeStore.runs().find((r) => r.id === runId);

  if (!run) {
    return { ok: false, runId, reason: "not_found" };
  }

  const previousStatus = run.status;
  const wasInFlight = run.endedAt === undefined;

  if (wasInFlight) {
    opts?.cancellation?.abort(runId, "workflow killed");
    if (opts?.persistence) {
      appendRunEnd(opts.persistence, { runId, status: "killed", ts: Date.now() });
    }
  }

  activeStore.removeRun(runId);
  return { ok: true, runId, previousStatus, wasInFlight };
}

/**
 * Destructively kills and removes all in-flight runs.
 */
export function destroyAllRuns(opts?: {
  store?: Store;
  cancellation?: CancellationRegistry;
  persistence?: WorkflowPersistencePort;
}): DestroyRunResult[] {
  const activeStore = opts?.store ?? defaultStore;
  const inFlight = activeStore.runs().filter((r) => r.endedAt === undefined);
  return inFlight.map((r) =>
    destroyRun(r.id, { store: activeStore, cancellation: opts?.cancellation, persistence: opts?.persistence }),
  );
}

// ---------------------------------------------------------------------------
// resumeRun
// ---------------------------------------------------------------------------

/**
 * Reopen a run for display, and resume any paused live work along the way.
 *
 * Behaviour matrix:
 *   - non-paused run (running / ended / completed / failed / killed):
 *     returns a deep-copy snapshot, `resumed` is empty. Used by the
 *     existing slash-command path to re-summon the graph overlay.
 *   - paused run with a live `WorkflowRunControlHandle` in the
 *     stage-control registry: clears the paused state, resumes every
 *     currently-paused stage (or only `stageId` when supplied), and
 *     returns the resumed stage snapshots alongside the deep-copy.
 *
 * Returns ok:false "not_found" when the runId is unknown to the store.
 * Read-only against cancellation/persistence/job tracker; mutates the
 * store only when paused stages were actually resumed.
 */
export function resumeRun(
  runId: string,
  opts?: {
    store?: Store;
    stageControlRegistry?: StageControlRegistry;
    /** When supplied, resume only this stage within the run. */
    stageId?: string;
    /** Optional resume message forwarded to each resumed stage. */
    message?: string;
  },
): ResumeResult {
  const activeStore = opts?.store ?? defaultStore;
  const registry = opts?.stageControlRegistry ?? defaultStageControlRegistry;
  const runs = activeStore.runs();
  const run = runs.find((r) => r.id === runId);

  if (!run) {
    return { ok: false, runId, reason: "not_found" };
  }

  const resumed: StageSnapshot[] = [];
  if (run.status === "paused" || run.stages.some((s) => s.status === "paused")) {
    const runHandle = registry.run(runId);
    const handles = opts?.stageId
      ? [registry.get(runId, opts.stageId)].filter(
          (h): h is NonNullable<typeof h> => h !== undefined,
        )
      : runHandle.pausedStages();
    // Fire-and-forget the resume promise — the executor will mark each
    // stage running once `__resume()` settles. The snapshot returned
    // below reflects the *current* paused state; subscribers see the
    // transition through the usual store notify path.
    for (const handle of handles) {
      if (handle.status !== "paused") continue;
      void handle.resume(opts?.message);
      const stageSnap = run.stages.find((s) => s.id === handle.stageId);
      if (stageSnap) resumed.push(stageSnap);
    }
    if (run.status === "paused" && (!opts?.stageId || resumed.length > 0)) {
      activeStore.recordRunResumed(runId);
    }
  }

  // Return a deep copy of the snapshot for safe consumption
  const snapshot: RunSnapshot = JSON.parse(JSON.stringify(run)) as RunSnapshot;
  const resumedCopy: StageSnapshot[] = JSON.parse(JSON.stringify(resumed)) as StageSnapshot[];
  if (run.status === "failed" && run.endedAt !== undefined && run.resumable === false) {
    return {
      ok: true,
      runId,
      snapshot,
      resumed: resumedCopy,
      mode: "not_resumable",
      message: "This failed workflow is not resumable; inspect the snapshot and rerun the workflow when ready.",
    };
  }
  return {
    ok: true,
    runId,
    snapshot,
    resumed: resumedCopy,
    mode: resumedCopy.length > 0 ? "paused" : "snapshot",
  };
}

// ---------------------------------------------------------------------------
// pauseRun
// ---------------------------------------------------------------------------

/**
 * Pause a run or a specific stage within a run.
 *
 *  - With no `stageId`: every currently-running stage with a live handle
 *    in the stage-control registry is paused. If at least one stage is
 *    paused, the run is marked `paused` in the store.
 *  - With `stageId`: only that stage is paused. The run is marked paused
 *    only when *every* still-active stage in the run is paused after the
 *    operation.
 *
 * Refuses runs that are already terminal (completed / failed / killed)
 * with `reason: "already_ended"`. Refuses runs with no pausable stage
 * handles in the registry with `reason: "no_active_stages"`. Refuses a
 * stage-scoped pause when no matching handle exists with
 * `reason: "stage_not_found"`.
 */
export function pauseRun(
  runId: string,
  opts?: {
    store?: Store;
    stageControlRegistry?: StageControlRegistry;
    /** Pause only this stage. */
    stageId?: string;
  },
): PauseResult {
  const activeStore = opts?.store ?? defaultStore;
  const registry = opts?.stageControlRegistry ?? defaultStageControlRegistry;
  const runs = activeStore.runs();
  const run = runs.find((r) => r.id === runId);

  if (!run) {
    return { ok: false, runId, reason: "not_found" };
  }
  if (run.endedAt !== undefined) {
    return { ok: false, runId, reason: "already_ended" };
  }

  if (opts?.stageId !== undefined) {
    const handle = registry.get(runId, opts.stageId);
    if (!handle) {
      return { ok: false, runId, reason: "stage_not_found" };
    }
    if (handle.status !== "running" && handle.status !== "pending") {
      return { ok: false, runId, reason: "no_active_stages" };
    }
    void handle.pause();
    const stageSnap = run.stages.find((s) => s.id === opts.stageId);
    const paused: StageSnapshot[] = stageSnap ? [JSON.parse(JSON.stringify(stageSnap)) as StageSnapshot] : [];
    // Only mark the whole run paused when every active stage is paused.
    const stillActive = run.stages.some(
      (s) => s.status === "running" && s.id !== opts.stageId,
    );
    if (!stillActive) activeStore.recordRunPaused(runId);
    return { ok: true, runId, paused };
  }

  const handles = registry.run(runId).stages().filter(
    (h) => h.status === "running" || h.status === "pending",
  );
  if (handles.length === 0) {
    return { ok: false, runId, reason: "no_active_stages" };
  }
  const pausedSnaps: StageSnapshot[] = [];
  for (const handle of handles) {
    void handle.pause();
    const stageSnap = run.stages.find((s) => s.id === handle.stageId);
    if (stageSnap) pausedSnaps.push(JSON.parse(JSON.stringify(stageSnap)) as StageSnapshot);
  }
  activeStore.recordRunPaused(runId);
  return { ok: true, runId, paused: pausedSnaps };
}

// ---------------------------------------------------------------------------
// interruptRun
// ---------------------------------------------------------------------------

/**
 * Interrupt a run in a resumable way by pausing live stage handles when
 * available. Unlike `destroyRun`, this never aborts the workflow controller and
 * never removes the run from status/history.
 */
export function interruptRun(
  runId: string,
  opts?: {
    store?: Store;
    stageControlRegistry?: StageControlRegistry;
    stageId?: string;
  },
): InterruptRunResult {
  return pauseRun(runId, opts);
}

/** Interrupt all in-flight runs without removing them from history/status. */
export function interruptAllRuns(opts?: {
  store?: Store;
  stageControlRegistry?: StageControlRegistry;
}): InterruptRunResult[] {
  const activeStore = opts?.store ?? defaultStore;
  const inFlight = activeStore.runs().filter((r) => r.endedAt === undefined);
  return inFlight.map((r) =>
    interruptRun(r.id, { store: activeStore, stageControlRegistry: opts?.stageControlRegistry }),
  );
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
    pausedDurationMs: copy.pausedDurationMs,
    pausedAt: copy.pausedAt,
    resumedAt: copy.resumedAt,
    inputs: copy.inputs,
    stages: copy.stages,
    result: copy.result,
    error: copy.error,
  };

  return { ok: true, runId: copy.id, detail };
}
