/**
 * Unit tests for src/tui/session-picker.ts — selection logic, key handling,
 * and a render-smoke test (no thrown errors, expected content present).
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  createSessionPickerState,
  handleSessionPickerInput,
  renderSessionPicker,
  selectRunsForPicker,
} from "../../packages/workflows/src/tui/session-picker.ts";
import { deriveGraphTheme } from "../../packages/workflows/src/tui/graph-theme.ts";
import type { RunSnapshot } from "../../packages/workflows/src/shared/store-types.ts";

function makeRun(over: Partial<RunSnapshot>): RunSnapshot {
  return {
    id: over.id ?? "00000000-0000-0000-0000-000000000000",
    name: over.name ?? "demo",
    inputs: over.inputs ?? {},
    status: over.status ?? "running",
    stages: over.stages ?? [],
    startedAt: over.startedAt ?? 1000,
    endedAt: over.endedAt,
    durationMs: over.durationMs,
    result: over.result,
    error: over.error,
  };
}

test("selectRunsForPicker buckets active vs recent, drops old by default", () => {
  const now = 10_000_000;
  const hourMs = 60 * 60 * 1000;
  const runs: RunSnapshot[] = [
    makeRun({ id: "a-active", status: "running", startedAt: now - 1000 }),
    makeRun({ id: "b-recent", status: "completed", startedAt: now - 5000, endedAt: now - 1000, durationMs: 4000 }),
    makeRun({ id: "c-old", status: "completed", startedAt: now - hourMs * 4, endedAt: now - hourMs * 3, durationMs: hourMs }),
  ];
  const rows = selectRunsForPicker(runs, "", false, now);
  assert.deepEqual(rows.map((r) => r.run.id), ["a-active", "b-recent"]);
  assert.deepEqual(rows.map((r) => r.bucket), ["active", "recent"]);

  const all = selectRunsForPicker(runs, "", true, now);
  assert.equal(all.length, 3);
});

test("selectRunsForPicker filters by name and runId prefix", () => {
  const runs: RunSnapshot[] = [
    makeRun({ id: "abc12345-0000-0000-0000-000000000000", name: "ralph" }),
    makeRun({ id: "def67890-0000-0000-0000-000000000000", name: "deep-research" }),
  ];
  assert.equal(selectRunsForPicker(runs, "ralph", true).length, 1);
  assert.equal(selectRunsForPicker(runs, "research", true).length, 1);
  assert.equal(selectRunsForPicker(runs, "abc", true)[0]?.run.name, "ralph");
  assert.equal(selectRunsForPicker(runs, "zzz", true).length, 0);
});

test("handleSessionPickerInput: enter on selected row returns connect", () => {
  const state = createSessionPickerState();
  const rows = [
    { run: makeRun({ id: "id-1", name: "a" }), bucket: "active" as const },
    { run: makeRun({ id: "id-2", name: "b" }), bucket: "active" as const },
  ];
  const action = handleSessionPickerInput("\r", state, rows);
  assert.deepEqual(action, { kind: "connect", runId: "id-1" });
});

test("handleSessionPickerInput: arrows navigate, x kills selected row", () => {
  const state = createSessionPickerState();
  const rows = [
    { run: makeRun({ id: "id-1" }), bucket: "active" as const },
    { run: makeRun({ id: "id-2" }), bucket: "active" as const },
  ];
  handleSessionPickerInput("\x1b[B", state, rows);
  assert.equal(state.selectedIndex, 1);
  const kill = handleSessionPickerInput("x", state, rows);
  assert.deepEqual(kill, { kind: "kill", runId: "id-2" });
});

test("handleSessionPickerInput: / enters filter mode and types into query", () => {
  const state = createSessionPickerState();
  const rows = [{ run: makeRun({ id: "id-1" }), bucket: "active" as const }];
  handleSessionPickerInput("/", state, rows);
  assert.equal(state.filterFocused, true);
  handleSessionPickerInput("r", state, rows);
  handleSessionPickerInput("a", state, rows);
  assert.equal(state.query, "ra");
  // Backspace removes a char.
  handleSessionPickerInput("\x7f", state, rows);
  assert.equal(state.query, "r");
  // Enter exits filter mode without firing connect.
  const action = handleSessionPickerInput("\r", state, rows);
  assert.deepEqual(action, { kind: "noop" });
  assert.equal(state.filterFocused, false);
});

test("handleSessionPickerInput: a toggles includeAll", () => {
  const state = createSessionPickerState();
  assert.equal(state.includeAll, false);
  handleSessionPickerInput("a", state, []);
  assert.equal(state.includeAll, true);
  handleSessionPickerInput("a", state, []);
  assert.equal(state.includeAll, false);
});

test("handleSessionPickerInput: esc closes", () => {
  const state = createSessionPickerState();
  const action = handleSessionPickerInput("\x1b", state, []);
  assert.deepEqual(action, { kind: "close" });
});

test("renderSessionPicker emits header, sections, and footer hints", () => {
  const theme = deriveGraphTheme({});
  const state = createSessionPickerState();
  const rows = [
    { run: makeRun({ id: "aaaa1111-0000-0000-0000-000000000000", name: "ralph" }), bucket: "active" as const },
    { run: makeRun({ id: "bbbb2222-0000-0000-0000-000000000000", name: "deep-research", status: "completed", endedAt: 2000 }), bucket: "recent" as const },
  ];
  const lines = renderSessionPicker({ width: 80, theme, rows, state });
  const joined = lines.join("\n");
  assert.match(joined, /Connect to workflow run/);
  assert.match(joined, /ACTIVE/);
  assert.match(joined, /RECENT/);
  assert.match(joined, /aaaa1111/);
  assert.match(joined, /ralph/);
  assert.match(joined, /navigate/);
  assert.match(joined, /connect/);
  assert.match(joined, /kill/);
});

test("renderSessionPicker shows empty state when no rows", () => {
  const theme = deriveGraphTheme({});
  const state = createSessionPickerState();
  const lines = renderSessionPicker({ width: 80, theme, rows: [], state });
  assert.match(lines.join("\n"), /no workflow runs to show/);
});

test("renderSessionPicker emits a clean ╰────╯ bottom border with hints on a separate row below", () => {
  // Regression gate: previously the hints text was embedded inside the
  // bottom-corner row (`╰── ↑↓ navigate · …  ╯`), producing the broken
  // border visible in the user's report. The fix renders the bottom
  // corner as `╰─────╯` and emits the hints on the next line, outside
  // the box.
  const theme = deriveGraphTheme({});
  const state = createSessionPickerState();
  const rows = [
    { run: makeRun({ id: "aaaa1111-0000-0000-0000-000000000000", name: "ralph" }), bucket: "active" as const },
  ];
  const lines = renderSessionPicker({ width: 80, theme, rows, state });
  // The last visible chrome row is the hints text — no border glyphs.
  const hintsLine = lines[lines.length - 1]!;
  // Strip ANSI to inspect the printable characters.
  // eslint-disable-next-line no-control-regex
  const stripped = hintsLine.replace(/\u001b\[[0-9;]*m/g, "");
  assert.match(stripped, /navigate/);
  assert.ok(!stripped.includes("╰"), "hints row must not include the bottom-left corner glyph");
  assert.ok(!stripped.includes("╯"), "hints row must not include the bottom-right corner glyph");

  // The penultimate row is the clean bottom border with NO hint text
  // embedded inside it.
  const borderLine = lines[lines.length - 2]!;
  // eslint-disable-next-line no-control-regex
  const borderStripped = borderLine.replace(/\u001b\[[0-9;]*m/g, "");
  assert.ok(borderStripped.startsWith("╰"), `bottom border should start with ╰; got ${JSON.stringify(borderStripped)}`);
  assert.ok(borderStripped.endsWith("╯"), `bottom border should end with ╯; got ${JSON.stringify(borderStripped)}`);
  assert.ok(!/navigate|connect|kill|filter/.test(borderStripped), "bottom border must not embed hint labels");
  // Interior of the border is just `─` (plus the corner glyphs).
  const interior = borderStripped.slice(1, -1);
  assert.ok(/^─+$/.test(interior), `bottom border interior should be only ─; got ${JSON.stringify(interior)}`);
});
