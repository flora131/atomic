/**
 * Renderer for the inline chat-history workflow form.
 *
 * Identity mirrors the orchestrator panel:
 *   - 3-row mantle chrome band with an outlined accent pill on the left,
 *     workflow name beside it, and a `<i> / <n>` counter on the right.
 *   - One bordered "node card" per field with the field name centred inside
 *     the top border (matches the DAG node-card title slot in node-card.ts).
 *   - Caption row beneath each field card: `<type>  ·  <required|optional>
 *     ·  <description>` in dim.
 *   - 3-row mantle chrome footer with the `EDIT` mode pill and hints
 *     anchored at the bottom of the widget.
 *
 *   ╭ WORKFLOW ╮  ralph                                          1 / 4
 *   │ WORKFLOW │
 *   ╰──────────╯
 *
 *   ╭───── prompt ─────────────────────────────────────────────────────╮
 *   │ build me a TUI for arg-pickers                                    │
 *   ╰──────────────────────────────────────────────────────────────────╯
 *     text  ·  required  ·  task prompt
 *
 *   ╭───── iters ──────────────────────────────────────────────────────╮
 *   │ 5                                                                 │
 *   ╰──────────────────────────────────────────────────────────────────╯
 *     integer  ·  optional  ·  loop count
 *
 *   ╭ EDIT ╮  tab next  ·  shift+tab prev  ·  ctrl+x run  ·  esc cancel
 *   │ EDIT │
 *   ╰──────╯
 *
 * Frozen states drop all chrome — submitted and cancelled forms are
 * single-line ledger entries in the scrollback.
 *
 * The card never owns keystrokes — keystrokes are routed by the editor.
 * `renderInlineCard` is a pure function of `state + theme + width`.
 *
 * cross-ref:
 *  - src/tui/header.ts (renderOutlinePill — shared pill primitive)
 *  - src/tui/node-card.ts (centred title-in-border pattern)
 *  - src/tui/graph-view.ts (statusline + chrome band composition)
 */

import type { InlineFormState } from "./inline-form-store.js";
import type { WorkflowInputEntry } from "../extension/render-result.js";
import type { GraphTheme } from "./graph-theme.js";
import { invalidForField } from "./inputs-picker.js";
import { renderOutlinePill } from "./header.js";
import { BOLD, RESET, hexBg, hexToAnsi, paint } from "./color-utils.js";
import { truncateToWidth, visibleWidth } from "./text-helpers.js";

export interface InlineCardOpts {
  width: number;
  state: InlineFormState;
  theme: GraphTheme;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
}

function clampGraphemeOffset(text: string, caret: number): number {
  const c = Math.max(0, Math.min(caret, text.length));
  if (c === text.length) return c;
  for (const s of graphemeSegmenter.segment(text)) {
    if (s.index === c) return c;
    if (s.index > c) break;
  }
  let prev = 0;
  for (const s of graphemeSegmenter.segment(text)) {
    if (s.index >= c) break;
    prev = s.index;
  }
  return prev;
}

function headToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const g of graphemes(text)) {
    const w = visibleWidth(g);
    if (used + w > width) break;
    out += g;
    used += w;
  }
  return out;
}

function tailToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  const gs = graphemes(text);
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i]!;
    const w = visibleWidth(g);
    if (used + w > width) break;
    out = g + out;
    used += w;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

export function renderInlineCard(opts: InlineCardOpts): string[] {
  const { state, theme, width } = opts;
  if (state.status === "submitted") return [fitLine(renderSubmittedLine(state, theme), width)];
  if (state.status === "cancelled") return [fitLine(renderCancelledLine(state, theme), width)];
  return renderEditingCard(opts).map((line) => fitLine(line, width));
}

function renderEditingCard(opts: InlineCardOpts): string[] {
  const { state, theme, width } = opts;
  const lines: string[] = [];

  lines.push(...renderHeaderBand(state, theme, width));
  if (state.description) {
    lines.push("  " + paint(state.description, theme.textMuted));
  }
  lines.push("");

  for (let i = 0; i < state.fields.length; i++) {
    const f = state.fields[i]!;
    const raw = state.rawText[f.name] ?? "";
    const focused = i === state.focusedIdx;
    // Don't paint a focused field as invalid — the caret is already on it,
    // the user is fixing it now.
    const invalid = focused ? null : invalidForField(f, raw, i);
    lines.push(...renderFieldCard(f, raw, focused, invalid, theme, width, focused ? state.caret : undefined));
    lines.push("");
  }

  lines.push(...renderFooterBand(theme, width));
  return lines;
}

