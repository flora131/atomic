/**
 * Canonical multi-run status list — the rich, themed alternative to
 * `formatAsyncRunList()` from pi-subagents.
 *
 * Visual contract (DESIGN.md §5 · orchestrator-panel-ui.png):
 *  - 3-row outline-pill band header at the top:
 *      `[ BACKGROUND ]  N runs                ✓ a  ● b  ○ c  ✗ d`
 *  - One indented per-run header line per snapshot:
 *      `   <status glyph>  <short id>  <bold name>      state   mode · k/n · elapsed`
 *  - Indented per-stage rows beneath each run:
 *      `     <stage glyph> <name>   <state>   <activity?>   <duration?>`
 *  - Blank line between runs; trailing action hint in dim.
 *
 * Plain mode (theme omitted) uses the same shape minus ANSI escapes so
 * the renderer is snapshot-test friendly.
 *
 * Powers:
 *   - `renderResult({ action: "status" })` (LLM tool path)
 *   - `/workflow session list` chat output (via {@link renderSessionList})
 *   - `/workflow status` chat output
 *
 * cross-ref:
 *  - github.com/nicobailon/pi-subagents src/runs/background/async-status.ts
 *    `formatAsyncRunList` — the source UX pattern
 *  - src/tui/header.ts renderBandHeader
 */

import type { RunSnapshot, StageSnapshot } from "../shared/store-types.js";
import type { GraphTheme } from "./graph-theme.js";
import { renderBandHeader } from "./header.js";
import type { BandBadge } from "./header.js";
import { fmtDuration, statusIcon, statusColor } from "./status-helpers.js";
import { hexToAnsi, RESET, BOLD } from "./color-utils.js";

const SHORT_ID_LEN = 6;
const NAME_COL = 20;
const STAGE_NAME_COL = 12;
const STAGE_STATUS_COL = 10;
const STAGE_ACTIVITY_COL = 16;
const BAND_WIDTH = 64;

export interface RenderStatusListOpts {
  /** Provide for ANSI Catppuccin; omit for plain text. */
  theme?: GraphTheme;
  /** Clock override (tests). */
  now?: number;
  /** When true, show a trailing hint pointing at the detail action. */
  showDetailHint?: boolean;
}

/**
 * Render a list of run snapshots as the canonical "▎ BACKGROUND" status block.
 */
