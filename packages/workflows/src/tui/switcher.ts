/**
 * Stage switcher — "/" popup that lists stages for direct keyboard jump.
 *
 * Visual contract (DESIGN.md §5 Picker Rows):
 *  - Rounded box, `borderActive` border, `backgroundPanel` interior.
 *  - Header row: leading "stages" caption (dim) + right-aligned key·label
 *    hint (`↑↓ select · ↵ attach · esc close`) in dim.
 *  - Default row: `paddingLeft: 1`, `paddingRight: 2`, icon + name, status
 *    glyph coloured.
 *  - Selected row: accent pill (blue bg + surface0 fg + bold). Focus is
 *    expressed by the filled row, not a leading caret glyph.
 *  - Empty state: `(no matches)` in dim.
 */
import type { StageSnapshot } from "../shared/store-types.js";
import type { GraphTheme } from "./graph-theme.js";
import { statusIcon, statusColor } from "./status-helpers.js";
import { hexToAnsi, hexBg, RESET, BOLD } from "./color-utils.js";
import { sliceColumns, truncateToWidth, visibleWidth } from "./text-helpers.js";

export interface SwitcherState {
  query: string;
  selectedIndex: number;
}

export interface SwitcherOpts {
  width: number;
  theme: GraphTheme;
}

export function filterStages(
  stages: readonly StageSnapshot[],
  query: string,
): StageSnapshot[] {
  if (!query) return [...stages];
  const q = query.toLowerCase();
  return stages.filter((s) => s.name.toLowerCase().includes(q));
}

const HINT = "↑↓ select · ↵ attach · esc close";
const COMPACT_HINT = "↵ attach · esc close";

/** Pad a visible string (ANSI-safe) to exactly `width` cells. */
function padVisible(s: string, width: number): string {
  const clipped = visibleWidth(s) > width ? truncateToWidth(s, width, "…", true) : s;
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * Truncate without appending any ANSI reset before the suffix.
 *
 * Selected rows are wrapped in a single accent run after row text is composed;
 * inserting RESET before the ellipsis would prematurely end that highlight.
 */
function truncateToWidthWithoutReset(text: string, width: number, suffix = ""): string {
  const targetWidth = Math.max(0, width);
  if (visibleWidth(text) <= targetWidth) return text;
  if (targetWidth === 0) return "";

  const suffixWidth = visibleWidth(suffix);
  if (suffixWidth >= targetWidth) {
    return sliceColumns(suffix, 0, targetWidth, true);
  }

  return `${sliceColumns(text, 0, targetWidth - suffixWidth, true)}${suffix}`;
}

function statusText(status: StageSnapshot["status"]): string {
  return status === "awaiting_input"
    ? "awaiting"
    : status === "completed"
      ? "complete"
      : status.replace(/_/g, " ");
}

export function renderSwitcher(
  stages: readonly StageSnapshot[],
  state: SwitcherState,
  opts: SwitcherOpts,
): string[] {
  const { width, theme } = opts;
  const filtered = filterStages(stages, state.query);
  const innerWidth = Math.max(4, width - 2);

  const border = hexToAnsi(theme.borderActive);
  const panelBg = hexBg(theme.backgroundPanel);
  const dim = hexToAnsi(theme.dim);
  const muted = hexToAnsi(theme.textMuted);
  const text = hexToAnsi(theme.text);
  const accent = hexBg(theme.accent);
  const accentFg = hexToAnsi(theme.backgroundElement);

  const lines: string[] = [];

  // Top border
  lines.push(`${border}╭${"─".repeat(innerWidth)}╮${RESET}`);

  // Header row: "  STAGES  query   …   ↑↓ select · ↵ attach · esc close "
  const leftLabelText = "  STAGES";
  const hint = innerWidth >= 44 ? HINT : COMPACT_HINT;
  const queryBudget = Math.max(
    0,
    innerWidth - visibleWidth(leftLabelText) - visibleWidth(hint) - 3,
  );
  const queryDisplay = state.query
    ? ` ${truncateToWidth(state.query, queryBudget, "…")}`
    : "";
  const leftSegmentWidth = visibleWidth(`${leftLabelText}${queryDisplay}`);
  const gap = Math.max(1, innerWidth - leftSegmentWidth - visibleWidth(hint) - 1);
  const header =
    `${panelBg}${muted}${BOLD}${leftLabelText}${RESET}${panelBg}` +
    (queryDisplay ? `${text}${queryDisplay}${RESET}${panelBg}` : "") +
    " ".repeat(gap) +
    `${dim}${hint}${RESET}${panelBg}`;
  lines.push(`${border}│${RESET}${padVisible(header, innerWidth)}${border}│${RESET}`);

  // Quiet rule under header
  lines.push(`${border}├${"─".repeat(innerWidth)}┤${RESET}`);

  // Stage list — viewport of 8 around selection
  const maxVisible = 8;
  const start = Math.max(0, state.selectedIndex - Math.floor(maxVisible / 2));
  const visible = filtered.slice(start, start + maxVisible);

  if (visible.length === 0) {
    const empty = `${panelBg}${dim}  (no matches)${RESET}${panelBg}`;
    lines.push(`${border}│${RESET}${panelBg}${padVisible(empty, innerWidth)}${border}│${RESET}`);
  }

  for (let i = 0; i < visible.length; i++) {
    const stage = visible[i]!;
    const idx = start + i;
    const isSelected = idx === state.selectedIndex;
    const icon = statusIcon(stage.status);
    const label = statusText(stage.status);
    const rowTextBudget = Math.max(8, innerWidth - 14);
    const name = truncateToWidth(stage.name, rowTextBudget, "…");

    if (isSelected) {
      const metaWidth = visibleWidth(label);
      const nameBudget = Math.max(4, innerWidth - visibleWidth(`  ${icon} `) - metaWidth - 2);
      const selectedName = truncateToWidthWithoutReset(stage.name, nameBudget, "…");
      const prefix = `  ${icon} ${selectedName}`;
      const visibleRow = `${prefix}${" ".repeat(Math.max(1, innerWidth - visibleWidth(`${prefix}${label}`) - 1))}${label} `;
      const padded = padVisible(visibleRow, innerWidth);
      const styled = `${accent}${accentFg}${BOLD}${padded}${RESET}`;
      lines.push(`${border}│${RESET}${styled}${border}│${RESET}`);
    } else {
      const iconColor = hexToAnsi(statusColor(stage.status, theme));
      const status = `${dim}${label}${RESET}${panelBg}`;
      const visibleRow = `  ${icon} ${name}`;
      const gap = Math.max(
        1,
        innerWidth - visibleWidth(visibleRow) - visibleWidth(label) - 1,
      );
      // Compose styled row that pads to innerWidth using visible length.
      const styled =
        `${panelBg}  ${iconColor}${icon}${RESET}${panelBg} ${muted}${name}${RESET}${panelBg}` +
        " ".repeat(gap) +
        status;
      const padded = padVisible(styled, innerWidth);
      lines.push(`${border}│${RESET}${padded}${border}│${RESET}`);
    }
  }

  // Bottom border
  lines.push(`${border}╰${"─".repeat(innerWidth)}╯${RESET}`);

  return lines;
}