// ---------------------------------------------------------------------------
// Header / footer chrome bands
// ---------------------------------------------------------------------------

const HEADER_PILL_LABEL = "WORKFLOW";
const FOOTER_PILL_LABEL = "EDIT";

function renderHeaderBand(state: InlineFormState, theme: GraphTheme, width: number): string[] {
  const chromeBg = hexBg(theme.backgroundPanel);
  const muted = hexToAnsi(theme.textMuted);
  const dim = hexToAnsi(theme.dim);

  const { top, mid, bot, visibleWidth: pillW } = renderOutlinePill(
    HEADER_PILL_LABEL,
    theme.accent,
    chromeBg,
  );

  const nameVisible = `  ${state.workflowName}`;
  const focusTargetCount = state.fields.length;
  const counter = `${Math.min(state.focusedIdx + 1, focusTargetCount)} / ${focusTargetCount}`;
  const counterVisible = counter;

  const leftEdgePad = 1;
  const rightEdgePad = 2;
  const fillerVisible = Math.max(
    1,
    width - leftEdgePad - pillW - nameVisible.length - counterVisible.length - rightEdgePad,
  );
  const blankAcross = " ".repeat(nameVisible.length + fillerVisible + counterVisible.length + rightEdgePad);

  return [
    `${chromeBg} ${RESET}${top}${chromeBg}${blankAcross}${RESET}`,
    `${chromeBg} ${RESET}${mid}${chromeBg}  ${muted}${state.workflowName}${RESET}${chromeBg}${" ".repeat(fillerVisible)}${dim}${counter}${RESET}${chromeBg}${" ".repeat(rightEdgePad)}${RESET}`,
    `${chromeBg} ${RESET}${bot}${chromeBg}${blankAcross}${RESET}`,
  ];
}

function renderFooterBand(theme: GraphTheme, width: number): string[] {
  const chromeBg = hexBg(theme.backgroundPanel);
  const dim = hexToAnsi(theme.dim);

  const { top, mid, bot, visibleWidth: pillW } = renderOutlinePill(
    FOOTER_PILL_LABEL,
    theme.accent,
    chromeBg,
  );

  const text = hexToAnsi(theme.text);
  const muted = hexToAnsi(theme.textMuted);
  const hints: Array<{ key: string; label: string }> = [
    { key: "tab", label: "Next" },
    { key: "shift+tab", label: "Prev" },
    { key: "ctrl+x", label: "Run" },
    { key: "esc", label: "Cancel" },
  ];
  const sep = `${chromeBg}  ${dim}·${RESET}${chromeBg}  `;
  const segments = hints.map(
    ({ key, label }) =>
      `${text}${BOLD}${key}${RESET}${chromeBg} ${muted}${label}${RESET}${chromeBg}`,
  );
  const hintsStyled = segments.join(sep);
  const hintsVisible =
    hints.reduce((sum, h) => sum + h.key.length + 1 + h.label.length, 0) +
    (hints.length - 1) * 5;

  const leftEdgePad = 1;
  const leadGap = 2; // gap between pill and hints, matching graph statusline
  const rightEdgePad = 2;
  const tailFiller = Math.max(
    0,
    width - leftEdgePad - pillW - leadGap - hintsVisible - rightEdgePad,
  );
  const blankAcross = " ".repeat(leadGap + hintsVisible + tailFiller + rightEdgePad);

  return [
    `${chromeBg} ${RESET}${top}${chromeBg}${blankAcross}${RESET}`,
    `${chromeBg} ${RESET}${mid}${chromeBg}${" ".repeat(leadGap)}${hintsStyled}${chromeBg}${" ".repeat(tailFiller + rightEdgePad)}${RESET}`,
    `${chromeBg} ${RESET}${bot}${chromeBg}${blankAcross}${RESET}`,
  ];
}

// ---------------------------------------------------------------------------
// Field card (orchestrator node-card identity: centred title in top border)
// ---------------------------------------------------------------------------

