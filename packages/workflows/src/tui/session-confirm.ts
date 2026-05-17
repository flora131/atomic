/**
 * Workflow kill-confirmation overlay — clack-style confirmation dialog with
 * two side-by-side buttons (Cancel default, Kill destructive). Mounted via
 * pi.ui.custom() the same way as the picker.
 *
 * Visual contract:
 *  - Rounded `╭─ Title ─╮` chrome in `border` colour, title in `error`
 *    (destructive action signal, per DESIGN.md "Status-Is-Truth").
 *  - Warning glyph + run name + runId in body.
 *  - Two buttons: focused button uses `picker-row-selected` (accent bg + bold);
 *    the destructive button uses `error` bg when focused.
 *  - Footer: `y kill · n cancel · ↵ confirm focused · esc` in dim.
 *
 * Pure render. Keyboard handling lives in `handleKillConfirmInput`.
 *
 * cross-ref:
 *  - src/tui/session-picker.ts (chrome conventions)
 *  - DESIGN.md §5 Components — destructive button
 */

import type { RunSnapshot } from "../shared/store-types.js";
import type { GraphTheme } from "./graph-theme.js";
import { fmtDuration } from "./status-helpers.js";
import { hexToAnsi, hexBg, RESET, BOLD } from "./color-utils.js";
import { visibleWidth } from "./text-helpers.js";

export interface KillConfirmState {
  /** 0 = Cancel (focused by default), 1 = Kill. */
  focusedButton: 0 | 1;
}

export function createKillConfirmState(): KillConfirmState {
  return { focusedButton: 0 };
}

export interface KillConfirmRenderOpts {
  width: number;
  theme: GraphTheme;
  run: RunSnapshot;
  state: KillConfirmState;
  now?: number;
}

const TITLE = "Kill workflow run?";

function padTo(s: string, width: number): string {
  const vis = visibleWidth(s);
  if (vis >= width) return s;
  return s + " ".repeat(width - vis);
}

function renderHeader(width: number, theme: GraphTheme): string {
  const inner = Math.max(4, width - 2);
  const border = hexToAnsi(theme.border);
  const error = hexToAnsi(theme.error);
  const padded = ` ${TITLE} `;
  const padLen = Math.max(0, inner - visibleWidth(padded));
  const left = Math.min(2, padLen);
  const right = padLen - left;
  return `${border}╭${"─".repeat(left)}${RESET}${error}${BOLD}${padded}${RESET}${border}${"─".repeat(right)}╮${RESET}`;
}

function renderFooter(width: number, theme: GraphTheme): string {
  const inner = Math.max(4, width - 2);
  const border = hexToAnsi(theme.border);
  const dim = hexToAnsi(theme.dim);
  const text = hexToAnsi(theme.text);
  const muted = hexToAnsi(theme.textMuted);
  const sep = `${dim} \u00b7 ${RESET}`;
  const hints: Array<[string, string]> = [
    ["y", "Kill"],
    ["n", "Cancel"],
    ["\u21b5", "Confirm"],
    ["esc", "Cancel"],
  ];
  const parts = hints.map(([k, l]) => `${text}${k}${RESET} ${muted}${l}${RESET}`);
  const line = parts.join(sep);
  const leftRule = "\u2500\u2500 ";
  const padLen = Math.max(1, inner - leftRule.length - visibleWidth(line) - 1);
  const innerContent = `${border}${leftRule}${RESET}${line}${border}${" ".repeat(padLen)}${RESET}`;
  return `${border}\u2570${RESET}${padTo(innerContent, inner)}${border}\u256f${RESET}`;
}

function renderBlankRow(inner: number, theme: GraphTheme): string {
  const border = hexToAnsi(theme.border);
  const panelBg = hexBg(theme.bg);
  return `${border}│${RESET}${panelBg}${" ".repeat(inner)}${RESET}${border}│${RESET}`;
}

function renderTextRow(
  inner: number,
  theme: GraphTheme,
  content: string,
): string {
  const border = hexToAnsi(theme.border);
  const panelBg = hexBg(theme.bg);
  return `${border}│${RESET}${panelBg}${padTo(content, inner)}${RESET}${border}│${RESET}`;
}

