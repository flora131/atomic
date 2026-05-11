/**
 * Unit tests for compact widget rendering.
 * Tests: renderWidgetLines, buildRunSummaryLine, buildSparkline, formatDuration.
 * cross-ref: spec §5.4.4, §5.4.6, §8.1 Phase E
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  renderWidgetLines,
  buildRunSummaryLine,
  buildSparkline,
  formatDuration,
} from "../../src/tui/widget.js";
import type { StoreSnapshot, RunSnapshot, StageSnapshot } from "../../src/shared/store-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStage(
  id: string,
  name: string,
  status: StageSnapshot["status"],
): StageSnapshot {
  return {
    id,
    name,
    status,
    parentIds: [],
    toolEvents: [],
  };
}

function makeRun(
  id: string,
  name: string,
  status: RunSnapshot["status"],
  stages: StageSnapshot[] = [],
  startedAt = Date.now() - 5000,
  endedAt?: number,
): RunSnapshot {
  return {
    id,
    name,
    inputs: {},
    status,
    stages,
    startedAt,
    endedAt,
    durationMs: endedAt !== undefined ? endedAt - startedAt : undefined,
  };
}

function makeSnap(runs: RunSnapshot[]): StoreSnapshot {
  return { runs, notices: [], version: 1 };
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  test("< 60 s → just seconds", () => {
    assert.equal(formatDuration(0), "0s");
    assert.equal(formatDuration(5000), "5s");
    assert.equal(formatDuration(59_000), "59s");
  });

  test(">= 60 s → minutes + seconds", () => {
    assert.equal(formatDuration(60_000), "1m 0s");
    assert.equal(formatDuration(84_000), "1m 24s");
    assert.equal(formatDuration(3600_000), "60m 0s");
  });

  test("fractional ms is floored", () => {
    assert.equal(formatDuration(1999), "1s");
    assert.equal(formatDuration(61_999), "1m 1s");
  });
});

// ---------------------------------------------------------------------------
// buildSparkline
// ---------------------------------------------------------------------------

describe("buildSparkline", () => {
  test("no stages → empty string", () => {
    const run = makeRun("r1", "test", "running");
    assert.equal(buildSparkline(run), "");
  });

  test("maps status to glyphs", () => {
    const run = makeRun("r1", "test", "running", [
      makeStage("s1", "a", "completed"),
      makeStage("s2", "b", "running"),
      makeStage("s3", "c", "pending"),
      makeStage("s4", "d", "failed"),
    ]);
    assert.equal(buildSparkline(run), "█ ▶ · ✗");
  });

  test("truncates to maxWidth", () => {
    const stages = Array.from({ length: 20 }, (_, i) =>
      makeStage(`s${i}`, `stage-${i}`, "completed"),
    );
    const run = makeRun("r1", "test", "running", stages);
    const line = buildSparkline(run, 10);
    assert.ok(line.length <= 10);
    assert.equal(line.endsWith("…"), true);
  });
});

// ---------------------------------------------------------------------------
// buildRunSummaryLine
// ---------------------------------------------------------------------------

describe("buildRunSummaryLine", () => {
  test("no stages — shows stage 1/0", () => {
    const run = makeRun("r1", "my-workflow", "running", [], Date.now() - 1000);
    const line = buildRunSummaryLine(run);
    assert.ok(line.includes("▶ my-workflow"));
    assert.ok(line.includes("stage 1"));
    assert.ok(line.includes("⏱"));
  });

  test("with stages — counts done and labels active", () => {
    const run = makeRun(
      "r1",
      "deep-research",
      "running",
      [
        makeStage("s1", "scout", "completed"),
        makeStage("s2", "specialist-1", "running"),
        makeStage("s3", "aggregate", "pending"),
      ],
      Date.now() - 84_000,
    );
    const line = buildRunSummaryLine(run);
    assert.ok(line.includes("▶ deep-research"));
    assert.ok(line.includes("stage 2/3"));
    assert.ok(line.includes("(specialist-1)"));
    assert.ok(line.includes("1m 24s"));
  });

  test("uses durationMs for ended runs", () => {
    const now = Date.now();
    const run = makeRun("r1", "wf", "completed", [], now - 10_000, now);
    run.durationMs = 10_000;
    const line = buildRunSummaryLine(run);
    assert.ok(line.includes("10s"));
  });
});

// ---------------------------------------------------------------------------
// renderWidgetLines
// ---------------------------------------------------------------------------

describe("renderWidgetLines", () => {
  test("no runs → empty array", () => {
    const snap = makeSnap([]);
    assert.deepEqual(renderWidgetLines(snap), []);
  });

  test("all runs ended → empty array", () => {
    const now = Date.now();
    const snap = makeSnap([makeRun("r1", "wf", "completed", [], now - 1000, now)]);
    assert.deepEqual(renderWidgetLines(snap), []);
  });

  test("single active run → line 1 only (no stages)", () => {
    const snap = makeSnap([makeRun("r1", "my-wf", "running")]);
    const lines = renderWidgetLines(snap);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("▶ my-wf"));
  });

  test("single active run with stages → line 1 + sparkline", () => {
    const run = makeRun("r1", "my-wf", "running", [
      makeStage("s1", "a", "completed"),
      makeStage("s2", "b", "running"),
    ]);
    const snap = makeSnap([run]);
    const lines = renderWidgetLines(snap);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes("▶ my-wf"));
    assert.ok(lines[1].includes("█"));
    assert.ok(lines[1].includes("▶"));
  });

  test("multiple active runs → line 2 multi-run badge + sparkline", () => {
    const run1 = makeRun("r1", "wf-1", "running", [makeStage("s1", "a", "running")]);
    const run2 = makeRun("r2", "wf-2", "running", [makeStage("s2", "b", "running")]);
    const snap = makeSnap([run1, run2]);
    const lines = renderWidgetLines(snap, 80);
    // line 1: primary (most recent = run2)
    assert.ok(lines[0].includes("▶ wf-2"));
    // line 2: multi-run badge
    assert.ok(lines[1].includes("2 runs in flight"));
    // line 3: sparkline
    assert.ok(lines[2].includes("▶"));
  });

  test("respects width — truncates line 1 with ellipsis", () => {
    const run = makeRun("r1", "very-long-workflow-name", "running", [], Date.now() - 100_000);
    const snap = makeSnap([run]);
    const lines = renderWidgetLines(snap, 20);
    assert.ok(lines[0]!.length <= 20);
    assert.match(lines[0], /…$/);
  });

  test("primary run = most recently started active run", () => {
    const run1 = makeRun("r1", "first", "running", [], Date.now() - 2000);
    const run2 = makeRun("r2", "second", "running", [], Date.now() - 100);
    const snap = makeSnap([run1, run2]);
    const lines = renderWidgetLines(snap);
    // run2 is last in array (most recently started)
    assert.ok(lines[0].includes("▶ second"));
  });
});