function renderFieldCard(
  field: WorkflowInputEntry,
  raw: string,
  focused: boolean,
  invalid: string | null,
  theme: GraphTheme,
  width: number,
  caret?: number,
): string[] {
  const borderHex = invalid
    ? theme.error
    : focused
      ? theme.accent
      : theme.borderDim;
  const titleHex = borderHex;
  const bc = hexToAnsi(borderHex);
  const inner = Math.max(20, width - 2); // 1 col border on each side
  const usable = inner - 2; // 1 col content padding on each side

  // Centred title: ╭───── prompt ─────╮. Title text is bold, in border color.
  const titleRaw = ` ${field.name} `;
  const titleStart = Math.max(1, Math.floor((inner - titleRaw.length) / 2));
  const leadDashes = "─".repeat(titleStart);
  const tailDashes = "─".repeat(Math.max(0, inner - titleStart - titleRaw.length));
  const top =
    `${bc}╭${leadDashes}` +
    `${BOLD}${hexToAnsi(titleHex)}${titleRaw}${RESET}${bc}` +
    `${tailDashes}╮${RESET}`;
  const bottom = `${bc}╰${"─".repeat(inner)}╯${RESET}`;

  const contentLines = renderFieldContent(field, raw, focused, usable, theme, caret).map(
    (row) => `${bc}│${RESET} ${row}${" ".repeat(Math.max(0, usable - visibleWidth(row)))} ${bc}│${RESET}`,
  );

  // Caption: type · required|optional · description
  const caption = renderCaption(field, invalid, theme);

  return [top, ...contentLines, bottom, caption];
}

function renderCaption(
  field: WorkflowInputEntry,
  invalid: string | null,
  theme: GraphTheme,
): string {
  const sep = paint("  ·  ", theme.dim);
  const tagColor = invalid
    ? theme.error
    : field.required
      ? theme.warning
      : theme.dim;
  const tagLabel = invalid ?? (field.required ? "required" : "optional");
  const desc = field.description
    ? sep + paint(field.description, theme.dim)
    : "";
  return (
    "  " +
    paint(field.type, theme.dim) +
    sep +
    paint(tagLabel, tagColor) +
    desc
  );
}

function renderFieldContent(
  field: WorkflowInputEntry,
  raw: string,
  focused: boolean,
  usable: number,
  theme: GraphTheme,
  caret?: number,
): string[] {
  if (field.type === "select" && field.choices && field.choices.length > 0) {
    const cells = field.choices.map((c) => {
      const sel = c === raw;
      const dot = sel
        ? paint("●", focused ? theme.accent : theme.success)
        : paint("○", theme.dim);
      const lbl = sel
        ? paint(c, focused ? theme.text : theme.textMuted)
        : paint(c, theme.dim);
      return dot + " " + lbl;
    });
    return [clip(cells.join("   "), usable)];
  }
  if (field.type === "boolean") {
    const on = raw === "true";
    const onCell =
      paint(on ? "●" : "○", on ? theme.accent : theme.dim) +
      " " +
      paint("on", on ? theme.text : theme.dim);
    const offCell =
      paint(!on ? "●" : "○", !on ? theme.accent : theme.dim) +
      " " +
      paint("off", !on ? theme.text : theme.dim);
    return [clip(onCell + "   " + offCell, usable)];
  }
  // string / number / integer — single-line scalar input.
  if (field.type !== "text") {
    if (raw === "") {
      if (focused) return [paint("▋", theme.accent)];
      return [paint(field.placeholder ?? "", theme.dim)];
    }
    if (focused) {
      return [renderCaretLine(raw, caret ?? raw.length, usable, theme, theme.text)];
    }
    return [clip(paint(raw, theme.textMuted), usable)];
  }
  // text — multi-line prompt-box input. Newlines render as actual visual
  // line breaks (no more `⏎` glyph) and long single lines wrap at the
  // field's usable width. The box height grows to fit every visual row
  // so the user sees their whole prompt; the surrounding card already
  // lives in chat scrollback so vertical space is not at a premium.
  if (raw === "") {
    if (focused) return [paint("▋", theme.accent)];
    return [paint(field.placeholder ?? "", theme.dim)];
  }
  const layout = layoutTextField(raw, usable, focused ? caret ?? raw.length : 0);
  if (!focused) {
    return layout.lines.map((line) => paint(line, theme.textMuted));
  }
  return layout.lines.map((line, row) => {
    if (row !== layout.cursorRow) {
      return paint(line, theme.text);
    }
    return renderCaretLine(line, layout.cursorOffset ?? line.length, usable, theme, theme.text);
  });
}

function renderCaretLine(
  raw: string,
  caret: number,
  usable: number,
  theme: GraphTheme,
  color: string,
): string {
  const safe = clampGraphemeOffset(raw, caret);
  const beforeFull = raw.slice(0, safe);
  const afterFull = raw.slice(safe);
  const cursorWidth = 1;
  let before = beforeFull;
  let after = afterFull;
  if (visibleWidth(beforeFull) + cursorWidth + visibleWidth(afterFull) > usable) {
    before = tailToWidth(beforeFull, Math.max(0, usable - cursorWidth));
    after = headToWidth(afterFull, Math.max(0, usable - visibleWidth(before) - cursorWidth));
  }
  return clip(paint(before, color) + paint("▋", theme.accent) + paint(after, color), usable);
}

