/**
 * `/workflow status` list — chat-surface vocabulary from ui/mockups.html.
 *
 * Visual contract (ui/mockups.html §2 · DESIGN.md §5):
 *  - One full-width `[ BACKGROUND ]` flat band with subtitle and badges.
 *  - One **card** per run (replaces the indented per-stage rows):
 *      row 1: ▎ stripe · [tag runId] · bold workflow · ● state badge
 *      row 2: ▎ stripe · mode · progress strip · meta
 *  - Status colour is carried by the stripe, the tag, and the trailing
 *    badge — never by body text.
 *  - One trailing hint row pointing at `/workflow status <id>` for the
 *    most-recently-active run; full per-stage detail moves into
 *    `/workflow status <id>` ({@link renderRunDetail}).
 *
 * Plain mode (theme omitted) preserves the shape: `▎ [ BACKGROUND ]`
 * band, `│  [tag] title` cards, ASCII bracket cells `[✓][●][○][✗]`.
 *
 * Powers:
 *   - `renderResult({ action: "status" })` (LLM tool path)
 *   - `/workflow session list` chat output (via renderSessionList)
 *   - `/workflow status` chat output
 *
 * cross-ref:
 *  - ui/mockups.html §2 (run list), §4 (truncation)
 *  - src/tui/chat-surface.ts shared primitives
 *  - src/tui/run-detail.ts per-run drill-down surface (unchanged)
 */

import type { RunSnapshot, StageSnapshot, StageStatus } from "../shared/store-types.js";
import type { GraphTheme } from "./graph-theme.js";
import { fmtDuration } from "./status-helpers.js";
import {
  renderFlatBand,
  renderTaggedCard,
  renderHintRows,
  progressStrip,
  ELLIPSIS,
  chatWidth,
} from "./chat-surface.js";
import type { FlatBandBadge } from "./chat-surface.js";
import { hexToAnsi, RESET } from "./color-utils.js";
import { visibleWidth, truncateToWidth } from "./text-helpers.js";

const SHORT_ID_LEN = 6;
const MIN_TITLE_BUDGET = 12;
const STAGE_LABEL_BUDGET = 24;

export interface RenderStatusListOpts {
  /** Provide for ANSI Catppuccin; omit for plain text. */
  theme?: GraphTheme;
  /** Clock override (tests). */
  now?: number;
  /** When true, show a trailing hint pointing at the detail action. */
  showDetailHint?: boolean;
  /** Render width (cells). Defaults to `process.stdout.columns`. */
  width?: number;
}

/**
 * Render a list of run snapshots as the canonical `[ BACKGROUND ]` chat
 * surface: one band plus one card per run.
 */
