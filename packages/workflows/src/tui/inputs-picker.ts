/**
 * Interactive argument picker for `/workflow <name>` invocations.
 *
 * Opens when the user types `/workflow <name>` in the TUI without enough
 * key=value tokens to satisfy the declared schema. Mirrors the
 * `ask_user_question` dialog shape: a top rule, a compact field tab bar,
 * one active input at a time, ask-style pointer rows, and dim footer hints.
 * The workflow is already chosen, so there is no fuzzy-list pane.
 *
 *   ───────────────────────────────────────────
 *    ←  ■ prompt   ■ focus   ✓ Submit  →
 *
 *   The high-level task to plan and execute.
 *
 *   ❯ 1. Build me a TUI for…
 *
 *   ───────────────────────────────────────────
 *   Enter to select · ↑/↓ to navigate · Tab to switch input fields · Esc to cancel
 *
 * Field-type renderers:
 *   - string / number : single-row ask-style input with blinking cursor
 *   - text            : 3-row scrolling ask-style textarea
 *   - boolean         : vertical on/off choice list (space flips)
 *   - select          : vertical choice list, ←/→ cycles choices
 *
 * cross-ref:
 *   - flora131/atomic research/designs/workflow-picker-tui.tsx (PROMPT phase)
 *   - flora131/atomic packages/atomic-sdk/src/components/workflow-picker-panel.tsx
 *   - src/tui/session-picker.ts (sibling overlay; same chrome + key style)
 *   - DESIGN.md §5 Section Labels
 */

import type { WorkflowInputEntry } from "../extension/render-result.js";
import type { GraphTheme } from "./graph-theme.js";
import { paint } from "./color-utils.js";
import {
  decodePrintableKey,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapPlainText,
} from "./text-helpers.js";
import {
  renderAskChoiceRows,
  renderSubmitControls as renderSharedSubmitControls,
  renderSubmitReview,
  renderWorkflowFormFooterHints,
} from "./submit-pane.js";
import {
  type KeybindingsLike,
  TUI_ACTION,
  deleteRange,
  lineEnd,
  lineStart,
  matchesAction,
  wordLeft,
  wordRight,
} from "./keybindings-adapter.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Mutable picker state. The renderer is pure — state mutation happens in
 * `handleInputsPickerInput`, which returns one of these discriminated
 * actions so the host adapter (`inputs-overlay.ts`) knows when to resolve
 * the wrapping Promise.
 */
export interface InputsPickerState {
  /** Index of the currently-focused field. */
  focusedIdx: number;
  /**
   * Raw string the user has typed/selected for each field, keyed by name.
   * Booleans store `"true"` / `"false"`; numbers store their text form;
   * selects store the chosen choice; text/string store the literal value.
   * `coerceValues()` converts these into typed objects at submit time.
   */
  rawText: Record<string, string>;
  /** Active row while the focus is on the Submit tab: 0 = submit, 1 = cancel. */
  submitChoiceIdx: number;
  /**
   * Set of field indices that failed validation on the most recent submit
   * attempt. Used to dim the run hint and to highlight a field if the user
   * retries with required fields still empty.
   */
  invalidIndices: readonly number[];
  /** Cursor offset within the focused single-line text field. */
  caret: number;
}

/** Discriminated action returned by the key handler. */
export type InputsPickerAction =
  | { kind: "noop" }
  | { kind: "cancel" }
  | { kind: "run"; values: Record<string, unknown> };

export interface InputsPickerRenderOpts {
  width: number;
  theme: GraphTheme;
  workflowName: string;
  /** Optional one-line description shown directly under the workflow chip. */
  description?: string;
  fields: readonly WorkflowInputEntry[];
  state: InputsPickerState;
  /** True when the blinking cursor is in its visible half-period. */
  cursorOn: boolean;
}

// ---------------------------------------------------------------------------
// State construction + value coercion
// ---------------------------------------------------------------------------

/**
 * Seed `rawText` from declared defaults plus any values the user already
 * passed as key=value tokens. Enums/selects fall back to their first choice
 * (matching atomic's seeding rule), booleans default to `false`, and
 * numbers/text default to empty unless the schema declared a default.
 */