// ---------------------------------------------------------------------------
// Frozen states
// ---------------------------------------------------------------------------

function renderSubmittedLine(state: InlineFormState, theme: GraphTheme): string {
  return (
    paint("✓ submitted", theme.success, { bold: true }) +
    paint("  ·  ", theme.dim) +
    paint(composeCommand(state), theme.dim)
  );
}

function renderCancelledLine(state: InlineFormState, theme: GraphTheme): string {
  return (
    paint("✗ cancelled", theme.dim) +
    paint("  ·  ", theme.dim) +
    paint(state.workflowName, theme.textMuted)
  );
}

function composeCommand(state: InlineFormState): string {
  const parts: string[] = [`/workflow ${state.workflowName}`];
  for (const f of state.fields) {
    const v = state.rawText[f.name] ?? "";
    if (v === "" && !f.required) continue;
    const needsQuotes = /\s|=/.test(v);
    parts.push(`${f.name}=${needsQuotes ? `"${v}"` : v}`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function fitLine(ansi: string, width: number): string {
  return truncateToWidth(ansi, Math.max(0, width), "…", true);
}

function clip(ansi: string, budget: number): string {
  return truncateToWidth(ansi, Math.max(0, budget), "…", true);
}

/**
 * Lay out a multi-line text field into visual rows while tracking where the
 * caret should appear on screen. Newlines (`\n`) always start a new visual
 * row; logical lines that exceed `usable` cells wrap at the character
 * boundary (a deliberately simple rule — word-wrap would also be fine but
 * adds noise for prompt-style inputs where every character is signal).
 *
 * Caret semantics:
 *   - `caret` is the byte offset into `raw`.
 *   - The returned `cursorRow`/`cursorCol` point to the visual cell where
 *     the cursor glyph should render — the cell currently occupied by the
 *     character AT `caret` (so the cursor visually sits BEFORE that
 *     character). When `caret === raw.length`, the cursor lands at the
 *     end of the last visual row.
 *   - When `caret` falls on a wrap boundary, the cursor lands on the start
 *     of the next visual row, matching how Pi's own editor positions the
 *     caret after the last character that fit.
 *
 * cross-ref: pi-tui dist/components/editor.js `layoutText`/`wordWrapLine`.
 */
export function layoutTextField(
  raw: string,
  usable: number,
  caret: number,
): { lines: string[]; cursorRow: number; cursorCol: number; cursorOffset?: number } {
  const width = Math.max(1, Math.floor(usable));
  const safeCaret = clampGraphemeOffset(raw, caret);
  const visualLines: string[] = [];
  const lineStarts: number[] = [];
  const lineEnds: number[] = [];
  let curLine = "";
  let curWidth = 0;
  let lineStart = 0;

  const pushLine = (end: number): void => {
    visualLines.push(curLine);
    lineStarts.push(lineStart);
    lineEnds.push(end);
    curLine = "";
    curWidth = 0;
    lineStart = end;
  };

  for (const s of graphemeSegmenter.segment(raw)) {
    const offset = s.index;
    const g = s.segment;
    if (g === "\n") {
      pushLine(offset);
      lineStart = offset + g.length;
      continue;
    }
    const w = visibleWidth(g);
    if (curLine !== "" && curWidth + w > width) {
      pushLine(offset);
    }
    curLine += g;
    curWidth += w;
    if (curWidth >= width) {
      pushLine(offset + g.length);
    }
  }
  visualLines.push(curLine);
  lineStarts.push(lineStart);
  lineEnds.push(raw.length);

  let cursorRow = visualLines.length - 1;
  for (let i = 0; i < visualLines.length; i++) {
    const start = lineStarts[i]!;
    const end = lineEnds[i]!;
    const nextStart = lineStarts[i + 1];
    if (safeCaret >= start && safeCaret < end) {
      cursorRow = i;
      break;
    }
    if (safeCaret === end) {
      cursorRow = nextStart === safeCaret ? i + 1 : i;
    }
  }
  cursorRow = Math.max(0, Math.min(cursorRow, visualLines.length - 1));
  const line = visualLines[cursorRow] ?? "";
  const cursorOffset = Math.max(0, Math.min(safeCaret - (lineStarts[cursorRow] ?? 0), line.length));
  const cursorCol = visibleWidth(line.slice(0, cursorOffset));
  return { lines: visualLines, cursorRow, cursorCol, cursorOffset };
}
