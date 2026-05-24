/**
 * Renderer for the inline chat-history workflow form.
 *
 * Identity mirrors the multi ask_user_question dialog:
 *   - Top/bottom dynamic border rules wrap the live form.
 *   - A compact tab row shows each input (`■` valid / `□` missing) plus Submit,
 *     matching the multi-question tab bar affordance.
 *   - The active field description is the question heading.
 *   - The field name lives in the checkbox tab pane.
 *   - Footer hints sit below the bottom rule, like ask_user_question hints.
 *
 *   ───────────────────────────────────────────────────────────────────
 *    ←  □ prompt   ■ iters   ✓ Submit  →
 *
 *   task prompt
 *
 *   ❯ 1. build me a TUI for arg-pickers
 *
 *   ───────────────────────────────────────────────────────────────────
 *   Enter to select · ↑/↓ to navigate · Tab to switch input fields · Esc to cancel
 *
 * Submitted forms become a single-line ledger entry in scrollback. Cancelled
 * forms render no rows so cancellation leaves no chat artefact.
 *
 * The card never owns keystrokes — keystrokes are routed by the editor.
 * `renderInlineCard` is a pure function of `state + theme + width`.
 *
 * cross-ref:
 *  - packages/coding-agent/src/core/tools/ask-user-question/view/dialog-builder.ts
 *  - src/tui/node-card.ts (centred title-in-border pattern)
 *  - src/tui/graph-view.ts (statusline + chrome band composition)
 */

import type { InlineFormState } from "./inline-form-store.js";
import type { WorkflowInputEntry } from "../extension/render-result.js";
import type { GraphTheme } from "./graph-theme.js";
import { computeInvalid, invalidForField } from "./inputs-picker.js";
import { paint } from "./color-utils.js";
import {
  truncateToWidth,
  visibleWidth,
  wrapPlainText,
} from "./text-helpers.js";
import {
  renderAskChoiceRows,
  renderSubmitControls,
  renderSubmitReview,
  renderWorkflowFormFooterHints,
} from "./submit-pane.js";

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
  if (state.status === "cancelled") return [];
  return renderEditingCard(opts).map((line) => fitLine(line, width));
}

function renderEditingCard(opts: InlineCardOpts): string[] {
  const { state, theme, width } = opts;
  const lines: string[] = [];

  lines.push(...renderHeaderBand(state, theme, width));

  const activeField = state.fields[state.focusedIdx];
  if (activeField) {
    const raw = state.rawText[activeField.name] ?? "";
    lines.push(...renderActiveField(activeField, raw, state.caret, theme, width));
    lines.push("");
  } else {
    lines.push(...renderSubmitReview({
      workflowName: state.workflowName,
      fields: state.fields,
      rawText: state.rawText,
      theme,
      width,
    }));
    lines.push("");
  }

  lines.push(...renderFooterBand(state, theme, width));
  return lines;
}

// ---------------------------------------------------------------------------
// Header / footer chrome bands
// ---------------------------------------------------------------------------

function renderHeaderBand(state: InlineFormState, theme: GraphTheme, width: number): string[] {
  return [
    renderDialogRule(theme, width),
    renderInputTabBar(state, theme, width),
    "",
  ];
}

function renderFooterBand(state: InlineFormState, theme: GraphTheme, width: number): string[] {
  if (state.focusedIdx === state.fields.length) {
    return [renderDialogRule(theme, width), ...renderInlineSubmitControls(state, theme, width)];
  }
  return [renderDialogRule(theme, width), renderFooterHints(theme, width)];
}

function renderDialogRule(theme: GraphTheme, width: number): string {
  return paint("─".repeat(Math.max(1, width)), theme.accent);
}

function renderInputTabBar(state: InlineFormState, theme: GraphTheme, width: number): string {
  const pieces: string[] = [" ← "];
  for (let i = 0; i < state.fields.length; i++) {
    const field = state.fields[i]!;
    const raw = state.rawText[field.name] ?? "";
    const valid = invalidForField(field, raw, i) === null;
    const box = valid ? "■" : "□";
    const rawSeg = ` ${box} ${field.name} `;
    const styled = i === state.focusedIdx
      ? paint(rawSeg, theme.text, { bg: theme.selection, bold: true })
      : paint(rawSeg, valid ? theme.success : theme.dim);
    pieces.push(styled, " ");
  }
  const allValid = state.fields.every((field, i) => invalidForField(field, state.rawText[field.name] ?? "", i) === null);
  const submitText = " ✓ Submit ";
  const submitStyled = state.focusedIdx === state.fields.length
    ? paint(submitText, theme.text, { bg: theme.selection, bold: true })
    : paint(submitText, allValid ? theme.success : theme.dim);
  pieces.push(submitStyled, " →");
  return truncateToWidth(pieces.join(""), width, "", true);
}