export function createInputsPickerState(
  fields: readonly WorkflowInputEntry[],
  prefilled: Record<string, unknown> = {},
): InputsPickerState {
  const rawText: Record<string, string> = {};
  for (const f of fields) {
    if (prefilled[f.name] !== undefined) {
      rawText[f.name] = String(prefilled[f.name]);
      continue;
    }
    if (f.default !== undefined) {
      rawText[f.name] = String(f.default);
      continue;
    }
    if (f.type === "select" && f.choices && f.choices.length > 0) {
      rawText[f.name] = f.choices[0]!;
      continue;
    }
    if (f.type === "boolean") {
      rawText[f.name] = "false";
      continue;
    }
    rawText[f.name] = "";
  }
  // Focus the first invalid field if any; otherwise field 0. This keeps the
  // cursor on the first thing the user actually needs to fill in.
  const firstInvalid = fields.findIndex((f, i) =>
    invalidForField(f, rawText[f.name] ?? "", i) !== null,
  );
  const focusedIdx = firstInvalid >= 0 ? firstInvalid : 0;
  return {
    focusedIdx,
    rawText,
    submitChoiceIdx: 0,
    invalidIndices: [],
    caret: (rawText[fields[focusedIdx]?.name ?? ""] ?? "").length,
  };
}

/**
 * Coerce the rawText map into typed values matching the declared schema.
 * Mirrors the `parseWorkflowArgs` JSON-tolerant logic for text/string
 * fields (so users can paste `["a","b"]` into a text box and have it land
 * as an array), and enforces numeric / boolean parsing for typed fields.
 *
 * Throws on hard parse failure for required fields; lenient on optional.
 * The picker only calls `coerceValues` after `validate` succeeds, so the
 * thrown branch is a defensive guard, not an expected path.
 */
