/**
 * `/workflows-doctor` chat surface — visual sibling of pi-subagents'
 * `/subagents-doctor` and this repo's `/workflow status` / `/workflow list`
 * cards (ui/mockups.html · DESIGN.md §5).
 *
 * Visual contract:
 *  - One band per `DoctorSection`:
 *      ▎ [ LABEL ] subtitle …                       [ok N] [warn N] [fail N]
 *  - Indented body rows, one per `DoctorRow`:
 *      ▎  status-glyph  label              value     (hint)
 *  - One trailing hint block when companions are missing:
 *      ▸ pi install npm:pi-subagents   enable pi-subagents — delegate stages …
 *
 * Status colour is carried by the glyph (✓ / ⚠ / ✗) — body text stays in
 * the theme's `text` colour so labels remain scannable, and the hint
 * suffix stays in `dim`. Plain mode (theme omitted) preserves the shape
 * with ASCII glyphs and `│` stripes.
 *
 * cross-ref:
 *  - src/extension/doctor.ts (payload builder)
 *  - src/tui/chat-surface.ts (primitives — renderFlatBand, renderHintRows)
 */

import type {
  DoctorPayload,
  DoctorRow,
  DoctorSection,
  DoctorStatus,
} from "../extension/doctor.js";
import type { GraphTheme } from "./graph-theme.js";
import {
  renderFlatBand,
  renderHintRows,
  chatWidth,
  ELLIPSIS,
  type FlatBandBadge,
} from "./chat-surface.js";
import { hexToAnsi, RESET, BOLD } from "./color-utils.js";
import { visibleWidth, truncateToWidth } from "./text-helpers.js";

const STRIPE_CHAR_THEMED = "▎";
const STRIPE_CHAR_PLAIN = "│";

export interface RenderDoctorCardOpts {
  /** Provide for themed Catppuccin chrome; omit for plain ASCII. */
  readonly theme?: GraphTheme;
  /** Render width (cells). Defaults to chat-surface width inference. */
  readonly width?: number;
}

/**
 * Render the full doctor card: one `[ DOCTOR ]` band, one band per
 * section with indented status rows, and a trailing block of
 * `pi install …` hints when any companion is missing.
 */