export function renderStatusList(
  runs: readonly RunSnapshot[],
  opts: RenderStatusListOpts = {},
): string {
  const now = opts.now ?? Date.now();
  const themed = opts.theme !== undefined;

  // The list shows active + recently-ended runs together. Sorting:
  // active first, then ended, each bucket by startedAt desc.
  const sorted = sortRuns(runs);

  // Header counts span the whole snapshot, not just the display window.
  const counts = countBuckets(runs);
  const total = sorted.length;
  const subtitle = `${total} run${total === 1 ? "" : "s"}`;

  const lines: string[] = [];

  if (themed) {
    lines.push(...renderBandHeader({
      label: "BACKGROUND",
      subtitle,
      badges: themedBadges(counts, opts.theme!),
      width: BAND_WIDTH,
      theme: opts.theme!,
    }));
  } else {
    lines.push(...plainBand(subtitle, plainBadges(counts)));
  }
  lines.push("");

  if (sorted.length === 0) {
    lines.push(themed && opts.theme
      ? `  ${hexToAnsi(opts.theme.dim)}no in-flight runs${RESET}`
      : "  no in-flight runs");
    return lines.join("\n");
  }

  for (let i = 0; i < sorted.length; i++) {
    const run = sorted[i]!;
    if (themed && opts.theme) {
      lines.push("   " + themedRunHeader(run, now, opts.theme));
      for (const stage of run.stages) {
        lines.push("     " + themedStageLine(stage, now, opts.theme));
      }
    } else {
      lines.push("   " + plainRunHeader(run, now));
      for (const stage of run.stages) {
        lines.push("     " + plainStageLine(stage, now));
      }
    }
    if (i < sorted.length - 1) lines.push("");
  }

  if (opts.showDetailHint !== false && sorted.length > 0) {
    const sid = shortId(sorted[0]!.id);
    lines.push("");
    if (themed && opts.theme) {
      const dim = hexToAnsi(opts.theme.dim);
      const accent = hexToAnsi(opts.theme.accent);
      lines.push(`   ${dim}▸${RESET} ${accent}workflow status id=${sid}${RESET}${dim}  for detail${RESET}`);
    } else {
      lines.push(`   ▸ workflow status id=${sid}  for detail`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Run header line
// ---------------------------------------------------------------------------

function themedRunHeader(run: RunSnapshot, now: number, theme: GraphTheme): string {
  const accent = hexToAnsi(theme.accent);
  const text = hexToAnsi(theme.text);
  const muted = hexToAnsi(theme.textMuted);
  const dim = hexToAnsi(theme.dim);
  const stateFg = hexToAnsi(statusColor(run.status, theme));
  const glyphFg = stateFg;

  const glyph = runHeaderGlyph(run);
  const sid = shortId(run.id);
  const namePad = pad(run.name, NAME_COL);
  const state = run.status;
  const meta = runMeta(run, now);

  return `${glyphFg}${glyph}${RESET}  ${accent}${sid}${RESET}  ${text}${BOLD}${namePad}${RESET}  ${stateFg}${pad(state, 10)}${RESET}${muted}${meta}${RESET}${dim}${RESET}`;
}

function plainRunHeader(run: RunSnapshot, now: number): string {
  const glyph = runHeaderGlyph(run);
  const sid = shortId(run.id);
  const namePad = pad(run.name, NAME_COL);
  const state = pad(run.status, 10);
  const meta = runMeta(run, now);
  return `${glyph}  ${sid}  ${namePad}  ${state}${meta}`;
}

function runHeaderGlyph(run: RunSnapshot): string {
  if (run.endedAt === undefined) {
    return run.status === "running" ? "●" : "○";
  }
  if (run.status === "completed") return "✓";
  if (run.status === "failed") return "✗";
  if (run.status === "killed") return "⊘";
  return "○";
}

function runMeta(run: RunSnapshot, now: number): string {
  const parts: string[] = [];
  const mode = run.stages.length > 1 ? "chain" : "single";
  if (run.stages.length > 1) {
    const total = run.stages.length;
    const done = run.stages.filter((s) => s.status === "completed" || s.status === "failed").length;
    parts.push(`${mode} · ${done}/${total}`);
  } else {
    parts.push(mode);
  }
  if (run.endedAt !== undefined) {
    parts.push(`${fmtDuration(now - run.endedAt)} ago`);
  } else if (run.startedAt != null) {
    parts.push(fmtDuration(now - run.startedAt));
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Stage line
// ---------------------------------------------------------------------------

function themedStageLine(stage: StageSnapshot, now: number, theme: GraphTheme): string {
  const iconFg = hexToAnsi(statusColor(stage.status, theme));
  const text = hexToAnsi(theme.text);
  const muted = hexToAnsi(theme.textMuted);
  const dim = hexToAnsi(theme.dim);
  const stateFg = hexToAnsi(statusColor(stage.status, theme));

  const icon = statusIcon(stage.status);
  const namePad = pad(stage.name, STAGE_NAME_COL);
  const state = pad(stage.status, STAGE_STATUS_COL);
  const activity = stageActivity(stage) ?? "";
  const activityPad = pad(activity, STAGE_ACTIVITY_COL);
  const dur = stageDuration(stage, now) ?? "";

  return `${iconFg}${icon}${RESET} ${text}${namePad}${RESET}  ${stateFg}${state}${RESET}${muted}${activityPad}${RESET}${dim}${dur}${RESET}`;
}

function plainStageLine(stage: StageSnapshot, now: number): string {
  const icon = statusIcon(stage.status);
  const namePad = pad(stage.name, STAGE_NAME_COL);
  const state = pad(stage.status, STAGE_STATUS_COL);
  const activity = pad(stageActivity(stage) ?? "", STAGE_ACTIVITY_COL);
  const dur = stageDuration(stage, now) ?? "";
  return `${icon} ${namePad}  ${state}${activity}${dur}`;
}

function stageActivity(stage: StageSnapshot): string | undefined {
  if (stage.status !== "running") return undefined;
  const last = stage.toolEvents.at(-1);
  if (!last) return undefined;
  const reference = last.startedAt;
  if (reference !== undefined) {
    const ended = last.endedAt ?? Date.now();
    return `${last.name} · ${fmtDuration(ended - reference)}`;
  }
  return last.name;
}

function stageDuration(stage: StageSnapshot, now: number): string | undefined {
  if (stage.durationMs !== undefined) return fmtDuration(stage.durationMs);
  if (stage.startedAt !== undefined && stage.endedAt === undefined) {
    return fmtDuration(now - stage.startedAt);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Buckets + badges
// ---------------------------------------------------------------------------

interface Counts {
  active: number;
  completed: number;
  failed: number;
  pending: number;
}

function countBuckets(runs: readonly RunSnapshot[]): Counts {
  const c: Counts = { active: 0, completed: 0, failed: 0, pending: 0 };
  for (const r of runs) {
    if (r.endedAt === undefined) {
      if (r.status === "pending") c.pending++;
      else c.active++;
    } else if (r.status === "completed") c.completed++;
    else c.failed++;
  }
  return c;
}

function themedBadges(c: Counts, theme: GraphTheme): BandBadge[] {
  const out: BandBadge[] = [];
  if (c.completed > 0) out.push({ text: `✓ ${c.completed}`, fg: theme.success });
  if (c.active > 0) out.push({ text: `● ${c.active}`, fg: theme.warning });
  if (c.pending > 0) out.push({ text: `○ ${c.pending}`, fg: theme.dim });
  if (c.failed > 0) out.push({ text: `✗ ${c.failed}`, fg: theme.error });
  return out;
}

function plainBadges(c: Counts): string[] {
  const out: string[] = [];
  if (c.completed > 0) out.push(`✓ ${c.completed}`);
  if (c.active > 0) out.push(`● ${c.active}`);
  if (c.pending > 0) out.push(`○ ${c.pending}`);
  if (c.failed > 0) out.push(`✗ ${c.failed}`);
  return out;
}

function plainBand(subtitle: string, badges: string[]): string[] {
  const innerLabel = " BACKGROUND ";
  const inner = "─".repeat(innerLabel.length);
  const subSeg = `  ${subtitle}`;
  const badgeTail = badges.length > 0 ? `   ${badges.join("  ")}` : "";
  const blank = " ".repeat(subSeg.length + badgeTail.length);
  return [
    ` ╭${inner}╮${blank}`,
    ` │${innerLabel}│${subSeg}${badgeTail}`,
    ` ╰${inner}╯${blank}`,
  ];
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function sortRuns(runs: readonly RunSnapshot[]): RunSnapshot[] {
  const active = runs.filter((r) => r.endedAt === undefined);
  const ended = runs.filter((r) => r.endedAt !== undefined);
  const byStart = (a: RunSnapshot, b: RunSnapshot) => (b.startedAt ?? 0) - (a.startedAt ?? 0);
  return [...[...active].sort(byStart), ...[...ended].sort(byStart)];
}

function shortId(id: string): string {
  return id.length > SHORT_ID_LEN ? id.slice(0, SHORT_ID_LEN) : id;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}