function renderButton(label: string, focused: boolean, destructive: boolean, theme: GraphTheme): string {
  const inner = ` ${label} `;
  if (focused) {
    const bg = destructive ? hexBg(theme.error) : hexBg(theme.accent);
    const fg = hexToAnsi(theme.backgroundElement);
    return `${bg}${fg}${BOLD}${inner}${RESET}`;
  }
  const fg = destructive ? hexToAnsi(theme.error) : hexToAnsi(theme.textMuted);
  const bg = hexBg(theme.surface);
  return `${bg}${fg}${inner}${RESET}`;
}

export function renderKillConfirm(opts: KillConfirmRenderOpts): string[] {
  const { width, theme, run, state } = opts;
  const now = opts.now ?? Date.now();
  const inner = Math.max(50, width - 2);

  const idShort = run.id.slice(0, 8);
  const elapsed = run.endedAt !== undefined
    ? fmtDuration(run.durationMs ?? Math.max(0, run.endedAt - run.startedAt))
    : fmtDuration(Math.max(0, now - run.startedAt));
  const stagesRunning = run.stages.filter((s) => s.status === "running").length;
  const stagesTotal = run.stages.length;

  const warning = hexToAnsi(theme.warning);
  const text = hexToAnsi(theme.text);
  const dim = hexToAnsi(theme.dim);
  const muted = hexToAnsi(theme.textMuted);
  const panelBg = hexBg(theme.bg);

  const lines: string[] = [];
  lines.push(renderHeader(width, theme));
  lines.push(renderBlankRow(inner, theme));

  // Identity row: ⚠  <name>  ·  <idShort>
  const identity =
    `   ${warning}\u26a0${RESET}${panelBg}  ${text}${BOLD}${run.name}${RESET}${panelBg}  ${dim}\u00b7${RESET}${panelBg}  ${muted}${idShort}${RESET}`;
  lines.push(renderTextRow(inner, theme, identity));

  // Status sub-line.
  const statusLine = run.endedAt === undefined
    ? `      ${muted}in-flight ${elapsed}, ${stagesRunning}/${stagesTotal} stages running${RESET}`
    : `      ${muted}${run.status} after ${elapsed}, ${stagesTotal} stages${RESET}`;
  lines.push(renderTextRow(inner, theme, statusLine));
  lines.push(renderBlankRow(inner, theme));

  // Body copy.
  lines.push(renderTextRow(
    inner,
    theme,
    `      ${muted}Aborts the active stage and discards partial work.${RESET}`,
  ));
  lines.push(renderTextRow(
    inner,
    theme,
    `      ${muted}The runId stays in history.${RESET}`,
  ));
  lines.push(renderBlankRow(inner, theme));

  // Buttons row, centered.
  const cancelBtn = renderButton("Cancel", state.focusedButton === 0, false, theme);
  const killBtn = renderButton("\u25c6 Kill run", state.focusedButton === 1, true, theme);
  const buttonsVis = visibleWidth(" Cancel ") + 3 + visibleWidth(" \u25c6 Kill run ");
  const leftPad = Math.max(2, Math.floor((inner - buttonsVis) / 2));
  const rightPad = Math.max(0, inner - leftPad - buttonsVis);
  const buttonsRow =
    `${" ".repeat(leftPad)}${cancelBtn}${panelBg}   ${RESET}${killBtn}${panelBg}${" ".repeat(rightPad)}${RESET}`;
  const border = hexToAnsi(theme.border);
  lines.push(`${border}│${RESET}${panelBg}${padTo(buttonsRow, inner)}${RESET}${border}│${RESET}`);
  lines.push(renderBlankRow(inner, theme));

  lines.push(renderFooter(width, theme));
  return lines;
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

export type KillConfirmAction =
  | { kind: "noop" }
  | { kind: "cancel" }
  | { kind: "confirm" };

export function handleKillConfirmInput(
  data: string,
  state: KillConfirmState,
): KillConfirmAction {
  // Direct shortcuts bypass focus.
  if (data === "y" || data === "Y") return { kind: "confirm" };
  if (data === "n" || data === "N") return { kind: "cancel" };
  if (data === "\x1b") return { kind: "cancel" };

  // Tab / arrows toggle focus.
  if (data === "\t" || data === "\x1b[C" || data === "\x1b[D" || data === "h" || data === "l") {
    state.focusedButton = state.focusedButton === 0 ? 1 : 0;
    return { kind: "noop" };
  }
  if (data === "\r" || data === "\n") {
    return state.focusedButton === 1 ? { kind: "confirm" } : { kind: "cancel" };
  }
  return { kind: "noop" };
}