export function coerceValues(
  fields: readonly WorkflowInputEntry[],
  raw: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = raw[f.name] ?? "";
    if (v === "" && !f.required) continue; // skip empty optionals
    switch (f.type) {
      case "number":
      case "integer": {
        const n = Number(v);
        if (Number.isFinite(n)) out[f.name] = n;
        break;
      }
      case "boolean": {
        out[f.name] = v === "true" || v === "1";
        break;
      }
      case "select":
        out[f.name] = v;
        break;
      case "text":
      case "string":
      default: {
        // Try JSON for power users pasting structured data; otherwise treat
        // as a literal string. Mirrors parseWorkflowArgs.
        if (
          (v.startsWith("{") && v.endsWith("}")) ||
          (v.startsWith("[") && v.endsWith("]"))
        ) {
          try {
            out[f.name] = JSON.parse(v) as unknown;
            break;
          } catch {
            // fall through
          }
        }
        out[f.name] = v;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Return the reason why `field` is invalid for `value`, or `null` if valid.
 * Used both to flag fields on submit and to drive the dim state of the run
 * key hint.
 */
export function invalidForField(
  field: WorkflowInputEntry,
  value: string,
  _idx: number,
): string | null {
  if (field.required && value.trim() === "") return "required";
  if (
    field.type === "select" &&
    field.choices &&
    value !== "" &&
    !field.choices.includes(value)
  ) {
    return "not in choices";
  }
  if (
    (field.type === "number" || field.type === "integer") &&
    value !== "" &&
    !Number.isFinite(Number(value))
  ) {
    return "must be a number";
  }
  return null;
}

export function computeInvalid(
  fields: readonly WorkflowInputEntry[],
  raw: Record<string, string>,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (invalidForField(f, raw[f.name] ?? "", i) !== null) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const dimSep = (theme: GraphTheme): string => paint("  ·  ", theme.dim);

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
}

function previousGraphemeOffset(text: string, caret: number): number {
  const c = Math.max(0, Math.min(caret, text.length));
  let prev = 0;
  for (const s of graphemeSegmenter.segment(text)) {
    if (s.index >= c) break;
    prev = s.index;
  }
  return prev;
}

function nextGraphemeOffset(text: string, caret: number): number {
  const c = Math.max(0, Math.min(caret, text.length));
  for (const s of graphemeSegmenter.segment(text)) {
    if (s.index >= c) return Math.min(text.length, s.index + s.segment.length);
    if (s.index + s.segment.length > c) return s.index + s.segment.length;
  }
  return text.length;
}

function clampGraphemeOffset(text: string, caret: number): number {
  const c = Math.max(0, Math.min(caret, text.length));
  if (c === text.length) return c;
  for (const s of graphemeSegmenter.segment(text)) {
    if (s.index === c) return c;
    if (s.index > c) break;
  }
  return previousGraphemeOffset(text, c);
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

function isPrintableGrapheme(data: string): boolean {
  if (data.length === 0 || data.includes("\x1b")) return false;
  for (const ch of data) {
    const code = ch.codePointAt(0);
    if (code === undefined || code < 0x20 || code === 0x7f) return false;
  }
  return graphemes(data).length === 1;
}

interface TextLayoutLine {
  text: string;
  start: number;
  end: number;
}

function layoutEditableText(raw: string, usable: number): TextLayoutLine[] {
  const width = Math.max(1, Math.floor(usable));
  const lines: TextLayoutLine[] = [];
  let line = "";
  let lineStart = 0;
  let lineWidth = 0;
  for (const s of graphemeSegmenter.segment(raw)) {
    const offset = s.index;
    const g = s.segment;
    if (g === "\n") {
      lines.push({ text: line, start: lineStart, end: offset });
      line = "";
      lineStart = offset + g.length;
      lineWidth = 0;
      continue;
    }
    const w = visibleWidth(g);
    if (line !== "" && lineWidth + w > width) {
      lines.push({ text: line, start: lineStart, end: offset });
      line = "";
      lineStart = offset;
      lineWidth = 0;
    }
    line += g;
    lineWidth += w;
    if (lineWidth >= width) {
      lines.push({ text: line, start: lineStart, end: offset + g.length });
      line = "";
      lineStart = offset + g.length;
      lineWidth = 0;
    }
  }
  lines.push({ text: line, start: lineStart, end: raw.length });
  return lines;
}

function visualColumnAt(text: string, caret: number): number {
  return visibleWidth(text.slice(0, clampGraphemeOffset(text, caret)));
}

function offsetAtVisualColumn(text: string, targetCol: number): number {
  let col = 0;
  for (const s of graphemeSegmenter.segment(text)) {
    const w = visibleWidth(s.segment);
    if (col + w > targetCol) return s.index;
    col += w;
  }
  return text.length;
}

function caretLineUp(raw: string, caret: number): number | null {
  const safe = clampGraphemeOffset(raw, caret);
  const lineStartOffset = raw.lastIndexOf("\n", safe - 1) + 1;
  if (lineStartOffset === 0) return null;
  const prevLineEnd = lineStartOffset - 1;
  const prevLineStart = raw.lastIndexOf("\n", prevLineEnd - 1) + 1;
  const col = visualColumnAt(raw.slice(lineStartOffset, safe), raw.slice(lineStartOffset, safe).length);
  const prevLine = raw.slice(prevLineStart, prevLineEnd);
  return prevLineStart + offsetAtVisualColumn(prevLine, col);
}

function caretLineDown(raw: string, caret: number): number | null {
  const safe = clampGraphemeOffset(raw, caret);
  const nextNl = raw.indexOf("\n", safe);
  if (nextNl === -1) return null;
  const lineStartOffset = raw.lastIndexOf("\n", safe - 1) + 1;
  const col = visualColumnAt(raw.slice(lineStartOffset, safe), raw.slice(lineStartOffset, safe).length);
  const nextLineStart = nextNl + 1;
  const nextNlAfter = raw.indexOf("\n", nextLineStart);
  const nextLineEnd = nextNlAfter === -1 ? raw.length : nextNlAfter;
  const nextLine = raw.slice(nextLineStart, nextLineEnd);
  return nextLineStart + offsetAtVisualColumn(nextLine, col);
}

/**
 * Render a single field's three-row block: top border with title, content
 * row (variable per type), bottom border, then the caption row underneath.
 * Returns one ANSI string per terminal line; the caller joins with `\n`.
 *
 * Exported so the chat-history mirror (inline-form-card) renders fields
 * identically to this overlay — single source of truth for the field shape.
 */
export function renderField(
  field: WorkflowInputEntry,
  raw: string,
  focused: boolean,
  caret: number,
  cursorOn: boolean,
  invalid: string | null,
  theme: GraphTheme,
  width: number,
): string[] {
  // Border + label colour pick. Focused fields use `accent` (blue); a field
  // that's currently flagged as invalid AFTER a submit attempt uses
  // `error` to draw the eye.
  const borderColor = invalid && !focused
    ? theme.error
    : focused
      ? theme.accent
      : theme.borderDim;

  const innerWidth = Math.max(10, width - 4); // 2 chars of border + 1 pad each side
  const top =
    paint("╭ ", borderColor) +
    paint(field.name, focused ? theme.text : theme.textMuted, { bold: focused }) +
    " " +
    paint("─".repeat(Math.max(0, innerWidth - field.name.length - 2)) + "╮", borderColor);
  const bottom = paint("╰" + "─".repeat(innerWidth) + "╯", borderColor);

  // Content row — branch per type.
  const contentInner = renderFieldContent(
    field,
    raw,
    focused,
    caret,
    cursorOn,
    innerWidth,
    theme,
  );
  const lines: string[] = [];
  lines.push(top);
  for (const inner of contentInner) {
    lines.push(paint("│ ", borderColor) + inner + paint(" │", borderColor));
  }
  lines.push(bottom);

  // Caption row — type · required|optional · description / invalid reason.
  // Composed at full length, then ANSI-clipped to the terminal width so it
  // never overflows into a second row regardless of how narrow the terminal
  // gets. On overflow the rightmost cell becomes `…`.
  const tagColour = invalid
    ? theme.error
    : field.required
      ? theme.warning
      : theme.dim;
  const tagLabel = invalid ?? (field.required ? "required" : "optional");
  const caption =
    "  " +
    paint(field.type, theme.dim) +
    dimSep(theme) +
    paint(tagLabel, tagColour) +
    (field.description ? dimSep(theme) + paint(field.description, theme.dim) : "");
  lines.push(truncateToWidth(caption, width, "…", true));
  return lines;
}

/**
 * Return the inner content rows of a field, sized to fit `innerWidth - 2`
 * (the border + padding consume 4 cells total). Text fields are 3 rows
 * tall; all others are a single row.
 */
function renderFieldContent(
  field: WorkflowInputEntry,
  raw: string,
  focused: boolean,
  caret: number,
  cursorOn: boolean,
  innerWidth: number,
  theme: GraphTheme,
): string[] {
  const usable = innerWidth - 2; // padding on both sides

  if (field.type === "select" && field.choices && field.choices.length > 0) {
    const cells = field.choices.map((choice) => {
      const sel = choice === raw;
      const marker = sel ? "●" : "○";
      const markerColor = sel
        ? focused
          ? theme.accent
          : theme.success
        : theme.dim;
      const textColor = sel
        ? focused
          ? theme.text
          : theme.textMuted
        : theme.dim;
      return paint(marker, markerColor) + " " + paint(choice, textColor);
    });
    return [padLine(cells.join("   "), usable)];
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
    return [padLine(onCell + "   " + offCell, usable)];
  }

  if (field.type === "text") {
    // 3-row scrolling textarea — wrap by terminal cell width and keep the
    // cursor's visual row in view. Newlines create hard row breaks.
    const ROWS = 3;
    if (raw === "") {
      return Array.from({ length: ROWS }, (_, i) =>
        i === 0
          ? renderInlineText("", focused, cursorOn, usable, theme, field.placeholder, true)
          : padLine("", usable),
      );
    }
    const layout = layoutEditableText(raw, usable);
    const safeCaret = clampGraphemeOffset(raw, caret);
    let cursorRow = layout.length - 1;
    for (let i = 0; i < layout.length; i++) {
      const line = layout[i]!;
      const next = layout[i + 1];
      if (safeCaret >= line.start && safeCaret < line.end) {
        cursorRow = i;
        break;
      }
      if (safeCaret === line.end) {
        cursorRow = next?.start === safeCaret ? i + 1 : i;
      }
    }
    cursorRow = Math.max(0, Math.min(cursorRow, layout.length - 1));
    const start = focused
      ? Math.max(0, Math.min(cursorRow - ROWS + 1, layout.length - ROWS))
      : Math.max(0, layout.length - ROWS);
    const rows: string[] = [];
    for (let i = 0; i < ROWS; i++) {
      const rowIdx = start + i;
      const line = layout[rowIdx];
      if (!line) {
        rows.push(padLine("", usable));
        continue;
      }
      const lineCaret = safeCaret >= line.start && safeCaret <= line.end
        ? safeCaret - line.start
        : line.text.length;
      rows.push(
        renderInlineText(
          line.text,
          focused && rowIdx === cursorRow,
          cursorOn,
          usable,
          theme,
          field.placeholder,
          false,
          lineCaret,
        ),
      );
    }
    return rows;
  }

  // string / number / integer / default — single-line input.
  return [renderInlineText(raw, focused, cursorOn, usable, theme, field.placeholder, raw === "", caret)];
}

/**
 * Render a single editable line. When `value` is empty and the field is
 * focused, paint a dim placeholder with the cursor sitting on its first
 * character — the readline-style "type to replace" affordance.
 */
function renderInlineText(
  value: string,
  focused: boolean,
  cursorOn: boolean,
  usable: number,
  theme: GraphTheme,
  placeholder: string | undefined,
  isEmpty: boolean,
  caret?: number,
): string {
  const showCursor = focused && cursorOn;
  if (isEmpty) {
    const ph = placeholder ?? "";
    if (ph === "") {
      return padLine(showCursor ? paint("▋", theme.accent) : " ", usable);
    }
    const [first = "", ...rest] = graphemes(ph);
    const head = showCursor
      ? paint(first, theme.bg, { bg: theme.accent })
      : paint(first, theme.dim);
    return padLine(head + paint(rest.join(""), theme.dim), usable);
  }
  const safe = clampGraphemeOffset(value, caret ?? value.length);
  const beforeFull = value.slice(0, safe);
  const afterFull = value.slice(safe);
  const [at = ""] = graphemes(afterFull);
  const afterRest = at === "" ? "" : afterFull.slice(at.length);
  const cursorPlain = showCursor ? (at !== "" ? at : "▋") : at;
  const cursorWidth = Math.max(1, visibleWidth(cursorPlain));
  const totalWidth = visibleWidth(beforeFull) + cursorWidth + visibleWidth(showCursor ? afterRest : afterFull.slice(at.length));
  let before = beforeFull;
  let after = showCursor ? afterRest : afterFull.slice(at.length);
  if (totalWidth > usable) {
    before = tailToWidth(beforeFull, Math.max(0, usable - cursorWidth));
    after = headToWidth(showCursor ? afterRest : afterFull.slice(at.length), Math.max(0, usable - visibleWidth(before) - cursorWidth));
  }
  const cursorCell = showCursor
    ? at !== ""
      ? paint(at, theme.bg, { bg: theme.accent })
      : paint("▋", theme.accent)
    : paint(at, theme.text);
  return padLine(paint(before, theme.text) + cursorCell + paint(after, theme.text), usable);
}

function padLine(s: string, usable: number): string {
  // The caller appends `│` immediately after this string, so the row must
  // fill exactly `usable` cells of visible width — otherwise the right
  // border slides leftward and the field card looks broken-narrow under a
  // full-width top/bottom border. Pad short content; clip overflow with `…`.
  // visibleWidth/truncateToWidth are width-correct for CJK/emoji glyphs.
  const len = visibleWidth(s);
  if (len === usable) return s;
  if (len < usable) return s + " ".repeat(usable - len);
  return truncateToWidth(s, usable, "…", true);
}

function fitLine(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "…", true);
}

function renderPickerHeader(
  fields: readonly WorkflowInputEntry[],
  state: InputsPickerState,
  theme: GraphTheme,
  width: number,
): string[] {
  return [
    renderPickerRule(theme, width),
    renderInputTabBar(fields, state, theme, width),
    "",
  ];
}

function renderPickerRule(theme: GraphTheme, width: number): string {
  return paint("─".repeat(Math.max(1, width)), theme.accent);
}

function renderInputTabBar(
  fields: readonly WorkflowInputEntry[],
  state: InputsPickerState,
  theme: GraphTheme,
  width: number,
): string {
  const pieces: string[] = [" ← "];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    const raw = state.rawText[field.name] ?? "";
    const valid = invalidForField(field, raw, i) === null;
    const box = valid ? "■" : "□";
    const rawSeg = ` ${box} ${field.name} `;
    const styled = i === state.focusedIdx
      ? paint(rawSeg, theme.text, { bg: theme.selection, bold: true })
      : paint(rawSeg, valid ? theme.success : theme.dim);
    pieces.push(styled, " ");
  }
  const allValid = fields.every((field, i) => invalidForField(field, state.rawText[field.name] ?? "", i) === null);
  const submitText = " ✓ Submit ";
  const submitStyled = state.focusedIdx === fields.length
    ? paint(submitText, theme.text, { bg: theme.selection, bold: true })
    : paint(submitText, allValid ? theme.success : theme.dim);
  pieces.push(submitStyled, " →");
  return truncateToWidth(pieces.join(""), width, "", true);
}

function renderActiveInputField(
  field: WorkflowInputEntry,
  raw: string,
  caret: number,
  cursorOn: boolean,
  invalid: string | null,
  theme: GraphTheme,
  width: number,
): string[] {
  const heading = field.description && field.description.length > 0 ? field.description : field.name;
  const lines = wrapPlainText(heading, width).map((line) => paint(line, theme.text, { bold: true }));
  if (invalid) {
    lines.push(...wrapPlainText(invalid, width).map((line) => paint(line, theme.error)));
  }
  lines.push("", ...renderAskStyleInputBody(field, raw, caret, cursorOn, theme, width));
  return lines;
}

function renderAskStyleInputBody(
  field: WorkflowInputEntry,
  raw: string,
  caret: number,
  cursorOn: boolean,
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

  return renderAskInputRows(field, raw, caret, cursorOn, theme, width);
}

function renderAskInputRows(
  field: WorkflowInputEntry,
  raw: string,
  caret: number,
  cursorOn: boolean,
  theme: GraphTheme,
  width: number,
): string[] {
  const prefix = "❯ 1. ";
  const styledPrefix = paint(prefix, theme.accent);
  const continuationPrefix = " ".repeat(visibleWidth(prefix));
  const usable = Math.max(1, width - visibleWidth(prefix));

  if (field.type !== "text") {
    return [styledPrefix + renderInlineText(raw, true, cursorOn, usable, theme, field.placeholder, raw === "", caret)];
  }

  const ROWS = 3;
  if (raw === "") {
    return [
      styledPrefix + renderInlineText("", true, cursorOn, usable, theme, field.placeholder, true),
      ...Array.from({ length: ROWS - 1 }, () => continuationPrefix + padLine("", usable)),
    ];
  }

  const layout = layoutEditableText(raw, usable);
  const safeCaret = clampGraphemeOffset(raw, caret);
  let cursorRow = layout.length - 1;
  for (let i = 0; i < layout.length; i++) {
    const line = layout[i]!;
    const next = layout[i + 1];
    if (safeCaret >= line.start && safeCaret < line.end) {
      cursorRow = i;
      break;
    }
    if (safeCaret === line.end) {
      cursorRow = next?.start === safeCaret ? i + 1 : i;
    }
  }
  cursorRow = Math.max(0, Math.min(cursorRow, layout.length - 1));
  const start = Math.max(0, Math.min(cursorRow - ROWS + 1, layout.length - ROWS));
  const rows: string[] = [];
  for (let i = 0; i < ROWS; i++) {
    const rowIdx = start + i;
    const line = layout[rowIdx];
    const rowPrefix = rowIdx === 0 ? styledPrefix : continuationPrefix;
    if (!line) {
      rows.push(rowPrefix + padLine("", usable));
      continue;
    }
    const lineCaret = safeCaret >= line.start && safeCaret <= line.end
      ? safeCaret - line.start
      : line.text.length;
    rows.push(
      rowPrefix +
        renderInlineText(
          line.text,
          rowIdx === cursorRow,
          cursorOn,
          usable,
          theme,
          field.placeholder,
          false,
          lineCaret,
        ),
    );
  }
  return rows;
}

export function renderInputsPicker(opts: InputsPickerRenderOpts): string[] {
  const { theme, workflowName, fields, state, width, cursorOn } = opts;
  const lines: string[] = [];

  lines.push(...renderPickerHeader(fields, state, theme, width));

  const activeField = fields[state.focusedIdx];
  if (activeField) {
    const raw = state.rawText[activeField.name] ?? "";
    const invalid = state.invalidIndices.includes(state.focusedIdx)
      ? invalidForField(activeField, raw, state.focusedIdx)
      : null;
    lines.push(...renderActiveInputField(activeField, raw, state.caret, cursorOn, invalid, theme, width));
    lines.push("");
  } else {
    lines.push(...renderSubmitReview({ workflowName, fields, rawText: state.rawText, theme, width }));
    lines.push("");
  }

  lines.push(renderPickerRule(theme, width));
  if (state.focusedIdx === fields.length) {
    lines.push(...renderSubmitControls(fields, state, theme, width));
  } else {
    lines.push(renderFooterHints(width, theme));
  }

  return lines.map((line) => fitLine(line, width));
}

/** Footer hint copied from ask_user_question, with workflow-specific tab copy. */
function renderFooterHints(width: number, theme: GraphTheme): string {
  return renderWorkflowFormFooterHints(theme, width);
}

function renderSubmitControls(
  fields: readonly WorkflowInputEntry[],
  state: InputsPickerState,
  theme: GraphTheme,
  width: number,
): string[] {
  const invalid = computeInvalid(fields, state.rawText);
  return renderSharedSubmitControls({
    invalidFieldNames: invalid.map((i) => fields[i]!.name),
    submitChoiceIdx: state.submitChoiceIdx,
    theme,
    width,
  });
}

// ---------------------------------------------------------------------------
// Key handler
// ---------------------------------------------------------------------------

/**
 * Drive the picker. The caller (overlay adapter) feeds raw keystrokes here
 * and reacts to the returned action: `noop` keeps the overlay mounted,
 * `cancel` tears it down with no result, `run` tears it down and resolves
 * with the coerced typed value map.
 *
 * Keys (form mode):
 *   tab              — switch input fields and the Submit section
 *   shift+tab        — previous input field / Submit section
 *   left / right     — select: cycle choices; boolean: flip; text: caret
 *   space            — boolean: flip
 *   enter            — text: newline; otherwise: next field
 *   backspace        — delete char left of caret
 *   esc / ctrl+c     — close picker without running
 *
 * Keys (Submit pane):
 *   up / down        — move between Submit answers and Cancel rows
 *   1                — submit immediately, or focus the first invalid field
 *   2                — cancel immediately without requiring Enter
 *   enter            — commit the active Submit/Cancel row
 */
export function handleInputsPickerInput(
  key: string,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
  keybindings?: KeybindingsLike,
): InputsPickerAction {
  if (fields.length === 0) {
    // Defensive: a workflow with zero declared inputs shouldn't reach the
    // picker (we gate on `fields.length > 0` at the open() site), but if
    // it does, treat any keystroke as a noop and let the host close us.
    if (isCancelKey(key)) return { kind: "cancel" };
    return { kind: "noop" };
  }
  return handleFormKey(key, state, fields, keybindings);
}

function handleFormKey(
  key: string,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
  kb: KeybindingsLike | undefined,
): InputsPickerAction {
  // ── Global navigation (workflow form contract, not Pi actions) ──
  if (isCancelKey(key)) return { kind: "cancel" };
  if (matchesKey(key, Key.tab)) {
    moveFocus(state, fields, +1);
    return { kind: "noop" };
  }
  if (matchesKey(key, Key.shift("tab"))) {
    moveFocus(state, fields, -1);
    return { kind: "noop" };
  }
  if (state.focusedIdx === fields.length) return handleSubmitKey(key, state, fields, kb);

  const field = fields[state.focusedIdx]!;
  const name = field.name;
  const cur = state.rawText[name] ?? "";

  // ── Per-type edits ──
  if (field.type === "select") {
    return handleSelectKey(key, field, state, fields, kb);
  }
  if (field.type === "boolean") {
    return handleBooleanKey(key, field, state, fields, kb);
  }

  // string / text / number — text editing semantics. All editor-mode keys
  // (cursor, word jump, line jump, deletions) route through Pi's
  // KeybindingsManager so user-configured bindings work uniformly.
  const caret = Math.max(0, Math.min(state.caret, cur.length));

  if (matchesAction(kb, key, TUI_ACTION.editorCursorUp)) {
    if (field.type === "text") {
      const nextCaret = caretLineUp(cur, caret);
      if (nextCaret !== null) {
        state.caret = nextCaret;
        return { kind: "noop" };
      }
    }
    moveFocus(state, fields, -1);
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, TUI_ACTION.editorCursorDown)) {
    if (field.type === "text") {
      const nextCaret = caretLineDown(cur, caret);
      if (nextCaret !== null) {
        state.caret = nextCaret;
        return { kind: "noop" };
      }
    }
    moveFocus(state, fields, +1);
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.cursorWordLeft")) {
    state.caret = wordLeft(cur, caret);
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.cursorWordRight")) {
    state.caret = wordRight(cur, caret);
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.cursorLineStart")) {
    state.caret = lineStart(cur, caret);
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.cursorLineEnd")) {
    state.caret = lineEnd(cur, caret);
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, TUI_ACTION.editorCursorLeft)) {
    state.caret = previousGraphemeOffset(cur, caret);
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, TUI_ACTION.editorCursorRight)) {
    state.caret = nextGraphemeOffset(cur, caret);
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.deleteWordBackward")) {
    const start = wordLeft(cur, caret);
    const r = deleteRange(cur, start, caret, caret);
    state.rawText[name] = r.text;
    state.caret = r.caret;
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.deleteWordForward")) {
    const end = wordRight(cur, caret);
    const r = deleteRange(cur, caret, end, caret);
    state.rawText[name] = r.text;
    state.caret = r.caret;
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.deleteToLineStart")) {
    const start = lineStart(cur, caret);
    const r = deleteRange(cur, start, caret, caret);
    state.rawText[name] = r.text;
    state.caret = r.caret;
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.deleteToLineEnd")) {
    const end = lineEnd(cur, caret);
    const r = deleteRange(cur, caret, end, caret);
    state.rawText[name] = r.text;
    state.caret = r.caret;
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.deleteCharBackward")) {
    if (caret > 0) {
      const r = deleteRange(cur, previousGraphemeOffset(cur, caret), caret, caret);
      state.rawText[name] = r.text;
      state.caret = r.caret;
    }
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, "tui.editor.deleteCharForward")) {
    if (caret < cur.length) {
      const r = deleteRange(cur, caret, nextGraphemeOffset(cur, caret), caret);
      state.rawText[name] = r.text;
      state.caret = r.caret;
    }
    return { kind: "noop" };
  }
  if (
    matchesAction(kb, key, TUI_ACTION.inputSubmit) ||
    matchesAction(kb, key, "tui.input.newLine")
  ) {
    if (field.type === "text") {
      state.rawText[name] = cur.slice(0, caret) + "\n" + cur.slice(caret);
      state.caret = caret + 1;
    } else {
      moveFocus(state, fields, +1);
    }
    return { kind: "noop" };
  }
  // Printable insert. Accept raw graphemes and terminal-encoded printable
  // keys (CSI-u / Kitty). VSCode's integrated terminal can emit printable
  // keys as escape sequences when modifyOtherKeys is active.
  const printable = decodePrintableKey(key) ?? key;
  if (isPrintableGrapheme(printable)) {
    state.rawText[name] = cur.slice(0, caret) + printable + cur.slice(caret);
    state.caret = caret + printable.length;
    return { kind: "noop" };
  }
  return { kind: "noop" };
}

