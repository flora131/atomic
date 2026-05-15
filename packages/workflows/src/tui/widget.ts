/**
 * Above-editor background-workflow widget.
 *
 * Visual contract (DESIGN.md §5 · orchestrator-panel-ui.png):
 *  - 3-row outline-pill band header: `[ BACKGROUND ]` accent pill,
 *    `N runs` subtitle in textMuted, right-aligned status-icon badges
 *    (`✓ n  ● n  ○ n  ✗ n`). Same chrome vocabulary as the orchestrator
 *    overlay header — pi-subagents widget identity, atomic palette.
 *  - Two-line entry per run:
 *      line 1: `<status glyph>  <short id>  <bold name>`
 *      line 2: `<dim mode · progress · duration>`
 *  - Blank line between entries; trailing blank trimmed.
 *  - Collapsed single-line form below 80 cells:
 *      `▾  N background · X ●` in dim+warning.
 *
 * Theme handling:
 *  - The widget always renders against the canonical Catppuccin Mocha
 *    palette (DESIGN.md "Status-Is-Truth"). Pi's runtime PiTheme is
 *    used only as a yes/no signal for ANSI: theme=undefined → plain
 *    text, theme=defined → coloured chrome.
 *
 * cross-ref:
 *  - github.com/nicobailon/pi-subagents src/tui/render.ts buildWidgetLines
 *  - src/tui/header.ts renderBandHeader
 *  - orchestrator-panel-ui.png
 */

import type {
  StoreSnapshot,
  RunSnapshot,
} from "../shared/store-types.js";
import type { PiTheme } from "./store-widget-installer.js";
import { renderBandHeader } from "./header.js";
import type { BandBadge } from "./header.js";
import { deriveGraphTheme } from "./graph-theme.js";
import type { GraphTheme } from "./graph-theme.js";
import { hexToAnsi, RESET, BOLD } from "./color-utils.js";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const SHORT_ID_LEN = 6;
const MAX_VISIBLE_RUNS = 4;
const RECENT_ENDED_WINDOW_MS = 30_000;
const COLLAPSED_BREAKPOINT_COLS = 80;

// ---------------------------------------------------------------------------
// Public formatters (kept for cross-module reuse)
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (minutes < 60) return `${minutes}m${secs > 0 ? ` ${secs}s` : ""}`;
  const hours = Math.floor(minutes / 60);
  const rmin = minutes % 60;
  return `${hours}h${rmin > 0 ? ` ${rmin}m` : ""}`;
}

// ---------------------------------------------------------------------------
// Run classification + selection
// ---------------------------------------------------------------------------

function isActive(run: RunSnapshot): boolean {
  return run.endedAt === undefined;
}

function recentlyEnded(run: RunSnapshot, now: number): boolean {
  return run.endedAt !== undefined && now - run.endedAt <= RECENT_ENDED_WINDOW_MS;
}

interface RunCounts {
  active: number;
  done: number;
  failed: number;
  /** Runs with a pending HIL prompt — surfaced as a separate badge so the
   *  user knows to attach via F2 before more progress is possible. */
  awaiting: number;
}

function countRuns(runs: readonly RunSnapshot[]): RunCounts {
  const counts: RunCounts = { active: 0, done: 0, failed: 0, awaiting: 0 };
  for (const r of runs) {
    if (r.endedAt === undefined) counts.active++;
    else if (r.status === "completed") counts.done++;
    else if (r.status === "failed" || r.status === "killed") counts.failed++;
    if (r.endedAt === undefined && r.pendingPrompt !== undefined) {
      counts.awaiting++;
    }
  }
  return counts;
}

function selectDisplayRuns(snap: StoreSnapshot, now: number): RunSnapshot[] {
  const all = snap.runs as readonly RunSnapshot[];
  const active = all.filter((r) => isActive(r));
  const recent = all.filter((r) => recentlyEnded(r, now));
  // Most recently started first within each bucket; active runs precede recent.
  const sort = (xs: RunSnapshot[]) =>
    [...xs].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const ordered = [...sort(active), ...sort(recent)];
  return ordered.slice(0, MAX_VISIBLE_RUNS);
}

// ---------------------------------------------------------------------------
// Per-run derived strings
// ---------------------------------------------------------------------------