export function renderStatusList(
  runs: readonly RunSnapshot[],
  opts: RenderStatusListOpts = {},
): string {
  const now = opts.now ?? Date.now();
  const width = opts.width;

  // The list shows active + recently-ended runs together. Sorting:
  // active first, then ended, each bucket by startedAt desc.
  const sorted = sortRuns(runs);

  // Header counts span the whole snapshot, not just the display window.
  const counts = countBuckets(runs);
  const subtitle = `${sorted.length} run${sorted.length === 1 ? "" : "s"}`;
  const badges: FlatBandBadge[] | undefined = opts.theme
    ? themedBadges(counts, opts.theme)
    : plainBadges(counts);

  const lines: string[] = [];
  lines.push(renderFlatBand({
    label: "BACKGROUND",
    subtitle,
    badges,
    theme: opts.theme,
    width,
  }));
  // Blank line after the band — same header-vs-content separation used by
  // /workflow list. Without it the band visually fuses into the first card.
  lines.push("");

  if (sorted.length === 0) {
    lines.push(emptyStateLine(opts.theme));
    return lines.join("\n");
  }

  // Blank line between run cards mirrors the mockup's per-card top/bottom
  // margin (ui/mockups.html §2). Without it five runs collapse into one
  // visual block.
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) lines.push("");
    lines.push(renderRunCard(sorted[i]!, now, width, opts.theme));
  }

  if (opts.showDetailHint !== false && sorted.length > 0) {
    const sid = shortId(sorted[0]!.id);
    lines.push("");
    lines.push(
      renderHintRows(
        [{ command: `/workflow status ${sid}`, hint: "drill into a run" }],
        opts.theme,
      ),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Run card
// ---------------------------------------------------------------------------

function renderRunCard(
  run: RunSnapshot,
  now: number,
  width: number | undefined,
  theme?: GraphTheme,
): string {
  const sid = shortId(run.id);
  const stateAccent = runAccent(run, theme);
  const trailing = runTrailing(run, theme);

  const mode = run.stages.length > 1 ? "chain " : "single";
  // Row 2 budget: the card body row sits past the stripe (3 cells) and
  // shares its width with a mode label, the progress strip, and a meta
  // tail. Reserve ~3 cells for the meta separator and ellipsis padding.
  const cardWidth = effectiveWidth(width);
  const stripPrefixW = 4; // leading chat pad + "▎  "
  const modeW = mode.length + 4; // 4-space separator after mode
  const interior = cardWidth - stripPrefixW;
  const rawMeta = runCardMeta(run, now);
  // Row 2 is caller-rendered body content; clamp the metadata tail before it
  // reaches renderTaggedCard so long/wide stage names cannot overflow.
  const maxMetaW = Math.max(0, interior - modeW - 3);
  const meta = truncateToWidth(rawMeta, maxMetaW, ELLIPSIS);
  const metaW = visibleWidth(meta);
  const stripBudget = Math.max(0, cardWidth - stripPrefixW - modeW - metaW - 4);

  const cells = stageCells(run);
  const strip = progressStrip(cells, stripBudget, theme);
  const stripVisibleW = visibleWidth(strip);

  const usedLeftW = modeW + stripVisibleW;
  const gap = Math.max(metaW > 0 ? 1 : 0, interior - usedLeftW - metaW);

  const muted = theme ? hexToAnsi(theme.textMuted) : "";
  const dim = theme ? hexToAnsi(theme.dim) : "";
  const reset = theme ? RESET : "";

  const modeSeg = theme ? `${muted}${mode}${reset}` : mode;
  const metaSeg = theme ? `${dim}${meta}${reset}` : meta;
  const row2 = `${modeSeg}    ${strip}${" ".repeat(gap)}${metaSeg}`;

  return renderTaggedCard({
    tag: sid,
    title: run.name,
    trailing,
    bodyRows: [row2],
    accent: stateAccent,
    width,
    theme,
  });
}

function runAccent(run: RunSnapshot, theme?: GraphTheme): string {
  if (!theme) return "#000000";
  switch (run.status) {
    case "completed": return theme.success;
    case "running":   return theme.warning;
    case "failed":    return theme.error;
    case "killed":    return theme.error;
    case "pending":
    default:          return theme.dim;
  }
}

function runTrailing(run: RunSnapshot, theme?: GraphTheme): { text: string; fg?: string } | undefined {
  switch (run.status) {
    case "completed": return { text: "✓ completed", fg: theme?.success };
    case "running":   return { text: "● running", fg: theme?.warning };
    case "failed":    return { text: "✗ failed", fg: theme?.error };
    case "killed":    return { text: "⊘ killed", fg: theme?.error };
    case "pending":
    default:          return { text: "○ pending", fg: theme?.dim };
  }
}

function runCardMeta(run: RunSnapshot, now: number): string {
  // Builds the right-aligned meta tail.
  //   running  → `3/8 · review-a · 1m42s`
  //   failed   → `failed at partition · 4m24s ago`
  //   killed   → `<stage> · <duration> · <when>` (mirrors mockup §2)
  //   completed→ `<stage> · <duration> · <when>`
  const parts: string[] = [];
  const isChain = run.stages.length > 1;
  const total = run.stages.length;
  const done = run.stages.filter(
    (s) => s.status === "completed" || s.status === "failed",
  ).length;
  const ago = run.endedAt !== undefined
    ? `${fmtDuration(now - run.endedAt)} ago`
    : run.startedAt != null
      ? fmtDuration(now - run.startedAt)
      : undefined;

  if (run.status === "running") {
    if (isChain) parts.push(`${done}/${total}`);
    const labels = runningStageLabels(run);
    if (labels) parts.push(labels);
    if (ago) parts.push(ago);
    return parts.join(" · ");
  }

  if (run.status === "failed" || run.status === "killed") {
    const failed = run.stages.find((s) => s.status === "failed");
    if (failed && isChain) parts.push(`failed at ${failed.name}`);
    else if (failed) parts.push(failed.name);
    else if (!isChain && run.stages[0]) parts.push(run.stages[0].name);
    const dur = lastStageDuration(run, now);
    if (dur && parts.length < 2) parts.push(dur);
    if (ago) parts.push(ago);
    return parts.join(" · ");
  }

  if (run.status === "completed") {
    if (!isChain && run.stages[0]) parts.push(run.stages[0].name);
    const dur = lastStageDuration(run, now);
    if (dur) parts.push(dur);
    if (ago) parts.push(ago);
    return parts.join(" · ");
  }

  // pending
  if (ago) parts.push(ago);
  return parts.join(" · ");
}

function runningStageLabels(run: RunSnapshot): string | undefined {
  const running = run.stages.filter((s) => s.status === "running").map((s) => s.name);
  if (running.length === 0) return undefined;
  const joined = running.join(", ");
  return truncateToWidth(joined, STAGE_LABEL_BUDGET, ELLIPSIS);
}

function lastStageDuration(run: RunSnapshot, now: number): string | undefined {
  // Pick a representative stage duration: the most-recent terminal stage,
  // or the running stage if everything's still in flight.
  const candidate =
    [...run.stages].reverse().find((s) => s.status === "completed" || s.status === "failed") ??
    run.stages.find((s) => s.status === "running");
  if (!candidate) return undefined;
  return stageDurationString(candidate, now);
}

function stageDurationString(stage: StageSnapshot, now: number): string | undefined {
  if (stage.durationMs !== undefined) return fmtDuration(stage.durationMs);
  if (stage.startedAt !== undefined && stage.endedAt === undefined) {
    return fmtDuration(now - stage.startedAt);
  }
  return undefined;
}

function stageCells(run: RunSnapshot): Array<{ status: StageStatus }> {
  // Single-stage runs render a single cell mirroring run status. Chain
  // runs render one cell per stage.
  if (run.stages.length === 0) {
    return [{ status: stageStatusFromRun(run) }];
  }
  return run.stages.map((s) => ({ status: s.status }));
}

function stageStatusFromRun(run: RunSnapshot): StageStatus {
  switch (run.status) {
    case "completed": return "completed";
    case "running":   return "running";
    case "failed":    return "failed";
    case "killed":    return "failed";
    case "pending":
    default:          return "pending";
  }
}

/**
 * Resolve the render width for the status surface. Delegates to the
 * shared `chatWidth()` helper which already accounts for the chat host's
 * 2-cell horizontal padding when no explicit width is supplied.
 */
function effectiveWidth(width?: number): number {
  return chatWidth(width);
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

function themedBadges(c: Counts, theme: GraphTheme): FlatBandBadge[] {
  const out: FlatBandBadge[] = [];
  if (c.completed > 0) out.push({ text: `✓ ${c.completed}`, fg: theme.success });
  if (c.active > 0) out.push({ text: `● ${c.active}`, fg: theme.warning });
  if (c.pending > 0) out.push({ text: `○ ${c.pending}`, fg: theme.dim });
  if (c.failed > 0) out.push({ text: `⊘ ${c.failed}`, fg: theme.error });
  return out;
}

function plainBadges(c: Counts): FlatBandBadge[] {
  const out: FlatBandBadge[] = [];
  if (c.completed > 0) out.push({ text: `✓ ${c.completed}` });
  if (c.active > 0) out.push({ text: `● ${c.active}` });
  if (c.pending > 0) out.push({ text: `○ ${c.pending}` });
  if (c.failed > 0) out.push({ text: `⊘ ${c.failed}` });
  return out;
}

// ---------------------------------------------------------------------------
// Sorting + helpers
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

function emptyStateLine(theme?: GraphTheme): string {
  if (!theme) return "  no in-flight runs";
  return `  ${hexToAnsi(theme.dim)}no in-flight runs${RESET}`;
}

// Re-export for callers that need to inspect width budgeting.
export { MIN_TITLE_BUDGET };
