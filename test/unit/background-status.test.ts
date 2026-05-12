/**
 * Unit tests for runs/background/status.ts (status, kill, resume helpers)
 * cross-ref: spec §8.1 Phase D
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { statusRuns, killRun, killAllRuns, resumeRun } from "../../src/runs/background/status.js";
import { createStore } from "../../src/shared/store.js";
import type { RunSnapshot } from "../../src/shared/store-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: "r1",
    name: "my-wf",
    inputs: {},
    status: "running",
    stages: [],
    startedAt: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// statusRuns
// ---------------------------------------------------------------------------

describe("statusRuns", () => {
  test("returns empty when store has no runs", () => {
    const st = createStore();
    assert.equal(statusRuns({ store: st }).length, 0);
  });

  test("returns in-flight runs by default", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1" }));
    const result = statusRuns({ store: st });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.runId, "r1");
  });

  test("excludes ended runs by default", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1" }));
    st.recordRunEnd("r1", "completed");
    assert.equal(statusRuns({ store: st }).length, 0);
  });

  test("includes ended runs when all=true", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1" }));
    st.recordRunEnd("r1", "completed");
    const result = statusRuns({ all: true, store: st });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.runId, "r1");
  });

  test("entry has correct shape", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1", name: "test-wf", stages: [] }));
    const entry = statusRuns({ store: st })[0]!;
    assert.equal(entry.runId, "r1");
    assert.equal(entry.name, "test-wf");
    assert.equal(typeof entry.startedAt, "number");
    assert.equal(typeof entry.stageCount, "number");
  });
});

// ---------------------------------------------------------------------------
// killRun
// ---------------------------------------------------------------------------

describe("killRun", () => {
  test("returns ok:false reason:not_found for unknown runId", () => {
    const st = createStore();
    const result = killRun("nonexistent", { store: st });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_found");
  });

  test("returns ok:false reason:already_ended when run has ended", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1" }));
    st.recordRunEnd("r1", "completed");
    const result = killRun("r1", { store: st });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "already_ended");
  });

  test("returns ok:true and marks run as killed", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1" }));
    const result = killRun("r1", { store: st });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.runId, "r1");
      assert.equal(result.previousStatus, "running");
    }
    const runs = st.runs();
    assert.equal(runs[0]!.status, "killed");
  });
});

// ---------------------------------------------------------------------------
// killAllRuns
// ---------------------------------------------------------------------------

describe("killAllRuns", () => {
  test("returns empty when no runs", () => {
    const st = createStore();
    assert.equal(killAllRuns({ store: st }).length, 0);
  });

  test("kills all in-flight runs", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1" }));
    st.recordRunStart(makeRun({ id: "r2", name: "wf2" }));
    const results = killAllRuns({ store: st });
    assert.equal(results.length, 2);
    assert.equal(results.every((r) => r.ok), true);
    assert.equal(st.runs().every((r) => r.status === "killed"), true);
  });

  test("does not kill already-ended runs", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1" }));
    st.recordRunEnd("r1", "completed");
    const results = killAllRuns({ store: st });
    // No in-flight runs, so returns empty
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// resumeRun
// ---------------------------------------------------------------------------

describe("resumeRun", () => {
  test("returns ok:false reason:not_found for unknown runId", () => {
    const st = createStore();
    const result = resumeRun("nonexistent", { store: st });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_found");
  });

  test("returns ok:true with snapshot for still-active run", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1", name: "my-wf" }));
    const result = resumeRun("r1", { store: st });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.runId, "r1");
      assert.equal(result.snapshot.name, "my-wf");
      assert.equal(result.snapshot.status, "running");
    }
  });

  test("returns ok:true with snapshot for ended run", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1", name: "my-wf" }));
    st.recordRunEnd("r1", "completed");
    const result = resumeRun("r1", { store: st });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.runId, "r1");
      assert.equal(result.snapshot.name, "my-wf");
      assert.equal(result.snapshot.status, "completed");
    }
  });

  test("returned snapshot is a deep copy (not a reference)", () => {
    const st = createStore();
    st.recordRunStart(makeRun({ id: "r1" }));
    st.recordRunEnd("r1", "failed");
    const result = resumeRun("r1", { store: st });
    if (result.ok) {
      // Mutating the snapshot should not affect the store
      (result.snapshot as { name: string }).name = "mutated";
      const stored = st.runs().find((r) => r.id === "r1");
      assert.equal(stored!.name, "my-wf");
    }
  });
});
