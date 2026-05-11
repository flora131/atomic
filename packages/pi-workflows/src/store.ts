/**
 * Plain mutable singleton store with subscribe/version counter.
 * cross-ref: spec §5.5
 */

import type {
  RunSnapshot,
  StageSnapshot,
  StoreSnapshot,
  ToolEvent,
  RunStatus,
  WorkflowNotice,
} from "./store-types.js";

/** Statuses that represent a terminal run state — cannot be overwritten. */
const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "failed", "killed"]);

export interface Store {
  runs(): readonly RunSnapshot[];
  notices(): readonly WorkflowNotice[];
  activeRunId(): string | null;
  recordRunStart(run: RunSnapshot): void;
  recordStageStart(runId: string, stage: StageSnapshot): void;
  recordToolStart(runId: string, stageId: string, evt: ToolEvent): void;
  recordToolEnd(runId: string, stageId: string, evt: ToolEvent): void;
  recordStageEnd(runId: string, stage: StageSnapshot): void;
  /**
   * Records the end of a run.
   * Returns `true` if state changed, `false` if the run was not found or
   * already in a terminal state (completed | failed | killed).
   * `result` is only applied for status "completed".
   * `error` is only applied for status "failed" | "killed".
   */
  recordRunEnd(
    runId: string,
    status: RunStatus,
    result?: Record<string, unknown>,
    error?: string,
  ): boolean;
  recordNotice(notice: WorkflowNotice): void;
  /**
   * Acknowledges a notice by id.
   * Returns `true` if notice was found and not yet acked, `false` otherwise.
   */
  ackNotice(id: string): boolean;
  snapshot(): StoreSnapshot;
  subscribe(fn: (snap: StoreSnapshot) => void): () => void;
}

export function createStore(): Store {
  const _runs: RunSnapshot[] = [];
  const _notices: WorkflowNotice[] = [];
  const _listeners: Set<(snap: StoreSnapshot) => void> = new Set();
  let _version = 0;

  function notify(): void {
    const snap = snapshot();
    for (const fn of _listeners) {
      fn(snap);
    }
  }

  function snapshot(): StoreSnapshot {
    return JSON.parse(
      JSON.stringify({ runs: _runs, notices: _notices, version: _version }),
    ) as StoreSnapshot;
  }

  function findRun(runId: string): RunSnapshot | undefined {
    return _runs.find((r) => r.id === runId);
  }

  function findStage(run: RunSnapshot, stageId: string): StageSnapshot | undefined {
    return run.stages.find((s) => s.id === stageId);
  }

  return {
    runs(): readonly RunSnapshot[] {
      return _runs;
    },

    notices(): readonly WorkflowNotice[] {
      return _notices;
    },

    activeRunId(): string | null {
      // Most recently started run that hasn't ended
      for (let i = _runs.length - 1; i >= 0; i--) {
        const run = _runs[i];
        if (run && run.endedAt === undefined) {
          return run.id;
        }
      }
      return null;
    },

    recordRunStart(run: RunSnapshot): void {
      _runs.push(run);
      _version++;
      notify();
    },

    recordStageStart(runId: string, stage: StageSnapshot): void {
      const run = findRun(runId);
      if (!run) return;
      // Only push if not already in run.stages
      if (!run.stages.some((s) => s.id === stage.id)) {
        run.stages.push(stage);
      }
      _version++;
      notify();
    },

    recordToolStart(runId: string, stageId: string, evt: ToolEvent): void {
      const run = findRun(runId);
      if (!run) return;
      const stage = findStage(run, stageId);
      if (!stage) return;
      // Don't duplicate if same tool event already present (match by name + startedAt)
      const exists = stage.toolEvents.some(
        (e) => e.name === evt.name && e.startedAt === evt.startedAt,
      );
      if (!exists) {
        stage.toolEvents.push(evt);
      }
      _version++;
      notify();
    },

    recordToolEnd(runId: string, stageId: string, evt: ToolEvent): void {
      const run = findRun(runId);
      if (!run) return;
      const stage = findStage(run, stageId);
      if (!stage) return;
      // Find and update matching ToolEvent by name + startedAt
      const existing = stage.toolEvents.find(
        (e) => e.name === evt.name && e.startedAt === evt.startedAt,
      );
      if (existing) {
        existing.endedAt = evt.endedAt;
        existing.output = evt.output;
      }
      _version++;
      notify();
    },

    recordStageEnd(runId: string, stage: StageSnapshot): void {
      const run = findRun(runId);
      if (!run) return;
      const existing = findStage(run, stage.id);
      if (!existing) return;
      existing.status = stage.status;
      existing.endedAt = stage.endedAt;
      existing.durationMs = stage.durationMs;
      existing.result = stage.result;
      existing.error = stage.error;
      _version++;
      notify();
    },

    recordRunEnd(
      runId: string,
      status: RunStatus,
      result?: Record<string, unknown>,
      error?: string,
    ): boolean {
      const run = findRun(runId);
      if (!run) return false;
      // Terminal guard — once in a terminal state, refuse overwrite.
      if (TERMINAL_STATUSES.has(run.status)) return false;
      run.status = status;
      run.endedAt = Date.now();
      run.durationMs = run.endedAt - run.startedAt;
      if (status === "completed" && result !== undefined) {
        run.result = result;
      }
      if ((status === "failed" || status === "killed") && error !== undefined) {
        run.error = error;
      }
      _version++;
      notify();
      return true;
    },

    recordNotice(notice: WorkflowNotice): void {
      _notices.push(notice);
      _version++;
      notify();
    },

    ackNotice(id: string): boolean {
      const notice = _notices.find((n) => n.id === id);
      if (!notice || notice.ackedAt !== undefined) return false;
      notice.ackedAt = Date.now();
      _version++;
      notify();
      return true;
    },

    snapshot,

    subscribe(fn: (snap: StoreSnapshot) => void): () => void {
      _listeners.add(fn);
      return () => {
        _listeners.delete(fn);
      };
    },
  };
}

export const store: Store = createStore();
