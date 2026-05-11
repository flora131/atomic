/**
 * Unit tests for persistence/restore.ts
 * cross-ref: spec §5.6, §5.13
 */

import { test, expect, describe } from "bun:test";
import { scanInFlightRuns, restoreOnSessionStart } from "../../src/persistence/restore.js";
import type { SessionEntry, InFlightRun } from "../../src/persistence/restore.js";
import { createStore } from "../../src/store.js";

// ---------------------------------------------------------------------------
// scanInFlightRuns
// ---------------------------------------------------------------------------

describe("scanInFlightRuns", () => {
  test("returns empty for empty entries", () => {
    expect(scanInFlightRuns([])).toHaveLength(0);
  });

  test("returns empty when all runs have ended", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.run.end", payload: { runId: "r1", status: "completed", ts: 2 } },
    ];
    expect(scanInFlightRuns(entries)).toHaveLength(0);
  });

  test("returns in-flight run when run.start has no run.end", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: {}, ts: 100 } },
    ];
    const result = scanInFlightRuns(entries);
    expect(result).toHaveLength(1);
    expect(result[0]!.runId).toBe("r1");
    expect(result[0]!.name).toBe("wf");
    expect(result[0]!.startTs).toBe(100);
  });

  test("handles multiple runs: only unended ones returned", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf1", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.run.end",   payload: { runId: "r1", status: "completed", ts: 2 } },
      { id: "e3", type: "workflow.run.start", payload: { runId: "r2", name: "wf2", inputs: {}, ts: 3 } },
    ];
    const result = scanInFlightRuns(entries);
    expect(result).toHaveLength(1);
    expect(result[0]!.runId).toBe("r2");
  });

  test("collects stageIds from stage.start entries for in-flight run", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start",   payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.stage.start",  payload: { runId: "r1", stageId: "s1", name: "fetch", parentIds: [], ts: 2 } },
      { id: "e3", type: "workflow.stage.start",  payload: { runId: "r1", stageId: "s2", name: "analyze", parentIds: ["s1"], ts: 3 } },
    ];
    const result = scanInFlightRuns(entries);
    expect(result[0]!.stageIds).toEqual(["s1", "s2"]);
  });

  test("does not duplicate stageIds from duplicate stage.start entries", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start",  payload: { runId: "r1", name: "wf", inputs: {}, ts: 1 } },
      { id: "e2", type: "workflow.stage.start", payload: { runId: "r1", stageId: "s1", name: "n", parentIds: [], ts: 2 } },
      { id: "e3", type: "workflow.stage.start", payload: { runId: "r1", stageId: "s1", name: "n", parentIds: [], ts: 2 } },
    ];
    const result = scanInFlightRuns(entries);
    expect(result[0]!.stageIds).toEqual(["s1"]);
  });

  test("preserves inputs from run.start payload", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: { runId: "r1", name: "wf", inputs: { key: "val" }, ts: 1 } },
    ];
    const result = scanInFlightRuns(entries);
    expect((result[0]!.inputs as Record<string, unknown>)["key"]).toBe("val");
  });

  test("handles missing/malformed run.start payload gracefully", () => {
    const entries: SessionEntry[] = [
      { id: "e1", type: "workflow.run.start", payload: {} }, // missing runId/name/ts
    ];
    // Should not throw, and should return empty (invalid entry skipped)
    const result = scanInFlightRuns(entries);
    expect(result).toHaveLength(0);
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
    expect(st.runs()).toHaveLength(0);
    expect(crashed).toHaveLength(0);
  });

  test("no-op when sessionManager.getEntries absent", () => {
    const st = createStore();
    restoreOnSessionStart(
      {}, // no getEntries
      { resumeInFlight: "never", persistRuns: true },
      st,
    );
    expect(st.runs()).toHaveLength(0);
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
    expect(crashed).toHaveLength(0);
    expect(st.runs()).toHaveLength(0);
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
    expect(crashed).toHaveLength(1);
    expect(crashed[0]!.runId).toBe("r1");
    const runs = st.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
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
    expect(crashed).toHaveLength(1);
    expect(st.runs()[0]!.status).toBe("failed");
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
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.runId).toBe("r1");
    // Store run should be "running" (auto resume)
    const runs = st.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("running");
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
    expect(run.endedAt).toBeDefined();
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
    expect(run.stages).toHaveLength(2);
    const s1 = run.stages.find((s) => s.id === "s1");
    const s2 = run.stages.find((s) => s.id === "s2");
    expect(s1!.status).toBe("completed");
    expect(s2!.status).toBe("failed");
    expect(s2!.error).toBeDefined();
  });
});
