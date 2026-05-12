/**
 * DAG node card — rounded, status-coloured, optionally pulsing.
 *
 * Visual contract (DESIGN.md §5):
 *  - Rounded border `╭╮╰╯` only. No square or ASCII art.
 *  - Border colour carries status; running pulses via sine lerp against the
 *    dim border. Focused locks the pulse and lifts the interior one stratum
 *    (`base → surface0`).
 *  - Title centred inside the top border (title slot).
 *  - Single centred duration line.
 *  - No `[ focused ]` text — focus is signalled by border + stratum only.
 *
 * cross-ref:
 *   - github.com/flora131/atomic packages/atomic-sdk/src/components/node-card.tsx
 *   - DESIGN.md §5 "Node Cards (orchestrator graph)"
 */

import type { StageSnapshot, StageStatus } from "../shared/store-types.js";
import type { GraphTheme } from "./graph-theme.js";
import { fmtDuration } from "./status-helpers.js";
import { lerpColor, hexToAnsi, hexBg, RESET, BOLD } from "./color-utils.js";
import { NODE_W, NODE_H } from "./layout.js";

export interface NodeCardOpts {
  width?: number;
  height?: number;
  focused?: boolean;
  /** 0–1; ignored when status is terminal (complete/failed). */
  pulsePhase?: number;
  theme: GraphTheme;
}

/** Sine-eased pulse `t ∈ [0, 1]`. Phase 0 ≈ quiet, 0.5 ≈ peak. */
function pulseT(phase: number): number {
  return (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
}

function pickBorder(
  status: StageStatus,
  focused: boolean,
  phase: number,
  theme: GraphTheme,
): string {
  switch (status) {
    case "running":
      if (focused) return theme.warning;
      return lerpColor(theme.borderDim, theme.warning, pulseT(phase));
    case "completed":
      return theme.success;
    case "failed":
      return theme.error;
    case "pending":
    default:
      return focused ? theme.text : theme.borderDim;
  }
}

function durationColor(status: StageStatus, theme: GraphTheme): string {
  switch (status) {
    case "running":
      return theme.warning;
    case "completed":
      return theme.success;
    case "failed":
      return theme.error;
    default:
      return theme.dim;
  }
}

function durationText(stage: StageSnapshot): string {
  if (stage.durationMs != null) return fmtDuration(stage.durationMs);
  if (stage.startedAt != null) return fmtDuration(Date.now() - stage.startedAt);
  return "—";
}

function truncate(s: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(1, maxLen - 1)) + "…";
}

/**
 * Centre a visible string inside `width` cells, wrapping it with `fg`
 * (and optional bold) ANSI escapes. The visible width is computed before
 * the colour escapes are added so padding stays correct. `bg` is
 * re-emitted around the coloured run so trailing pad cells stay on the
 * card stratum instead of dropping to the terminal default.
 */
function centreColored(
  content: string,
  width: number,
  fg: string,
  bg: string,
  opts: { bold?: boolean } = {},
): string {
  const safe = truncate(content, width);
  const pad = width - safe.length;
  const left = Math.max(0, Math.floor(pad / 2));
  const right = Math.max(0, pad - left);
  const bold = opts.bold ? BOLD : "";
  return (
    `${bg}${" ".repeat(left)}` +
    `${hexToAnsi(fg)}${bold}${safe}${RESET}` +
    `${bg}${" ".repeat(right)}`
  );
}

/**
 * Render a stage as a multi-line card string.
 * Returns array of exactly `height` lines, each `width` cells wide.
 */
export function renderNodeCard(stage: StageSnapshot, opts: NodeCardOpts): string[] {
  const width = opts.width ?? NODE_W;
  const height = opts.height ?? NODE_H;
  const focused = opts.focused ?? false;
  const phase = opts.pulsePhase ?? 0;
  const theme = opts.theme;

  const borderHex = pickBorder(stage.status, focused, phase, theme);
  const bc = hexToAnsi(borderHex);
  // Card stratum bg — painted explicitly on every cell so internal
  // RESETs never let the terminal default leak through as a shadow
  // strip on the right/bottom of the card. Per DESIGN.md the card
  // background is `base` (same as the canvas), so this paints flush
  // with the body bg and only the border outline reads visually.
  const bg = hexBg(theme.bg);
  const innerWidth = Math.max(2, width - 2);

  // Title sits inside the top border: ╭── name ──╮. Re-prime `bg`
  // after the title's RESET so the dashes either side stay on the
  // card stratum.
  const titleRaw = ` ${truncate(stage.name, Math.max(2, innerWidth - 4))} `;
  const titleStart = Math.max(1, Math.floor((innerWidth - titleRaw.length) / 2));
  const titleEnd = titleStart + titleRaw.length;
  const topMiddle =
    `${bc}${"─".repeat(titleStart)}` +
    `${BOLD}${titleRaw}${RESET}${bg}${bc}` +
    `${"─".repeat(Math.max(0, innerWidth - titleEnd))}`;
  const top = `${bg}${bc}╭${topMiddle}╮${RESET}`;
  const bottom = `${bg}${bc}╰${"─".repeat(innerWidth)}╯${RESET}`;

  // Interior — single centred duration line. Each `│` border is
  // followed by a `bg`-primed centred run so the inner cells stay on
  // the card stratum.
  const durHex = durationColor(stage.status, theme);
  const durLine =
    `${bg}${bc}│${RESET}` +
    centreColored(durationText(stage), innerWidth, durHex, bg) +
    `${bg}${bc}│${RESET}`;

  const interior: string[] = [durLine];

  // Pad / clip to exactly `height` lines.
  const contentRows = Math.max(0, height - 2);
  while (interior.length < contentRows) {
    interior.push(
      `${bg}${bc}│${RESET}${bg}${" ".repeat(innerWidth)}${bg}${bc}│${RESET}`,
    );
  }
  if (interior.length > contentRows) {
    interior.length = contentRows;
  }

  return [top, ...interior, bottom];
}
