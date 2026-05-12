/**
 * Unit tests for the background-workflow widget.
 *
 * Visual contract:
 *   - 3-row outline-pill band header (`[ BACKGROUND ]` accent pill +
 *     `N runs` subtitle + status-icon count badges).
 *   - Two-line entry per run (status glyph + short id + bold name on
 *     line 1; dim mode · progress · duration on line 2).
 *   - Blank line between entries, no trailing blank.
 *   - Collapsed single-line form below 80 cells.
 *   - Hides entirely (returns []) when no active or recently-ended runs.
 *
 * cross-ref: src/tui/widget.ts · orchestrator-panel-ui.png · DESIGN.md §5
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  renderWidgetLines,
  buildThemedWidgetLines,
  formatDuration,
} from "../../src/tui/widget.js";
import type {
  StoreSnapshot,
  RunSnapshot,
  StageSnapshot,
} from "../../src/shared/store-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStage(
  id: string,
  name: string,
  status: StageSnapshot["status"],
): StageSnapshot {
  return { id, name, status, parentIds: [], toolEvents: [] };
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

const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

const NULL_PI_THEME = {
  fg: (_c: string, t: string) => t,
  bold: (t: string) => t,
};

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  test("< 60 s → just seconds", () => {
    assert.equal(formatDuration(0), "0s");
    assert.equal(formatDuration(5000), "5s");
    assert.equal(formatDuration(59_000), "59s");
  });

  test(">= 60 s → minutes + seconds (no trailing 0s)", () => {
    assert.equal(formatDuration(60_000), "1m");
    assert.equal(formatDuration(84_000), "1m 24s");
    assert.equal(formatDuration(3540_000), "59m");
  });

  test(">= 1 hour → hours + minutes (no trailing 0m)", () => {
    assert.equal(formatDuration(3600_000), "1h");
    assert.equal(formatDuration(3720_000), "1h 2m");
  });

  test("negative ms is clamped to zero", () => {
    assert.equal(formatDuration(-100), "0s");
  });
});

// ---------------------------------------------------------------------------
// renderWidgetLines — empty + hidden states
// ---------------------------------------------------------------------------

describe("renderWidgetLines — hidden states", () => {
  test("no runs → empty array (widget hides)", () => {
    assert.deepEqual(renderWidgetLines(makeSnap([])), []);
  });

  test("all runs ended over 30s ago → empty array", () => {
    const now = Date.now();
    const snap = makeSnap([
      makeRun("r1", "wf", "completed", [], now - 90_000, now - 60_000),
    ]);
    assert.deepEqual(renderWidgetLines(snap), []);
  });
});

// ---------------------------------------------------------------------------
// renderWidgetLines — standard form (≥ 80 cols)
// ---------------------------------------------------------------------------

describe("renderWidgetLines — standard form", () => {
  test("single active run → band header + 2-line entry (5 lines total)", () => {
    const snap = makeSnap([makeRun("abc123uuid", "my-wf", "running")]);
    const lines = renderWidgetLines(snap, 120).map(stripAnsi);
    // 3 chrome rows + 2 content rows = 5 total
    assert.equal(lines.length, 5);
    // Band header pill label
    assert.ok(lines[1]!.includes("BACKGROUND"), "header should include BACKGROUND label");
    // Subtitle reflects total run count
    assert.ok(lines[1]!.includes("1 run"), "header should include 1 run subtitle");
    // Entry line 1: short id (6 chars) + workflow name
    assert.ok(lines[3]!.includes("abc123"), "line 1 should include short id");
    assert.ok(lines[3]!.includes("my-wf"), "line 1 should include workflow name");
    // Entry line 2: mode label
    assert.ok(lines[4]!.includes("single"), "line 2 should describe mode");
  });

  test("running run shows chain mode when multi-stage", () => {
    const run = makeRun("xyz000aaaa", "deep-research", "running", [
      makeStage("s1", "scout", "completed"),
      makeStage("s2", "specialist", "running"),
      makeStage("s3", "aggregate", "pending"),
    ]);
    const lines = renderWidgetLines(makeSnap([run]), 120).map(stripAnsi);
    const metaLine = lines[4]!;
    assert.ok(metaLine.includes("chain"), "multi-stage run reads as chain");
    assert.ok(metaLine.includes("1/3"), "progress count includes done/total");
  });

  test("multiple active runs → header subtitle pluralises, entries stacked with blank separators", () => {
    const t = Date.now();
    const r1 = makeRun("aaa111zzz", "wf-one", "running", [], t - 2000);
    const r2 = makeRun("bbb222zzz", "wf-two", "running", [], t - 100);
    const lines = renderWidgetLines(makeSnap([r1, r2]), 120).map(stripAnsi);
    assert.ok(lines[1]!.includes("2 runs"));
    const joined = lines.join("\n");
    assert.ok(joined.includes("wf-one"));
    assert.ok(joined.includes("wf-two"));
    // Most-recently-started run is shown first.
    const wfTwoIdx = lines.findIndex((l) => l.includes("wf-two"));
    const wfOneIdx = lines.findIndex((l) => l.includes("wf-one"));
    assert.ok(wfTwoIdx < wfOneIdx, "most recently started run renders first");
  });

  test("count badges reflect status mix", () => {
    const t = Date.now();
    const running = makeRun("r1xxxxxx", "wf-r", "running", [], t - 1000);
    const done = makeRun("r2xxxxxx", "wf-d", "completed", [], t - 5000, t - 1000);
    const failed = makeRun("r3xxxxxx", "wf-f", "failed", [], t - 4000, t - 500);
    const lines = renderWidgetLines(makeSnap([running, done, failed]), 120).map(stripAnsi);
    const header = lines[1]!;
    assert.ok(header.includes("● 1"), "running badge");
    assert.ok(header.includes("✓ 1"), "completed badge");
    assert.ok(header.includes("✗ 1"), "failed badge");
  });

  test("running run uses static ● glyph, never a braille spinner frame", () => {
    // The widget is the canonical 'workflow status' surface; per DESIGN.md
    // 'no spinners on prompt; no flash' it must render the same static
    // vocabulary as `renderStatusList`/`renderRunDetail` (statusIcon → '●').
    const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const t = Date.now();
    const snap = makeSnap([
      makeRun("r1xxxxxx", "wf-r", "running", [makeStage("s1", "stage-1", "running")], t - 1000),
    ]);
    // Sample several `now` offsets — a frame-cycling glyph would land on
    // a different braille character at each tick.
    for (let dt = 0; dt < 800; dt += 80) {
      const lines = renderWidgetLines(snap, 120).map(stripAnsi);
      const joined = lines.join("\n");
      assert.ok(joined.includes("●"), `static ● glyph at +${dt}ms`);
      for (const frame of SPINNER_FRAMES) {
        assert.ok(
          !joined.includes(frame),
          `widget must not emit braille spinner frame ${JSON.stringify(frame)} at +${dt}ms`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// renderWidgetLines — collapsed form (< 80 cols)
// ---------------------------------------------------------------------------

describe("renderWidgetLines — collapsed form", () => {
  test("returns single line summary under threshold", () => {
    const r1 = makeRun("aaa", "wf-a", "running");
    const r2 = makeRun("bbb", "wf-b", "running");
    const lines = renderWidgetLines(makeSnap([r1, r2]), 60).map(stripAnsi);
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.includes("▾"));
    assert.ok(lines[0]!.includes("2 background"));
    assert.ok(lines[0]!.includes("2 ●"));
  });
});

// ---------------------------------------------------------------------------
// buildThemedWidgetLines — ANSI path includes Catppuccin escapes
// ---------------------------------------------------------------------------

describe("buildThemedWidgetLines — themed path", () => {
  test("when piTheme is provided, output carries ANSI escape sequences", () => {
    const snap = makeSnap([makeRun("zzz", "themed-wf", "running")]);
    const lines = buildThemedWidgetLines(snap, NULL_PI_THEME, 120);
    assert.ok(lines.length >= 5, "themed render returns header + entry lines");
    const joined = lines.join("");
    assert.ok(joined.includes("\x1b["), "themed lines include ANSI escapes");
  });
});
