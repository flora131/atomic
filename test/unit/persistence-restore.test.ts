/**
 * Unit tests for shared/persistence-restore.ts
 * cross-ref: spec §5.6, §5.13
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { scanInFlightRuns, restoreOnSessionStart } from "../../src/shared/persistence-restore.js";
import type { SessionEntry, InFlightRun } from "../../src/shared/persistence-restore.js";
import { createStore } from "../../src/shared/store.js";

// ---------------------------------------------------------------------------
// scanInFlightRuns
// ---------------------------------------------------------------------------

describe("scanInFlightRuns", () => {
  test("returns empty for empty entries", () => {
    assert.equal(scanInFlightRuns([]).length, 0);
  });

  test("returns empty when all runs have ended", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.run.end", payload: { runId: "r1", status: "completed", ts: 2 } },
    ];
    assert.equal(scanInFlightRuns(entries).length, 0);
  });

  test("returns in-flight run when run.start has no run.end", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 100 } },
    ];
    const result = scanInFlightRuns(entries);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.runId, "r1");
    assert.equal(result[0]!.name, "wf");
    assert.equal(result[0]!.startTs, 100);
  });

  test("handles multiple runs: only unended ones returned", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf1", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.run.end",   payload: { runId: "r1", status: "completed", ts: 2 } },
      { id: "e3", type: "workflow.run.start", payload: { runId: "r2", name: "wf2", inputs: {}, ts: 3 } },
    ];
    const result = scanInFlightRuns(entries);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.runId, "r2");
  });

  test("collects stageIds from stage.start entries for in-flight run", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start",   payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.stage.start",  payload: { runId: "r1", stageId: "s1", name: "fetch", parentIds: [], ts: 2 } },
      { id: "e3", type: "workflow.stage.start",  payload: { runId: "r1", stageId: "s2", name: "analyze", parentIds: ["s1"], ts: 3 } },
    ];
    const result = scanInFlightRuns(entries);
    assert.deepEqual(result[0]!.stageIds, ["s1", "s2"]);
  });

  test("does not duplicate stageIds from duplicate stage.start entries", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start",  payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.stage.start", payload: { runId: "r1", stageId: "s1", name: "n", parentIds: [], ts: 2 } },
      { id: "e3", type: "workflow.stage.start", payload: { runId: "r1", stageId: "s1", name: "n", parentIds: [], ts: 2 } },
    ];
    const result = scanInFlightRuns(entries);
    assert.deepEqual(result[0]!.stageIds, ["s1"]);
  });

  test("preserves inputs from run.start payload", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: { key: "val" }, ts: 1 } },
    ];
    const result = scanInFlightRuns(entries);
    assert.equal((result[0]!.inputs as Record<string, unknown>)["key"], "val");
  });

  test("handles missing/malformed run.start payload gracefully", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: {} }, // missing runId/name/ts
    ];
    // Should not throw, and should return empty (invalid entry skipped)
    const result = scanInFlightRuns(entries);
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// restoreOnSessionStart
// ---------------------------------------------------------------------------

describe("restoreOnSessionStart", () => {
  function makeSessionManager(entries: SessionEntry[]) {
    return { getEntries: () => entries };
  }

  test("no-op when persistRuns=false", () => {
    const st = createStore();
    const crashed: InFlightRun[] = [];
    restoreOnSessionStart(
      makeSessionManager([
        { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      ]),
      { resumeInFlight: "never", persistRuns: false },
      st,
      { onCrashed: (r) => crashed.push(r) },
    );
    assert.equal(st.runs().length, 0);
    assert.equal(crashed.length, 0);
  });

  test("no-op when sessionManager.getEntries absent", () => {
    const st = createStore();
    restoreOnSessionStart(
      {}, // no getEntries
      { resumeInFlight: "never", persistRuns: true },
      st,
    );
    assert.equal(st.runs().length, 0);
  });

  test("no-op when no in-flight runs found", () => {
    const st = createStore();
    const crashed: InFlightRun[] = [];
    restoreOnSessionStart(
      makeSessionManager([
        { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
        { id: "e2", type: "workflow.run.end",   payload: { runId: "r1", status: "completed", ts: 2 } },
      ]),
      { resumeInFlight: "never", persistRuns: true },
      st,
      { onCrashed: (r) => crashed.push(r) },
    );
    assert.equal(crashed.length, 0);
    assert.equal(st.runs().length, 0);
  });

  test("resumeInFlight=never: marks run as failed and calls onCrashed", () => {
    const st = createStore();
    const crashed: InFlightRun[] = [];
    restoreOnSessionStart(
      makeSessionManager([
        { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "my-wf", inputs: {}, ts: 1 } },
      ]),
      { resumeInFlight: "never", persistRuns: true },
      st,
      { onCrashed: (r) => crashed.push(r) },
    );
    assert.equal(crashed.length, 1);
    assert.equal(crashed[0]!.runId, "r1");
    const runs = st.runs();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.status, "failed");
  });

  test("resumeInFlight=ask: same behavior as never for store/callback", () => {
    const st = createStore();
    const crashed: InFlightRun[] = [];
    restoreOnSessionStart(
      makeSessionManager([
        { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      ]),
      { resumeInFlight: "ask", persistRuns: true },
      st,
      { onCrashed: (r) => crashed.push(r) },
    );
    assert.equal(crashed.length, 1);
    assert.equal(st.runs()[0]!.status, "failed");
  });

  test("resumeInFlight=auto: marks run as running and calls onResume", () => {
    const st = createStore();
    const resumed: InFlightRun[] = [];
    restoreOnSessionStart(
      makeSessionManager([
        { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      ]),
      { resumeInFlight: "auto", persistRuns: true },
      st,
      { onResume: (r) => resumed.push(r) },
    );
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0]!.runId, "r1");
    // Store run should be "running" (auto resume)
    const runs = st.runs();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.status, "running");
  });

  test("crashed run has endedAt set (marked ended)", () => {
    const st = createStore();
    restoreOnSessionStart(
      makeSessionManager([
        { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      ]),
      { resumeInFlight: "never", persistRuns: true },
      st,
    );
    const run = st.runs()[0]!;
    assert.notEqual(run.endedAt, undefined);
  });

  test("stage snapshots are rebuilt from session entries", () => {
    const st = createStore();
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start",   payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.stage.start",  payload: { runId: "r1", stageId: "s1", name: "fetch", parentIds: [], ts: 2 } },
      { id: "e3", type: "workflow.stage.end",    payload: { runId: "r1", stageId: "s1", status: "completed", durationMs: 100 } },
      { id: "e4", type: "workflow.stage.start",  payload: { runId: "r1", stageId: "s2", name: "analyze", parentIds: ["s1"], ts: 3 } },
      // s2 never got a stage.end entry — crashed
    ];
    restoreOnSessionStart(makeSessionManager(entries), { resumeInFlight: "never", persistRuns: true }, st);
    const run = st.runs()[0]!;
    assert.equal(run.stages.length, 2);
    const s1 = run.stages.find((s) => s.id === "s1");
    const s2 = run.stages.find((s) => s.id === "s2");
    assert.equal(s1!.status, "completed");
    assert.equal(s2!.status, "failed");
    assert.notEqual(s2!.error, undefined);
  });
});