function handleSelectKey(
  key: string,
  field: WorkflowInputEntry,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
  kb: KeybindingsLike | undefined,
): InputsPickerAction {
  const choices = field.choices ?? [];
  if (choices.length === 0) return { kind: "noop" };
  const current = state.rawText[field.name] ?? choices[0]!;
  const idx = Math.max(0, choices.indexOf(current));
  if (matchesAction(kb, key, TUI_ACTION.selectUp) || matchesAction(kb, key, TUI_ACTION.editorCursorLeft)) {
    state.rawText[field.name] = choices[(idx - 1 + choices.length) % choices.length]!;
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, TUI_ACTION.selectDown) || matchesAction(kb, key, TUI_ACTION.editorCursorRight)) {
    state.rawText[field.name] = choices[(idx + 1) % choices.length]!;
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, TUI_ACTION.selectConfirm) || matchesAction(kb, key, TUI_ACTION.inputSubmit)) {
    moveFocus(state, fields, +1);
    return { kind: "noop" };
  }
  return { kind: "noop" };
}

function handleBooleanKey(
  key: string,
  field: WorkflowInputEntry,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
  kb: KeybindingsLike | undefined,
): InputsPickerAction {
  if (
    matchesKey(key, Key.space) ||
    matchesAction(kb, key, TUI_ACTION.selectUp) ||
    matchesAction(kb, key, TUI_ACTION.selectDown) ||
    matchesAction(kb, key, TUI_ACTION.editorCursorLeft) ||
    matchesAction(kb, key, TUI_ACTION.editorCursorRight)
  ) {
    state.rawText[field.name] = state.rawText[field.name] === "true" ? "false" : "true";
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, TUI_ACTION.selectConfirm) || matchesAction(kb, key, TUI_ACTION.inputSubmit)) {
    moveFocus(state, fields, +1);
    return { kind: "noop" };
  }
  return { kind: "noop" };
}