export function renderDoctorCard(payload: DoctorPayload, opts: RenderDoctorCardOpts = {}): string {
  const width = chatWidth(opts.width);
  const theme = opts.theme;
  const lines: string[] = [];

  // Header band: [ DOCTOR ] subtitle  · counts as right-aligned badges.
  lines.push(
    renderFlatBand({
      label: "DOCTOR",
      subtitle: payload.subtitle,
      badges: headerBadges(payload.counts, theme),
      theme,
      width,
    }),
  );
  lines.push("");

  // One band + indented rows per section. Blank line between sections
  // mirrors the per-card spacing in /workflow status (ui/mockups.html §2).
  for (let i = 0; i < payload.sections.length; i++) {
    if (i > 0) lines.push("");
    lines.push(renderSection(payload.sections[i]!, theme, width));
  }

  // Trailing install hints. Same hint-row grammar as `/workflow status`
  // (`▸ /workflow status <id>   drill into a run`).
  if (payload.hints.length > 0) {
    lines.push("");
    lines.push(
      renderHintRows(
        payload.hints.map((h) => ({ command: h.command, hint: h.description })),
        theme,
      ),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Header badges
// ---------------------------------------------------------------------------

function headerBadges(
  counts: { ok: number; warn: number; fail: number },
  theme: GraphTheme | undefined,
): FlatBandBadge[] {
  const badges: FlatBandBadge[] = [];
  if (theme) {
    if (counts.ok > 0)   badges.push({ text: `✓ ${counts.ok}`,   fg: theme.success });
    if (counts.warn > 0) badges.push({ text: `⚠ ${counts.warn}`, fg: theme.warning });
    if (counts.fail > 0) badges.push({ text: `✗ ${counts.fail}`, fg: theme.error });
    return badges;
  }
  // Plain mode degrades the glyphs but keeps the same shape.
  if (counts.ok > 0)   badges.push({ text: `[ok ${counts.ok}]` });
  if (counts.warn > 0) badges.push({ text: `[warn ${counts.warn}]` });
  if (counts.fail > 0) badges.push({ text: `[fail ${counts.fail}]` });
  return badges;
}

// ---------------------------------------------------------------------------
// Per-section rendering
// ---------------------------------------------------------------------------

function renderSection(section: DoctorSection, theme: GraphTheme | undefined, width: number): string {
  const lines: string[] = [];
  lines.push(
    renderFlatBand({
      label: section.label,
      subtitle: section.subtitle ?? "",
      // Per-section accent stays muted — the top-level header carries
      // the ok/warn/fail tally; section bands are organisational chrome.
      accent: theme?.textMuted,
      theme,
      width,
    }),
  );
  // Compute the label column width once per section so all rows align
  // their `value` column. Without this, a single long label (e.g.
  // "persistence appendEntry") pushes its own value column over and
  // breaks the otherwise-aligned grid above and below it.
  const labelW = sectionLabelColumn(section);
  for (const row of section.rows) {
    lines.push(renderRow(row, theme, width, labelW));
  }
  return lines.join("\n");
}

function renderRow(
  row: DoctorRow,
  theme: GraphTheme | undefined,
  width: number,
  labelW: number,
): string {
  if (!theme) return renderRowPlain(row, width, labelW);
  return renderRowThemed(row, theme, width, labelW);
}

function renderRowThemed(row: DoctorRow, theme: GraphTheme, width: number, labelW: number): string {
  const accent = hexToAnsi(statusColour(row.status, theme));
  const text = hexToAnsi(theme.text);
  const dim = hexToAnsi(theme.dim);

  const stripe = `${accent}${STRIPE_CHAR_THEMED}${RESET}`;
  const glyph = `${accent}${statusGlyph(row.status)}${RESET}`;

  // Label column is sized once per section (see renderSection). All
  // rows in the same section share `labelW` so their value columns line
  // up exactly under each other.
  const labelText = truncateToWidth(row.label, labelW, ELLIPSIS);
  const labelPad = " ".repeat(Math.max(0, labelW - visibleWidth(labelText)));
  const labelSeg = `${text}${BOLD}${labelText}${RESET}${labelPad}`;

  // Hint is the right-most dim suffix; budget the value to whatever
  // fits on the row after the chrome + label + hint.
  const hintRaw = row.hint ? ` (${row.hint})` : "";
  const chromeW = 1 /* leading space */ + 1 /* stripe */ + 1 /* space */ + 1 /* glyph */ + 1 /* space */ + labelW + 2 /* gap */;
  const valueBudget = Math.max(8, width - chromeW - visibleWidth(hintRaw) - 1);
  const valueText = truncateToWidth(row.value, valueBudget, ELLIPSIS);
  const valueSeg = `${text}${valueText}${RESET}`;
  const hintSeg = hintRaw ? `${dim}${hintRaw}${RESET}` : "";

  return ` ${stripe} ${glyph} ${labelSeg}  ${valueSeg}${hintSeg}`;
}

function renderRowPlain(row: DoctorRow, width: number, labelW: number): string {
  const stripe = STRIPE_CHAR_PLAIN;
  const glyph = statusGlyph(row.status);
  const labelText = truncateToWidth(row.label, labelW, ELLIPSIS);
  const labelPad = " ".repeat(Math.max(0, labelW - visibleWidth(labelText)));
  const hintRaw = row.hint ? ` (${row.hint})` : "";
  const chromeW = 1 + 1 + 1 + 1 + 1 + labelW + 2;
  const valueBudget = Math.max(8, width - chromeW - visibleWidth(hintRaw) - 1);
  const valueText = truncateToWidth(row.value, valueBudget, ELLIPSIS);
  return ` ${stripe} ${glyph} ${labelText}${labelPad}  ${valueText}${hintRaw}`;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusGlyph(status: DoctorStatus): string {
  switch (status) {
    case "ok":   return "✓";
    case "warn": return "⚠";
    case "fail": return "✗";
    case "info": return "·";
    case "dim":  return " ";
  }
}

function statusColour(status: DoctorStatus, theme: GraphTheme): string {
  switch (status) {
    case "ok":   return theme.success;
    case "warn": return theme.warning;
    case "fail": return theme.error;
    case "info": return theme.accent;
    case "dim":  return theme.dim;
  }
}

/**
 * Pick a stable label-column width for one section. We size to the
 * widest label in the section so values line up, with a soft floor of
 * 20 cells (keeps short-label sections from looking cramped) and a
 * hard cap of 28 cells (keeps the value column from being squeezed on
 * narrow terminals).
 *
 * Computed once per section so a single outlier label (e.g.
 * "persistence appendEntry") doesn't break alignment for its siblings.
 */
function sectionLabelColumn(section: DoctorSection): number {
  let max = 20;
  for (const row of section.rows) {
    max = Math.max(max, visibleWidth(row.label) + 2);
  }
  return Math.min(28, max);
}