function renderFooterHints(theme: GraphTheme, width: number): string {
  return renderWorkflowFormFooterHints(theme, width);
}

// ---------------------------------------------------------------------------
// Active field body (ask_user_question-style list/input rows)
// ---------------------------------------------------------------------------

function renderActiveField(
  field: WorkflowInputEntry,
  raw: string,
  caret: number,
  theme: GraphTheme,
  width: number,
): string[] {
  const heading = field.description && field.description.length > 0 ? field.description : field.name;
  const lines = wrapPlainText(heading, width).map((line) => paint(line, theme.text, { bold: true }));
  lines.push("", ...renderAskStyleFieldBody(field, raw, caret, theme, width));
  return lines;
}

function renderAskStyleFieldBody(
  field: WorkflowInputEntry,
  raw: string,
  caret: number,
  theme: GraphTheme,
  width: number,
): string[] {
  if (field.type === "select" && field.choices && field.choices.length > 0) {
    const selected = Math.max(0, field.choices.indexOf(raw));
    return field.choices.flatMap((choice, i) => renderAskChoiceRows(i + 1, choice, i === selected, theme, width));
  }

  if (field.type === "boolean") {
    const on = raw === "true";
    return [
      ...renderAskChoiceRows(1, "on", on, theme, width),
      ...renderAskChoiceRows(2, "off", !on, theme, width),
    ];
  }

  return renderAskInputRows(raw, caret, field.placeholder, theme, width);
}

function renderInlineSubmitControls(state: InlineFormState, theme: GraphTheme, width: number): string[] {
  const invalid = computeInvalid(state.fields, state.rawText);
  return renderSubmitControls({
    invalidFieldNames: invalid.map((i) => state.fields[i]!.name),
    submitChoiceIdx: state.submitChoiceIdx,
    theme,
    width,
  });
}

function renderAskInputRows(
  raw: string,
  caret: number,
  placeholder: string | undefined,
  theme: GraphTheme,
  width: number,
): string[] {
  const prefix = "❯ 1. ";
  const continuationPrefix = " ".repeat(visibleWidth(prefix));
  const usable = Math.max(1, width - visibleWidth(prefix));
  if (raw === "") {
    const value = placeholder && placeholder.length > 0
      ? paint(placeholder, theme.dim) + cursorBlock()
      : cursorBlock();
    return [paint(prefix, theme.accent) + truncateToWidth(value, usable, "…", true)];
  }

  const layout = layoutTextField(raw, usable, caret);
  return layout.lines.map((line, row) => {
    const linePrefix = row === 0 ? prefix : continuationPrefix;
    const content = row === layout.cursorRow
      ? renderCaretLine(line, layout.cursorOffset ?? line.length, usable, theme, theme.text)
      : truncateToWidth(paint(line, theme.text), usable, "…", true);
    return paint(linePrefix, row === 0 ? theme.accent : theme.dim) + content;
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
  const [at = ""] = graphemes(afterFull);
  const afterRest = at === "" ? "" : afterFull.slice(at.length);
  const cursorPlain = at !== "" ? at : " ";
  const cursorWidth = Math.max(1, visibleWidth(cursorPlain));
  let before = beforeFull;
  let after = afterRest;
  if (visibleWidth(beforeFull) + cursorWidth + visibleWidth(afterRest) > usable) {
    before = tailToWidth(beforeFull, Math.max(0, usable - cursorWidth));
    after = headToWidth(afterRest, Math.max(0, usable - visibleWidth(before) - cursorWidth));
  }
  return clip(paint(before, color) + cursorBlock(cursorPlain) + paint(after, color), usable);
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

function cursorBlock(text = " "): string {
  return `\x1b[7m${text}\x1b[0m`;
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
