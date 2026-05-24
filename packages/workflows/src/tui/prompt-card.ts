/**
 * HIL prompt card — rendered inside the graph viewer overlay when a
 * background workflow recorded a `PendingPrompt` on the current run.
 *
 * Purely functional: state lives in `PromptCardState`, rendering is a pure
 * function of state, and key handling returns a discriminated action that
 * the overlay translates into `store.resolvePendingPrompt`.
 *
 * Visual identity matches the Catppuccin Mocha picker-row vocabulary:
 *
 *   ╭ AWAITING INPUT ───────────────────────────────╮
 *   │                                               │
 *   │  <message>                                    │
 *   │                                               │
 *   │  ╭ response ─────────────────────────────╮    │
 *   │  │ <text input / choice cycler>          │    │
 *   │  ╰───────────────────────────────────────╯    │
 *   │                                               │
 *   │  ↵ submit · esc skip                          │
 *   ╰───────────────────────────────────────────────╯
 *
 * cross-ref:
 *   src/shared/store-types.ts PendingPrompt
 *   src/tui/inputs-picker.ts  picker field shape (visual sibling)
 *   src/tui/graph-view.ts     overlay integration + key routing
 */

import { keyHint, keyText, rawKeyHint } from "@bastani/atomic";
import {
  SelectList,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type SelectItem,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import type { PendingPrompt } from "../shared/store-types.js";
import type { GraphTheme } from "./graph-theme.js";
import { hexToAnsi, hexBg, paint, RESET, BOLD } from "./color-utils.js";
import { Key, matchesKey } from "./text-helpers.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Mutable working state for an active prompt card. One per overlay; replaced
 * via `createPromptCardState(prompt)` whenever the run's pending prompt
 * changes identity (different `prompt.id`).
 */
export interface PromptCardState {
  readonly prompt: PendingPrompt;
  /** Raw text buffer for `input`/`editor` prompts. */
  rawText: string;
  /** Caret position within `rawText` (in characters, not visual cells). */
  caret: number;
  /** Selected index for `select` prompts (offset into `prompt.choices`). */
  selectedIndex: number;
  /** Boolean selection for `confirm` prompts (true = yes, false = no). */
  confirmValue: boolean;
  /** For multi-line editor prompts, Tab moves focus to a visible Submit action. */
  editorSubmitFocused: boolean;
}

export function createPromptCardState(prompt: PendingPrompt): PromptCardState {
  const initial = prompt.initial ?? "";
  return {
    prompt,
    rawText: initial,
    caret: initial.length,
    selectedIndex: 0,
    confirmValue: false,
    editorSubmitFocused: false,
  };
}

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

/** Action returned by `handlePromptCardInput`. */
export type PromptCardAction =
  | { kind: "noop" }
  /** User submitted — `response` already shaped to match the prompt's kind. */
  | { kind: "submit"; response: unknown }
  /**
   * User dismissed without responding. Caller decides what to do — for HIL
   * we forward a kind-appropriate default to `store.resolvePendingPrompt`
   * so the workflow body resumes (rather than hanging).
   */
  | { kind: "cancel" };

/**
 * Drive the prompt card with a raw keystroke. Returns a discriminated action
 * that the overlay maps to a store mutation. `cancel` lets the workflow
 * continue with a safe default rather than orphaning the awaiter.
 */
export function handlePromptCardInput(
  data: string,
  state: PromptCardState,
): PromptCardAction {
  if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.escape)) {
    return { kind: "cancel" };
  }

  switch (state.prompt.kind) {
    case "confirm":
      return handleConfirm(data, state);
    case "select":
      return handleSelect(data, state);
    case "input":
      return handleInput(data, state);
    case "editor":
      return handleEditor(data, state);
  }
}