function shortId(run: RunSnapshot): string {
  return run.id.length > SHORT_ID_LEN ? run.id.slice(0, SHORT_ID_LEN) : run.id;
}

function statusGlyph(run: RunSnapshot): string {
  switch (run.status) {
    case "running":
      return "●";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    case "killed":
      return "⊘";
    case "pending":
    default:
      return "○";
  }
}

function statusFg(run: RunSnapshot, theme: GraphTheme): string {
  switch (run.status) {
    case "running":
      return theme.warning;
    case "completed":
      return theme.success;
    case "failed":
      return theme.error;
    case "killed":
      return theme.warning;
    case "pending":
    default:
      return theme.dim;
  }
}

function modeLabel(run: RunSnapshot): string {
  return run.stages.length > 1 ? "chain" : "single";
}

function progressLabel(run: RunSnapshot): string | undefined {
  const total = run.stages.length;
  if (total === 0) return undefined;
  const done = run.stages.filter(
    (s) => s.status === "completed" || s.status === "failed",
  ).length;
  return `${done}/${total}`;
}

function elapsedLabel(run: RunSnapshot, now: number): string {
  if (run.endedAt !== undefined) {
    const ago = formatDuration(now - run.endedAt);
    if (run.status === "completed") return `complete · ${ago} ago`;
    if (run.status === "failed") return `failed · ${ago} ago`;
    if (run.status === "killed") return `killed · ${ago} ago`;
    return `${run.status} · ${ago} ago`;
  }
  if (run.startedAt != null) return formatDuration(now - run.startedAt);
  return "";
}

