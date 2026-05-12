/**
 * Unit tests for the canonical status-list renderer (`src/tui/status-list.ts`).
 * Verifies the band-header chrome, per-run header line, stage indent,
 * and detail hint match the brief mockup byte-for-visible-byte.
 *
 * cross-ref: src/tui/status-list.ts · orchestrator-panel-ui.png
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderStatusList } from "../../src/tui/status-list.js";
import { deriveGraphTheme } from "../../src/tui/graph-theme.js";
import type { RunSnapshot, StageSnapshot } from "../../src/shared/store-types.js";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

function makeStage(
  id: string,
  name: string,
  status: StageSnapshot["status"],
  extras: Partial<StageSnapshot> = {},
): StageSnapshot {
  return {
    id,
    name,
    status,
    parentIds: [],
    toolEvents: [],
    ...extras,
  };
}

function makeRun(over: Partial<RunSnapshot>): RunSnapshot {
  return {
    id: over.id ?? "abc123uuid",
    name: over.name ?? "refactor-auth",
    inputs: over.inputs ?? {},
    status: over.status ?? "running",
    stages: over.stages ?? [],
    startedAt: over.startedAt ?? Date.now() - 5000,
    endedAt: over.endedAt,
    durationMs: over.durationMs,
    result: over.result,
    error: over.error,
  };
}

describe("renderStatusList — empty", () => {
  test("emits the band header + empty-state copy when no runs", () => {
    const out = renderStatusList([], { theme: deriveGraphTheme({}) });
    const plain = stripAnsi(out);
    assert.match(plain, /BACKGROUND/);
    assert.match(plain, /0 runs/);
    assert.match(plain, /no in-flight runs/);
  });
});

describe("renderStatusList — populated", () => {
  test("multi-run snapshot renders header counts, short ids, stage rows, detail hint", () => {
    const now = 1_000_000;
    const runs: RunSnapshot[] = [
      makeRun({
        id: "abc123uuid",
        name: "refactor-auth",
        status: "running",
        startedAt: now - 117_000,
        stages: [
          makeStage("s1", "scout", "completed", { startedAt: now - 117_000, endedAt: now - 72_000, durationMs: 45_000 }),
          makeStage("s2", "planner", "running", { startedAt: now - 72_000 }),
          makeStage("s3", "worker", "pending"),
        ],
      }),
      makeRun({
        id: "def456uuid",
        name: "doc-update",
        status: "running",
        startedAt: now - 42_000,
        stages: [makeStage("w1", "writer", "running", { startedAt: now - 42_000 })],
      }),
      makeRun({
        id: "ghi789uuid",
        name: "scan-deps",
        status: "completed",
        startedAt: now - 16_000,
        endedAt: now - 8_000,
        durationMs: 8_000,
      }),
    ];
    const out = renderStatusList(runs, { theme: deriveGraphTheme({}), now });
    const plain = stripAnsi(out);

    // Band header — chrome + subtitle + count badges.
    assert.match(plain, /BACKGROUND/);
    assert.match(plain, /3 runs/);
    assert.match(plain, /● 2/, "two active runs");
    assert.match(plain, /✓ 1/, "one completed run");

    // Per-run header lines — short ids, names, modes.
    assert.match(plain, /abc123\s+refactor-auth/);
    assert.match(plain, /def456\s+doc-update/);
    assert.match(plain, /ghi789\s+scan-deps/);
    assert.match(plain, /chain · 1\/3/);

    // Indented stage rows beneath the chain run.
    assert.match(plain, /✓ scout/);
    assert.match(plain, /● planner/);
    assert.match(plain, /○ worker/);

    // Trailing hint points at the detail action — the most-recently-started
    // active run (def456, started 42s ago) leads, so the hint references it.
    assert.match(plain, /workflow status id=def456/);
    assert.match(plain, /for detail/);
  });

  test("active runs sort ahead of ended runs", () => {
    const now = 1_000_000;
    const ended = makeRun({
      id: "endedrun",
      name: "old-run",
      status: "completed",
      startedAt: now - 60_000,
      endedAt: now - 10_000,
    });
    const active = makeRun({
      id: "activerun",
      name: "fresh-run",
      status: "running",
      startedAt: now - 30_000,
    });
    const out = renderStatusList([ended, active], { theme: deriveGraphTheme({}), now });
    const plain = stripAnsi(out);
    const activeIdx = plain.indexOf("fresh-run");
    const endedIdx = plain.indexOf("old-run");
    assert.ok(activeIdx >= 0 && endedIdx >= 0);
    assert.ok(activeIdx < endedIdx, "active runs render above ended runs");
  });

  test("plain mode (no theme) emits ASCII band chrome and no ANSI escapes", () => {
    const run = makeRun({
      id: "xyz000aaaa",
      name: "scratch",
      status: "running",
      startedAt: Date.now() - 1000,
    });
    const out = renderStatusList([run]);
    assert.doesNotMatch(out, /\x1b\[/);
    assert.match(out, /╭─+╮/);
    assert.match(out, /│ BACKGROUND │/);
    assert.match(out, /╰─+╯/);
    assert.match(out, /xyz000\s+scratch/);
  });
});