function handleConfirm(
  data: string,
  state: PromptCardState,
): PromptCardAction {
  if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.space) || matchesKey(data, Key.tab)) {
    state.confirmValue = !state.confirmValue;
    return { kind: "noop" };
  }
  if (matchesKey(data, "y") || matchesKey(data, Key.shift("y"))) {
    return { kind: "submit", response: true };
  }
  if (matchesKey(data, "n") || matchesKey(data, Key.shift("n"))) {
    return { kind: "submit", response: false };
  }
  if (matchesKey(data, Key.enter)) {
    return { kind: "submit", response: state.confirmValue };
  }
  return { kind: "noop" };
}

function handleSelect(data: string, state: PromptCardState): PromptCardAction {
  const choices = state.prompt.choices ?? [];
  if (choices.length === 0) {
    if (matchesKey(data, Key.enter)) {
      return { kind: "submit", response: "" };
    }
    return { kind: "noop" };
  }

  let action: PromptCardAction = { kind: "noop" };
  const list = createPromptSelectList(state);
  list.onSelect = (item) => {
    const idx = Number(item.value);
    action = { kind: "submit", response: choices[idx] ?? choices[0] };
  };
  list.handleInput(normalizeSelectKeyData(data));
  return action;
}

function handleInput(data: string, state: PromptCardState): PromptCardAction {
  if (matchesKey(data, Key.enter)) {
    return { kind: "submit", response: state.rawText };
  }
  return applyTextEdit(data, state);
}

function handleEditor(data: string, state: PromptCardState): PromptCardAction {
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
    state.editorSubmitFocused = !state.editorSubmitFocused;
    return { kind: "noop" };
  }
  if (state.editorSubmitFocused) {
    if (matchesKey(data, Key.enter)) {
      return { kind: "submit", response: state.rawText };
    }
    return { kind: "noop" };
  }
  if (matchesKey(data, Key.enter)) {
    state.rawText = state.rawText.slice(0, state.caret) + "\n" + state.rawText.slice(state.caret);
    state.caret += 1;
    return { kind: "noop" };
  }
  return applyTextEdit(data, state);
}

function applyTextEdit(
  data: string,
  state: PromptCardState,
): PromptCardAction {
  if (matchesKey(data, Key.left)) {
    state.caret = previousGraphemeBoundary(state.rawText, state.caret);
    return { kind: "noop" };
  }
  if (matchesKey(data, Key.right)) {
    state.caret = nextGraphemeBoundary(state.rawText, state.caret);
    return { kind: "noop" };
  }
  if (matchesKey(data, Key.backspace)) {
    if (state.caret > 0) {
      const prev = previousGraphemeBoundary(state.rawText, state.caret);
      state.rawText = state.rawText.slice(0, prev) + state.rawText.slice(state.caret);
      state.caret = prev;
    }
    return { kind: "noop" };
  }
  if (isPrintableText(data)) {
    state.rawText =
      state.rawText.slice(0, state.caret) + data + state.rawText.slice(state.caret);
    state.caret += data.length;
    return { kind: "noop" };
  }
  return { kind: "noop" };
}