function handleSubmitKey(
  key: string,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
  kb: KeybindingsLike | undefined,
): InputsPickerAction {
  if (matchesAction(kb, key, TUI_ACTION.selectUp) || matchesAction(kb, key, TUI_ACTION.editorCursorUp)) {
    state.submitChoiceIdx = 1 - state.submitChoiceIdx;
    return { kind: "noop" };
  }
  if (matchesAction(kb, key, TUI_ACTION.selectDown) || matchesAction(kb, key, TUI_ACTION.editorCursorDown)) {
    state.submitChoiceIdx = (state.submitChoiceIdx + 1) % 2;
    return { kind: "noop" };
  }
  if (matchesKey(key, "1")) {
    state.submitChoiceIdx = 0;
    return attemptPickerSubmit(state, fields);
  }
  if (matchesKey(key, "2")) {
    state.submitChoiceIdx = 1;
    return { kind: "cancel" };
  }
  if (
    matchesKey(key, Key.enter) ||
    matchesAction(kb, key, TUI_ACTION.selectConfirm) ||
    matchesAction(kb, key, TUI_ACTION.inputSubmit)
  ) {
    return state.submitChoiceIdx === 0 ? attemptPickerSubmit(state, fields) : { kind: "cancel" };
  }
  return { kind: "noop" };
}

function isCancelKey(key: string): boolean {
  return matchesKey(key, Key.ctrl("c")) || matchesKey(key, Key.escape);
}

function attemptPickerSubmit(
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
): InputsPickerAction {
  const invalid = computeInvalid(fields, state.rawText);
  if (invalid.length > 0) {
    state.invalidIndices = invalid;
    state.submitChoiceIdx = 0;
    state.focusedIdx = invalid[0]!;
    state.caret = (state.rawText[fields[state.focusedIdx]!.name] ?? "").length;
    return { kind: "noop" };
  }
  state.invalidIndices = [];
  return { kind: "run", values: coerceValues(fields, state.rawText) };
}

function moveFocus(
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
  delta: number,
): void {
  const n = fields.length + 1;
  if (n <= 1) return;
  state.focusedIdx = (state.focusedIdx + delta + n) % n;
  if (state.focusedIdx === fields.length) {
    state.caret = 0;
    state.submitChoiceIdx = 0;
    return;
  }
  const next = fields[state.focusedIdx]!;
  state.caret = (state.rawText[next.name] ?? "").length;
}
