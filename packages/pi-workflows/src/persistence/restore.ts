/**
 * Restore: scan session entries for in-flight runs on session_start.
 * Detects run.start entries without matching run.end and marks crashed or
 * attempts resume per the `resumeInFlight` config option.
 *
 * cross-ref: spec §5.6, §5.13
 */

import type { Store } from "../store.js";
import type { RunSnapshot, StageSnapshot } from "../store-types.js";

// ---------------------------------------------------------------------------
// Config option
// ---------------------------------------------------------------------------

/** Controls what the extension does with in-flight runs on session_start. */
export type ResumeInFlight = "ask" | "auto" | "never";

// ---------------------------------------------------------------------------
// Session entry types
// ---------------------------------------------------------------------------

/** Minimal shape of a pi session entry as returned by sessionManager.getEntries(). */
export interface SessionEntry {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** Structural type for pi's sessionManager (optional — degrades gracefully). */
export interface SessionManager {
  getEntries?: () => SessionEntry[] | readonly SessionEntry[];
}

// ---------------------------------------------------------------------------
// In-flight run descriptor (result of scan)
// ---------------------------------------------------------------------------

export interface InFlightRun {
  readonly runId: string;
  readonly name: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly startTs: number;
  /** Stage IDs that were started (in order) but may or may not have ended. */
  readonly stageIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Scan logic
// ---------------------------------------------------------------------------

/**
 * Scans a list of session entries and returns runs that have a
 * `workflow.run.start` entry but no matching `workflow.run.end`.
 *
 * Pure function — does not mutate anything.
 */
export function scanInFlightRuns(entries: readonly SessionEntry[]): InFlightRun[] {
  const started = new Map<string, { name: string; inputs: Record<string, unknown>; startTs: number; stageIds: string[] }>();
  const ended = new Set<string>();

  for (const entry of entries) {
    if (entry.type === "workflow.run.start") {
      const runId = entry.payload["runId"];
      const name = entry.payload["name"];
      const inputs = entry.payload["inputs"];
      const ts = entry.payload["ts"];
      if (
        typeof runId === "string" &&
        typeof name === "string" &&
        typeof ts === "number"
      ) {
        started.set(runId, {
          name,
          inputs: (inputs !== null && typeof inputs === "object" && !Array.isArray(inputs))
            ? (inputs as Record<string, unknown>)
            : {},
          startTs: ts,
          stageIds: [],
        });
      }
    }

    if (entry.type === "workflow.stage.start") {
      const runId = entry.payload["runId"];
      const stageId = entry.payload["stageId"];
      if (typeof runId === "string" && typeof stageId === "string") {
        const run = started.get(runId);
        if (run && !run.stageIds.includes(stageId)) {
          run.stageIds.push(stageId);
        }
      }
    }

    if (entry.type === "workflow.run.end") {
      const runId = entry.payload["runId"];
      if (typeof runId === "string") {
        ended.add(runId);
      }
    }
  }

  const result: InFlightRun[] = [];
  for (const [runId, info] of started) {
    if (!ended.has(runId)) {
      result.push({
        runId,
        name: info.name,
        inputs: Object.freeze({ ...info.inputs }),
        startTs: info.startTs,
        stageIds: Object.freeze([...info.stageIds]),
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Restore callbacks
// ---------------------------------------------------------------------------

export interface RestoreCallbacks {
  /**
   * Called when a run is detected as crashed (no end entry, session restarted).
   * Implementations typically mark the run "failed" in the store and optionally
   * notify the user.
   */
  onCrashed?: (run: InFlightRun) => void;
  /**
   * Called when a run is being resumed (resumeInFlight === "auto").
   * Implementations typically re-register the run in the store with status "running".
   */
  onResume?: (run: InFlightRun) => void;
}

// ---------------------------------------------------------------------------
// restoreOnSessionStart
// ---------------------------------------------------------------------------

/**
 * Entry point called on `session_start`.
 *
 * Behavior by `config.resumeInFlight`:
 *   "never" — mark all in-flight runs as crashed (failed) in the store.
 *   "auto"  — restore in-flight runs to "running" in the store and call onResume.
 *   "ask"   — same as "never" for store side-effects; onCrashed is called so
 *             the caller can prompt the user and invoke resume logic separately.
 *
 * When `config.persistRuns` is false the function returns early — no session
 * entries were written, so there is nothing to restore.
 */
export function restoreOnSessionStart(
  sessionManager: SessionManager,
  config: { resumeInFlight: ResumeInFlight; persistRuns: boolean },
  store: Store,
  callbacks: RestoreCallbacks = {},
): void {
  if (!config.persistRuns) return;

  const getEntries = sessionManager.getEntries;
  if (typeof getEntries !== "function") return;

  const entries = getEntries();
  const inFlight = scanInFlightRuns(entries as readonly SessionEntry[]);
  if (inFlight.length === 0) return;

  for (const run of inFlight) {
    if (config.resumeInFlight === "auto") {
      // Re-hydrate the run into the store as "running"
      const runSnapshot: RunSnapshot = {
        id: run.runId,
        name: run.name,
        inputs: run.inputs,
        status: "running",
        stages: _buildStageSnapshots(entries as readonly SessionEntry[], run.runId),
        startedAt: run.startTs,
      };
      store.recordRunStart(runSnapshot);
      callbacks.onResume?.(run);
    } else {
      // "ask" or "never": mark as crashed in store, surface to caller
      const runSnapshot: RunSnapshot = {
        id: run.runId,
        name: run.name,
        inputs: run.inputs,
        status: "failed",
        stages: _buildStageSnapshots(entries as readonly SessionEntry[], run.runId),
        startedAt: run.startTs,
        endedAt: Date.now(),
        error: "Run did not complete — process was interrupted.",
      };
      store.recordRunStart(runSnapshot);
      store.recordRunEnd(run.runId, "failed");
      callbacks.onCrashed?.(run);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Rebuild partial StageSnapshot array from session entries for a given run. */
function _buildStageSnapshots(
  entries: readonly SessionEntry[],
  runId: string,
): StageSnapshot[] {
  const stageMap = new Map<string, StageSnapshot>();
  const endedStages = new Set<string>();

  for (const entry of entries) {
    if (entry.payload["runId"] !== runId) continue;

    if (entry.type === "workflow.stage.start") {
      const stageId = entry.payload["stageId"];
      const name = entry.payload["name"];
      const parentIds = entry.payload["parentIds"];
      const ts = entry.payload["ts"];
      if (typeof stageId !== "string" || typeof name !== "string") continue;
      if (!stageMap.has(stageId)) {
        stageMap.set(stageId, {
          id: stageId,
          name,
          status: "running",
          parentIds: Array.isArray(parentIds) ? (parentIds as string[]) : [],
          startedAt: typeof ts === "number" ? ts : undefined,
          toolEvents: [],
        });
      }
    }

    if (entry.type === "workflow.stage.end") {
      const stageId = entry.payload["stageId"];
      const status = entry.payload["status"];
      const durationMs = entry.payload["durationMs"];
      const summary = entry.payload["summary"];
      if (typeof stageId !== "string") continue;
      endedStages.add(stageId);
      const snap = stageMap.get(stageId);
      if (snap) {
        snap.status = (status === "completed" || status === "failed") ? status : "failed";
        if (typeof durationMs === "number") snap.durationMs = durationMs;
        if (typeof summary === "string") snap.result = summary;
      }
    }
  }

  // Mark any stage that didn't get an end entry as "failed" (crashed)
  for (const [stageId, snap] of stageMap) {
    if (!endedStages.has(stageId)) {
      snap.status = "failed";
      snap.error = "Stage did not complete — process was interrupted.";
    }
  }

  return [...stageMap.values()];
}