interface GraphemePart {
  text: string;
  start: number;
  end: number;
  width: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemeParts(value: string): GraphemePart[] {
  const parts: GraphemePart[] = [];
  for (const segment of segmenter.segment(value)) {
    const text = segment.segment;
    parts.push({
      text,
      start: segment.index,
      end: segment.index + text.length,
      width: visibleWidth(text),
    });
  }
  return parts;
}

function previousGraphemeBoundary(value: string, caret: number): number {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  let prev = 0;
  for (const part of graphemeParts(value)) {
    if (part.start >= safeCaret) break;
    prev = part.start;
  }
  return prev;
}

function nextGraphemeBoundary(value: string, caret: number): number {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  for (const part of graphemeParts(value)) {
    if (part.end > safeCaret) return part.end;
  }
  return value.length;
}

function isPrintableText(data: string): boolean {
  return data.length > 0 && !data.startsWith("\x1b") && !/[\x00-\x1f\x7f]/.test(data);
}

/**
 * Compute the safe default response when the user dismisses the prompt.
 * Used by the overlay to keep the workflow body unblocked even on cancel.
 */
export function defaultResponseFor(prompt: PendingPrompt): unknown {
  switch (prompt.kind) {
    case "input":
    case "editor":
      return prompt.initial ?? "";
    case "confirm":
      return false;
    case "select":
      return prompt.choices?.[0] ?? "";
  }
}

// ---------------------------------------------------------------------------
// Select-list bridge
// ---------------------------------------------------------------------------

function createPromptSelectList(
  state: PromptCardState,
  theme?: GraphTheme,
  maxVisible = 5,
): SelectList {
  const choices = state.prompt.choices ?? [];
  const items: SelectItem[] = choices.map((choice, idx) => ({
    value: String(idx),
    label: choice,
  }));
  const list = new SelectList(
    items,
    Math.max(1, Math.min(maxVisible, choices.length || 1)),
    createSelectListTheme(theme),
    {
      minPrimaryColumnWidth: 1,
      maxPrimaryColumnWidth: 80,
      truncatePrimary: ({ text, maxWidth, isSelected }) => {
        const clipped = truncateToWidth(text, maxWidth, "");
        if (!theme) return clipped;
        return paint(clipped, isSelected ? theme.text : theme.dim, { bold: isSelected });
      },
    },
  );
  const selectedIndex = normalizeSelectIndex(state.selectedIndex, choices.length);
  list.setSelectedIndex(selectedIndex);
  list.onSelectionChange = (item) => {
    state.selectedIndex = normalizeSelectIndex(Number(item.value), choices.length);
  };
  return list;
}

function createSelectListTheme(theme?: GraphTheme): SelectListTheme {
  if (!theme) {
    return {
      selectedPrefix: (text) => text,
      selectedText: (text) => text,
      description: (text) => text,
      scrollInfo: (text) => text,
      noMatch: (text) => text,
    };
  }
  return {
    selectedPrefix: (text) => paint(text, theme.accent, { bold: true }),
    selectedText: (text) => paint(text, theme.text, { bold: true }),
    description: (text) => paint(text, theme.textMuted),
    scrollInfo: (text) => paint(text, theme.dim),
    noMatch: (text) => paint(text, theme.dim),
  };
}

function normalizeSelectIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  const n = Number.isFinite(index) ? Math.trunc(index) : 0;
  return ((n % length) + length) % length;
}