function metaLine(run: RunSnapshot, now: number): string {
  if (run.endedAt !== undefined) {
    return elapsedLabel(run, now);
  }
  const parts: string[] = [modeLabel(run)];
  const prog = progressLabel(run);
  if (prog) parts.push(prog);
  const elapsed = elapsedLabel(run, now);
  if (elapsed) parts.push(elapsed);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Count badges for the band header
// ---------------------------------------------------------------------------

function countBadges(counts: RunCounts, theme: GraphTheme): BandBadge[] {
  const badges: BandBadge[] = [];
  if (counts.active > 0) badges.push({ text: `● ${counts.active}`, fg: theme.warning });
  // Awaiting input is shown in Sky per DESIGN.md status semantics: it's a
  // "live, waiting for human" signal — distinct from running (yellow) and
  // completed (green). Position right after active so it reads as "N of M
  // running need you".
  if (counts.awaiting > 0) badges.push({ text: `↵ ${counts.awaiting}`, fg: theme.info });
  if (counts.done > 0) badges.push({ text: `✓ ${counts.done}`, fg: theme.success });
  if (counts.failed > 0) badges.push({ text: `✗ ${counts.failed}`, fg: theme.error });
  return badges;
}

// ---------------------------------------------------------------------------
// Themed rendering (ANSI + Catppuccin)
// ---------------------------------------------------------------------------

function themedRunLines(
  run: RunSnapshot,
  now: number,
  theme: GraphTheme,
): string[] {
  const dim = hexToAnsi(theme.dim);
  const text = hexToAnsi(theme.text);
  const accent = hexToAnsi(theme.accent);
  const muted = hexToAnsi(theme.textMuted);
  const glyphFg = hexToAnsi(statusFg(run, theme));

  const glyph = statusGlyph(run);
  const sid = shortId(run);
  const name = run.name;

  const line1 = `   ${glyphFg}${glyph}${RESET}  ${accent}${sid}${RESET}  ${text}${BOLD}${name}${RESET}`;
  const meta = metaLine(run, now);
  // Render the meta line in muted while running so the elapsed-time
  // gradient stays readable; dim it once the run has terminated.
  const metaFg = run.status === "running" ? muted : dim;
  const line2 = `     ${metaFg}${meta}${RESET}`;
  return [line1, line2];
}

function plainRunLines(run: RunSnapshot, now: number): string[] {
  const line1 = `   ${statusGlyph(run)}  ${shortId(run)}  ${run.name}`;
  const line2 = `     ${metaLine(run, now)}`;
  return [line1, line2];
}

// ---------------------------------------------------------------------------
// Collapsed (< 80 cell) form
// ---------------------------------------------------------------------------

function themedCollapsed(
  counts: RunCounts,
  theme: GraphTheme,
): string {
  const mauve = hexToAnsi(theme.mauve);
  const dim = hexToAnsi(theme.dim);
  const muted = hexToAnsi(theme.textMuted);
  const warning = hexToAnsi(theme.warning);
  const total = counts.active + counts.done + counts.failed;
  const active = counts.active;
  return ` ${mauve}▾${RESET}  ${muted}${total} background${RESET}${dim} · ${RESET}${warning}${active} ●${RESET}`;
}

function plainCollapsed(counts: RunCounts): string {
  const total = counts.active + counts.done + counts.failed;
  return ` ▾  ${total} background · ${counts.active} ●`;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Build the widget lines for the current store snapshot.
 *
 * Returns `[]` when there are no active or recently-ended runs (the
 * widget hides entirely — DESIGN.md "earn every element").
 *
 * `piTheme` is treated as a boolean signal: defined → render ANSI
 * Catppuccin chrome; undefined → render plain text for test/headless
 * consumers.
 */
export function buildThemedWidgetLines(
  snap: StoreSnapshot,
  piTheme: PiTheme | undefined,
  width = 120,
): string[] {
  const now = Date.now();
  const display = selectDisplayRuns(snap, now);
  if (display.length === 0) return [];

  const counts = countRuns(snap.runs as readonly RunSnapshot[]);
  // Active + recently-ended dominate the badge counts so a finished run
  // visually persists for a beat before dropping off.
  const visibleCounts: RunCounts = {
    active: counts.active,
    done: display.filter((r) => r.endedAt !== undefined && r.status === "completed").length,
    failed: display.filter((r) => r.endedAt !== undefined && (r.status === "failed" || r.status === "killed")).length,
    awaiting: counts.awaiting,
  };

  const themed = piTheme !== undefined;
  const graphTheme = deriveGraphTheme({});

  // Collapsed single-line form for narrow terminals.
  if (width < COLLAPSED_BREAKPOINT_COLS) {
    return [themed ? themedCollapsed(visibleCounts, graphTheme) : plainCollapsed(visibleCounts)];
  }

  const total = counts.active + counts.done + counts.failed;
  const subtitle = `${total} run${total === 1 ? "" : "s"}`;

  const lines: string[] = [];

  if (themed) {
    const badges = countBadges(visibleCounts, graphTheme);
    // Cap the chrome width to ~min(width, 64) so a wide terminal doesn't
    // stretch the band across the whole pane.
    const chromeWidth = Math.min(width, 64);
    lines.push(...renderBandHeader({
      label: "BACKGROUND",
      subtitle,
      badges,
      width: chromeWidth,
      theme: graphTheme,
    }));
  } else {
    // Plain band: 3 rows mirroring the outline-pill shape, ASCII-only.
    const innerLen = " BACKGROUND ".length;
    const inner = "─".repeat(innerLen);
    const badges = countBadges(visibleCounts, graphTheme)
      .map((b) => b.text)
      .join("  ");
    const subtitleSeg = `  ${subtitle}`;
    const badgeTail = badges ? `   ${badges}` : "";
    lines.push(` ╭${inner}╮${subtitleSeg.replace(/./g, " ")}${badgeTail.replace(/./g, " ")}`);
    lines.push(` │ BACKGROUND │${subtitleSeg}${badgeTail}`);
    lines.push(` ╰${inner}╯${subtitleSeg.replace(/./g, " ")}${badgeTail.replace(/./g, " ")}`);
  }

  for (let i = 0; i < display.length; i++) {
    const run = display[i]!;
    const runLines = themed
      ? themedRunLines(run, now, graphTheme)
      : plainRunLines(run, now);
    lines.push(...runLines);
    if (i < display.length - 1) lines.push("");
  }

  return lines;
}

/**
 * Plain-text widget entry point retained for tests and snapshot tooling.
 * Equivalent to `buildThemedWidgetLines(snap, undefined, width)`.
 */
export function renderWidgetLines(snap: StoreSnapshot, width = 120): string[] {
  return buildThemedWidgetLines(snap, undefined, width);
}
