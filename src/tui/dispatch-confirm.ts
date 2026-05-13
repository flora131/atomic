/**
 * `/workflow <name> …` dispatch confirmation — chat surface from
 * ui/mockups.html §1.
 *
 * Visual contract:
 *  - Compact "✓ submitted" line echoing the slash command.
 *  - One full-width `[ DISPATCHED ]` band with the workflow name as
 *    subtitle and a `● running` badge on the right.
 *  - One status-coloured tagged card:
 *      row 1: ▎ stripe · [tag runId8]  · muted "run id"
 *      row 2: ▎ stripe · "inputs" · first-3 inputs · "+N more"
 *      row 3: ▎ stripe · "mode" · chain / single · muted "starting…"
 *  - Two hint rows pointing at `/workflow connect <id>` and
 *    `/workflow status`.
 *
 * Plain mode degrades the chrome but preserves the same line order.
 *
 * cross-ref:
 *  - ui/mockups.html §1 (after — one band, one card)
 *  - src/tui/chat-surface.ts shared primitives
 */

import type { GraphTheme } from "./graph-theme.js";
import {
  renderFlatBand,
  renderTaggedCard,
  renderHintRows,
  ELLIPSIS,
  chatWidth,
} from "./chat-surface.js";
import { hexToAnsi, RESET } from "./color-utils.js";
import { visibleWidth, truncateToWidth } from "./text-helpers.js";

const INLINE_INPUT_LIMIT = 3;
const SHORT_ID_LEN = 8;
const SINGLE_VALUE_BUDGET_FRACTION = 0.5;

export interface RenderDispatchConfirmOpts {
  /** Registered workflow name (subtitle of the band). */
  workflowName: string;
  /** Real run UUID; the renderer surfaces the first 8 chars in the tag. */
  runId: string;
  /** Inputs merged from CLI tokens + picker output. */
  inputs: Readonly<Record<string, unknown>>;
  /** Provide for themed chrome; omit for plain ASCII. */
  theme?: GraphTheme;
  /** Render width (cells). Defaults to `process.stdout.columns`. */
  width?: number;
}

/**
 * Render the post-dispatch confirmation: submitted line, DISPATCHED band,
 * run card with input summary, and the two next-step hint rows.
 */
export function renderDispatchConfirm(opts: RenderDispatchConfirmOpts): string {
  const width = effectiveWidth(opts.width);
  const theme = opts.theme;
  const accent = theme?.warning ?? "#000000";
  const submitted = submittedLine(opts.workflowName, theme);

  const band = renderFlatBand({
    label: "DISPATCHED",
    subtitle: opts.workflowName,
    badges: theme
      ? [{ text: "● running", fg: theme.warning }]
      : [{ text: "● running" }],
    theme,
    width: opts.width,
  });

  const tag = opts.runId.length > SHORT_ID_LEN
    ? opts.runId.slice(0, SHORT_ID_LEN)
    : opts.runId;

  const card = renderTaggedCard({
    tag,
    tagSubtitle: "run id",
    accent,
    width: opts.width,
    theme,
    bodyRows: [
      inputsRow(opts.inputs, width, theme),
      statusRow(theme),
    ],
  });

  const hints = renderHintRows(
    [
      { command: `/workflow connect ${tag}`, hint: "attach & watch" },
      { command: "/workflow status", hint: "list in-flight runs" },
    ],
    theme,
  );

  // Blank line between the band and the card — same header-vs-content
  // separation used by /workflow list and /workflow status. Without it
  // the `▎` stripe abuts the band's bg fill and reads as one block.
  return [submitted, band, "", card, hints].join("\n");
}

function submittedLine(workflowName: string, theme?: GraphTheme): string {
  if (!theme) {
    return `✓ submitted  ·  /workflow ${workflowName}`;
  }
  const ok = hexToAnsi(theme.success);
  const text = hexToAnsi(theme.text);
  const dim = hexToAnsi(theme.dim);
  return `${ok}✓${RESET} ${text}submitted${RESET}  ${dim}·  /workflow ${workflowName}${RESET}`;
}

function inputsRow(
  inputs: Readonly<Record<string, unknown>>,
  width: number,
  theme?: GraphTheme,
): string {
  const muted = theme ? hexToAnsi(theme.textMuted) : "";
  const text = theme ? hexToAnsi(theme.text) : "";
  const dim = theme ? hexToAnsi(theme.dim) : "";
  const faint = dim;
  const reset = theme ? RESET : "";

  const entries = Object.entries(inputs);
  if (entries.length === 0) {
    return theme
      ? `${muted}inputs${reset}    ${dim}(none)${reset}`
      : "inputs    (none)";
  }

  const label = theme ? `${muted}inputs${reset}` : "inputs";
  const labelW = visibleWidth("inputs") + 4;
  const valueBudget = Math.max(20, Math.floor(width * SINGLE_VALUE_BUDGET_FRACTION));
  const interior = width - 4; // 3-cell stripe prefix + 1-cell margin
  const visible = entries.slice(0, INLINE_INPUT_LIMIT);
  const overflow = entries.length - visible.length;

  const segs = visible.map(([k, v]) => {
    const rendered = renderInputValue(v, valueBudget);
    if (!theme) return `${k}=${rendered}`;
    return `${text}${k}${reset}${faint}=${reset}${text}${rendered}${reset}`;
  });

  const sep = theme ? `  ${faint}·${reset}  ` : "  ·  ";
  let row = `${label}    ${segs.join(sep)}`;
  if (overflow > 0) {
    const moreText = `+${overflow} more`;
    row += theme
      ? `${sep}${dim}${moreText}${reset}`
      : `  ·  ${moreText}`;
  }

  // If the line would exceed the interior budget, drop to a single-line
  // ellipsis-truncated plain join — the dispatch surface is non-interactive
  // and the user can drill via `/workflow inputs <id>` to see the full set.
  const inlineLen =
    labelW +
    visible.reduce((a, [k, v]) => a + k.length + 1 + renderInputValue(v, valueBudget).length, 0) +
    Math.max(0, visible.length - 1) * 5 +
    (overflow > 0 ? 5 + `+${overflow} more`.length : 0);
  if (inlineLen > interior) {
    const flat = entries
      .map(([k, v]) => `${k}=${renderInputValue(v, valueBudget)}`)
      .join(", ");
    const cut = truncateToWidth(flat, Math.max(8, interior - labelW), ELLIPSIS);
    row = theme
      ? `${label}    ${text}${cut}${reset}`
      : `inputs    ${cut}`;
  }
  return row;
}

function renderInputValue(value: unknown, budget: number): string {
  if (typeof value === "string") {
    // Reserve 2 cells for the surrounding quotes; truncate the interior.
    const interior = Math.max(0, budget - 2);
    const trimmed = truncateToWidth(value, interior, ELLIPSIS);
    return `"${trimmed}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  // Objects / arrays — show a compact JSON projection within budget.
  const json = JSON.stringify(value);
  return truncateToWidth(json ?? "", budget, ELLIPSIS);
}

function statusRow(theme?: GraphTheme): string {
  if (!theme) return "status    starting…";
  const muted = hexToAnsi(theme.textMuted);
  const dim = hexToAnsi(theme.dim);
  return `${muted}status${RESET}    ${dim}starting…${RESET}`;
}

/**
 * Resolve the render width for the dispatch surface. Delegates to the
 * shared `chatWidth()` helper which already accounts for the chat host's
 * 2-cell horizontal padding when no explicit width is supplied.
 */
function effectiveWidth(width?: number): number {
  return chatWidth(width);
}