function normalizeSelectKeyData(data: string): string {
  // The historical prompt card accepted left/right as select aliases; feed the
  // corresponding vertical key into pi-tui's SelectList so it owns the actual
  // wrap/clamp/selection update behavior.
  if (matchesKey(data, Key.right)) return "\x1b[B";
  if (matchesKey(data, Key.left)) return "\x1b[A";
  return data;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface PromptCardRenderOpts {
  readonly state: PromptCardState;
  readonly theme: GraphTheme;
  readonly width: number;
  readonly cursorOn: boolean;
}

/**
 * Render the prompt card as a list of width-safe ANSI lines, suitable to
 * paint over the graph body inside the overlay.
 */
export function renderPromptCard(opts: PromptCardRenderOpts): string[] {
  const { state, theme, width } = opts;
  const innerWidth = Math.max(20, width - 2);
  const accent = theme.accent;
  const borderColor = accent;
  const bg = hexBg(theme.backgroundPanel);

  const lines: string[] = [];
  lines.push(makeBorderTop(borderColor, " AWAITING INPUT ", theme, innerWidth, bg));
  lines.push(makePaddedRow(bg, borderColor, innerWidth, ""));
  for (const messageLine of wrapText(state.prompt.message, innerWidth - 4)) {
    lines.push(
      makePaddedRow(bg, borderColor, innerWidth, "  " + paint(messageLine, theme.text)),
    );
  }
  lines.push(makePaddedRow(bg, borderColor, innerWidth, ""));

  const fieldLines = renderResponseFieldBox(state, theme, innerWidth - 4, opts.cursorOn);
  for (const fl of fieldLines) {
    lines.push(makePaddedRow(bg, borderColor, innerWidth, "  " + fl));
  }

  lines.push(makePaddedRow(bg, borderColor, innerWidth, ""));
  lines.push(makePaddedRow(bg, borderColor, innerWidth, "  " + renderHints(state.prompt.kind, theme)));
  lines.push(makeBorderBottom(borderColor, innerWidth, bg));
  return lines;
}

function makeBorderTop(
  color: string,
  label: string,
  theme: GraphTheme,
  innerWidth: number,
  bg: string,
): string {
  const labelText = paint(label, theme.text, { bold: true });
  const labelW = visibleWidth(labelText);
  const fillLen = Math.max(0, innerWidth - labelW - 2);
  return (
    bg +
    paint("╭", color) +
    labelText +
    paint("─".repeat(fillLen) + "╮", color) +
    RESET
  );
}

function makeBorderBottom(color: string, innerWidth: number, bg: string): string {
  return bg + paint("╰" + "─".repeat(innerWidth) + "╯", color) + RESET;
}

function makePaddedRow(
  bg: string,
  borderColor: string,
  innerWidth: number,
  content: string,
): string {
  const contentW = visibleWidth(content);
  const pad = Math.max(0, innerWidth - contentW);
  const padded = content + " ".repeat(pad);
  const clipped = truncateToWidth(padded, innerWidth, "", true);
  return bg + paint("│", borderColor) + clipped + paint("│", borderColor) + RESET;
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  return wrapTextWithAnsi(text, width);
}

function renderResponseFieldBox(
  state: PromptCardState,
  theme: GraphTheme,
  usable: number,
  cursorOn: boolean,
): string[] {
  const boxWidth = Math.max(4, usable);
  const contentWidth = Math.max(1, boxWidth - 2);
  const borderColor = theme.accent;
  const label = " response ";
  const labelText = paint(label, theme.textMuted, { bold: true });
  const labelW = visibleWidth(labelText);
  const topFill = Math.max(0, boxWidth - labelW - 2);
  const rows = renderResponseField(state, theme, contentWidth, cursorOn);
  return [
    paint("╭", borderColor) + labelText + paint("─".repeat(topFill) + "╮", borderColor),
    ...rows.map((row) => makeFieldRow(row, contentWidth, borderColor)),
    paint("╰" + "─".repeat(Math.max(0, boxWidth - 2)) + "╯", borderColor),
  ];
}

function makeFieldRow(content: string, width: number, borderColor: string): string {
  const clipped = truncateToWidth(content, width, "", true);
  const padded = clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  return paint("│", borderColor) + padded + paint("│", borderColor);
}

function renderResponseField(
  state: PromptCardState,
  theme: GraphTheme,
  usable: number,
  cursorOn: boolean,
): string[] {
  switch (state.prompt.kind) {
    case "confirm":
      return [renderConfirmRow(state, theme, usable)];
    case "select":
      return renderSelectRows(state, theme, usable);
    case "input":
      return [renderInputRow(state, theme, usable, cursorOn)];
    case "editor":
      return renderEditorRows(state, theme, usable, cursorOn);
  }
}

function renderConfirmRow(
  state: PromptCardState,
  theme: GraphTheme,
  usable: number,
): string {
  const yes = state.confirmValue;
  const onCell =
    paint(yes ? "●" : "○", yes ? theme.success : theme.dim) +
    " " +
    paint("yes", yes ? theme.text : theme.dim, { bold: yes });
  const offCell =
    paint(!yes ? "●" : "○", !yes ? theme.error : theme.dim) +
    " " +
    paint("no", !yes ? theme.text : theme.dim, { bold: !yes });
  const row = onCell + "    " + offCell;
  return padToUsable(row, usable);
}

function renderSelectRows(
  state: PromptCardState,
  theme: GraphTheme,
  usable: number,
): string[] {
  const choices = state.prompt.choices ?? [];
  if (choices.length === 0) {
    return [padToUsable(paint("(no choices)", theme.dim), usable)];
  }
  const maxVisible = Math.min(5, choices.length);
  const list = createPromptSelectList(state, theme, maxVisible);
  return list.render(usable).map((line) => padToUsable(line, usable));
}

function renderInputRow(
  state: PromptCardState,
  theme: GraphTheme,
  usable: number,
  cursorOn: boolean,
): string {
  const value = state.rawText;
  const inner = usable - 2; // room for the "❯ " prompt prefix
  const visible = clipToCaretWindow(value, state.caret, inner);
  const withCursor = drawCursor(visible.text, visible.caret, cursorOn, theme);
  return padToUsable(paint("❯ ", theme.accent) + withCursor, usable);
}

function renderEditorRows(
  state: PromptCardState,
  theme: GraphTheme,
  usable: number,
  cursorOn: boolean,
): string[] {
  const ROWS = 5;
  const allLines = state.rawText.split("\n");
  // Find the line + column the caret currently sits on.
  let acc = 0;
  let caretLine = 0;
  let caretCol = 0;
  for (let i = 0; i < allLines.length; i++) {
    const len = allLines[i]!.length;
    if (state.caret <= acc + len) {
      caretLine = i;
      caretCol = state.caret - acc;
      break;
    }
    acc += len + 1; // +1 for the newline
    caretLine = i + 1;
    caretCol = 0;
  }
  const start = Math.max(0, Math.min(caretLine - Math.floor(ROWS / 2), allLines.length - ROWS));
  const safeStart = Math.max(0, start);
  const rows: string[] = [];
  for (let i = 0; i < ROWS; i++) {
    const lineIdx = safeStart + i;
    const lineText = allLines[lineIdx] ?? "";
    const isCaretLine = !state.editorSubmitFocused && lineIdx === caretLine;
    const inner = usable - 2;
    const clipped = clipToCaretWindow(lineText, isCaretLine ? caretCol : Math.min(caretCol, lineText.length), inner);
    const withCursor = isCaretLine
      ? drawCursor(clipped.text, clipped.caret, cursorOn, theme)
      : paint(clipped.text, theme.text);
    const prefix = paint(isCaretLine ? "❯ " : "  ", isCaretLine ? theme.accent : theme.dim);
    rows.push(padToUsable(prefix + withCursor, usable));
  }
  rows.push(padToUsable(renderEditorSubmitAction(state.editorSubmitFocused, theme), usable));
  return rows;
}

function renderEditorSubmitAction(focused: boolean, theme: GraphTheme): string {
  const marker = focused ? "❯" : "○";
  return (
    paint(marker, focused ? theme.accent : theme.dim, { bold: focused }) +
    " " +
    paint("Submit response", focused ? theme.text : theme.textMuted, { bold: focused }) +
    paint("  ·  ", theme.dim) +
    graphKeyHint("tui.input.submit", "submit", theme)
  );
}

function clipToCaretWindow(
  value: string,
  caret: number,
  windowWidth: number,
): { text: string; caret: number } {
  if (windowWidth <= 0) return { text: "", caret: 0 };
  if (visibleWidth(value) <= windowWidth) {
    return { text: value, caret: Math.max(0, Math.min(caret, value.length)) };
  }

  const parts = graphemeParts(value);
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const caretPartIndex = parts.findIndex((part) => part.end > safeCaret);
  const caretIndex = caretPartIndex === -1 ? parts.length : caretPartIndex;

  // Keep the caret visible and bias toward a few cells of look-ahead, matching
  // the old tail-biased input field while slicing on grapheme/cell boundaries.
  let start = caretIndex;
  let end = caretIndex;
  let cells = 0;
  const lookAheadCells = Math.min(4, windowWidth);
  while (end < parts.length && (cells < lookAheadCells || start === end)) {
    const width = Math.max(1, parts[end]!.width);
    if (cells > 0 && cells + width > windowWidth) break;
    cells += width;
    end += 1;
  }
  while (start > 0) {
    const width = Math.max(1, parts[start - 1]!.width);
    if (cells > 0 && cells + width > windowWidth) break;
    cells += width;
    start -= 1;
  }
  while (end < parts.length) {
    const width = Math.max(1, parts[end]!.width);
    if (cells > 0 && cells + width > windowWidth) break;
    cells += width;
    end += 1;
  }

  const textStart = parts[start]?.start ?? 0;
  const textEnd = parts[end - 1]?.end ?? textStart;
  return {
    text: value.slice(textStart, textEnd),
    caret: Math.max(0, Math.min(safeCaret - textStart, textEnd - textStart)),
  };
}

function drawCursor(
  text: string,
  caret: number,
  cursorOn: boolean,
  theme: GraphTheme,
): string {
  const parts = graphemeParts(text);
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const caretPartIndex = parts.findIndex((part) => part.end > safeCaret);
  const cursorPart = caretPartIndex === -1 ? undefined : parts[caretPartIndex];
  const cursorStart = cursorPart?.start ?? text.length;
  const cursorEnd = cursorPart?.end ?? text.length;
  const before = text.slice(0, cursorStart);
  const at = cursorPart?.text ?? " ";
  const after = text.slice(cursorEnd);
  const beforeFx = paint(before, theme.text);
  const afterFx = paint(after, theme.text);
  if (!cursorOn) return beforeFx + paint(at, theme.text) + afterFx;
  const cursorFg = hexToAnsi(theme.backgroundPanel);
  const cursorBg = hexBg(theme.accent);
  return beforeFx + cursorBg + cursorFg + BOLD + at + RESET + afterFx;
}

function padToUsable(content: string, usable: number): string {
  const w = visibleWidth(content);
  if (w >= usable) return truncateToWidth(content, usable, "", true);
  return content + " ".repeat(usable - w);
}

type CodingAgentKeybinding = Parameters<typeof keyHint>[0];

function graphKeyHint(
  keybinding: CodingAgentKeybinding,
  description: string,
  theme: GraphTheme,
): string {
  try {
    return keyHint(keybinding, description);
  } catch {
    return localKeyHint(keyText(keybinding), description, theme);
  }
}

function graphRawKeyHint(key: string, description: string, theme: GraphTheme): string {
  try {
    return rawKeyHint(key, description);
  } catch {
    return localKeyHint(key, description, theme);
  }
}

function localKeyHint(key: string, description: string, theme: GraphTheme): string {
  return paint(key, theme.text) + paint(` ${description}`, theme.textMuted);
}

function renderHints(kind: PendingPrompt["kind"], theme: GraphTheme): string {
  const sep = paint(" · ", theme.dim);
  if (kind === "editor") {
    return (
      graphRawKeyHint("tab", "Submit Action", theme) +
      sep +
      graphKeyHint("tui.input.submit", "Newline/Submit", theme) +
      sep +
      graphKeyHint("tui.select.cancel", "Skip", theme)
    );
  }
  if (kind === "confirm") {
    return (
      graphRawKeyHint("y", "Yes", theme) +
      sep +
      graphRawKeyHint("n", "No", theme) +
      sep +
      graphKeyHint("tui.select.confirm", "Submit", theme) +
      sep +
      graphKeyHint("tui.select.cancel", "Skip", theme)
    );
  }
  if (kind === "select") {
    return (
      graphRawKeyHint("↑↓", "Choose", theme) +
      sep +
      graphKeyHint("tui.select.confirm", "Submit", theme) +
      sep +
      graphKeyHint("tui.select.cancel", "Skip", theme)
    );
  }
  return graphKeyHint("tui.input.submit", "Submit", theme) + sep + graphKeyHint("tui.select.cancel", "Skip", theme);
}
