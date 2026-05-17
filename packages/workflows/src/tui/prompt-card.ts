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
 *   │  ┌ response ─────────────────────────────┐    │
 *   │  │ <text input / choice cycler>          │    │
 *   │  └───────────────────────────────────────┘    │
 *   │                                               │
 *   │  ↵ submit · esc skip                          │
 *   ╰───────────────────────────────────────────────╯
 *
 * cross-ref:
 *   src/shared/store-types.ts PendingPrompt
 *   src/tui/inputs-picker.ts  picker field shape (visual sibling)
 *   src/tui/graph-view.ts     overlay integration + key routing
 */

import type { PendingPrompt } from "../shared/store-types.js";
import type { GraphTheme } from "./graph-theme.js";
import { hexToAnsi, hexBg, paint, RESET, BOLD } from "./color-utils.js";
import { matchesKey, truncateToWidth, visibleWidth } from "./text-helpers.js";

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
  if (data === "\x03" || matchesKey(data, "escape")) {
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
  if (matchesKey(data, "left") || data === "\x1b[D" || matchesKey(data, "right") || data === "\x1b[C" || data === " " || matchesKey(data, "tab")) {
    state.confirmValue = !state.confirmValue;
    return { kind: "noop" };
  }
  if (data === "y" || data === "Y") {
    return { kind: "submit", response: true };
  }
  if (data === "n" || data === "N") {
    return { kind: "submit", response: false };
  }
  if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
    return { kind: "submit", response: state.confirmValue };
  }
  return { kind: "noop" };
}

function handleSelect(data: string, state: PromptCardState): PromptCardAction {
  const choices = state.prompt.choices ?? [];
  if (choices.length === 0) {
    if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
      return { kind: "submit", response: "" };
    }
    return { kind: "noop" };
  }
  if (matchesKey(data, "down") || data === "\x1b[B" || matchesKey(data, "right") || data === "\x1b[C") {
    state.selectedIndex = (state.selectedIndex + 1) % choices.length;
    return { kind: "noop" };
  }
  if (matchesKey(data, "up") || data === "\x1b[A" || matchesKey(data, "left") || data === "\x1b[D") {
    state.selectedIndex = (state.selectedIndex - 1 + choices.length) % choices.length;
    return { kind: "noop" };
  }
  if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
    return { kind: "submit", response: choices[state.selectedIndex] ?? choices[0] };
  }
  return { kind: "noop" };
}

function handleInput(data: string, state: PromptCardState): PromptCardAction {
  if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
    return { kind: "submit", response: state.rawText };
  }
  return applyTextEdit(data, state);
}

function handleEditor(data: string, state: PromptCardState): PromptCardAction {
  if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
    state.editorSubmitFocused = !state.editorSubmitFocused;
    return { kind: "noop" };
  }
  if (state.editorSubmitFocused) {
    if (matchesKey(data, "enter")) {
      return { kind: "submit", response: state.rawText };
    }
    return { kind: "noop" };
  }
  if (data === "\r" || data === "\n") {
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
  if (data === "\x1b[D") {
    state.caret = Math.max(0, state.caret - 1);
    return { kind: "noop" };
  }
  if (data === "\x1b[C") {
    state.caret = Math.min(state.rawText.length, state.caret + 1);
    return { kind: "noop" };
  }
  if (data === "\x7f" || data === "\b") {
    if (state.caret > 0) {
      state.rawText =
        state.rawText.slice(0, state.caret - 1) + state.rawText.slice(state.caret);
      state.caret -= 1;
    }
    return { kind: "noop" };
  }
  if (data.length === 1 && data >= " " && data <= "~") {
    state.rawText =
      state.rawText.slice(0, state.caret) + data + state.rawText.slice(state.caret);
    state.caret += 1;
    return { kind: "noop" };
  }
  return { kind: "noop" };
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

  const fieldLines = renderResponseField(state, theme, innerWidth - 4, opts.cursorOn);
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
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      out.push("");
      continue;
    }
    let remaining = paragraph;
    while (visibleWidth(remaining) > width) {
      // Break on the last whitespace within `width` cells; fall back to a
      // hard cut so glyphs longer than `width` don't run off the card.
      const slice = remaining.slice(0, width);
      const lastSpace = slice.lastIndexOf(" ");
      const cut = lastSpace > 0 ? lastSpace : width;
      out.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).replace(/^\s+/, "");
    }
    out.push(remaining);
  }
  return out;
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
      return [renderSelectRow(state, theme, usable)];
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

function renderSelectRow(
  state: PromptCardState,
  theme: GraphTheme,
  usable: number,
): string {
  const choices = state.prompt.choices ?? [];
  if (choices.length === 0) {
    return padToUsable(paint("(no choices)", theme.dim), usable);
  }
  const cells = choices.map((choice, idx) => {
    const sel = idx === state.selectedIndex;
    const marker = sel ? "●" : "○";
    const markerColor = sel ? theme.accent : theme.dim;
    const textColor = sel ? theme.text : theme.dim;
    return paint(marker, markerColor) + " " + paint(choice, textColor, { bold: sel });
  });
  return padToUsable(cells.join("    "), usable);
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
    paint("enter submit", theme.textMuted)
  );
}

function clipToCaretWindow(
  value: string,
  caret: number,
  windowWidth: number,
): { text: string; caret: number } {
  if (value.length <= windowWidth) return { text: value, caret };
  // Keep the caret inside the visible window; bias toward showing the tail.
  const right = Math.max(caret + 4, windowWidth);
  const left = Math.max(0, right - windowWidth);
  return { text: value.slice(left, left + windowWidth), caret: caret - left };
}

function drawCursor(
  text: string,
  caret: number,
  cursorOn: boolean,
  theme: GraphTheme,
): string {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, safeCaret);
  const at = text[safeCaret] ?? " ";
  const after = text.slice(safeCaret + 1);
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

function renderHints(kind: PendingPrompt["kind"], theme: GraphTheme): string {
  const accent = hexToAnsi(theme.text);
  const muted = hexToAnsi(theme.textMuted);
  const dim = hexToAnsi(theme.dim);
  const sep = `${dim} · ${RESET}`;
  if (kind === "editor") {
    return (
      `${accent}tab${RESET} ${muted}submit action${RESET}` +
      sep +
      `${accent}enter${RESET} ${muted}newline/submit${RESET}` +
      sep +
      `${accent}esc${RESET} ${muted}skip${RESET}`
    );
  }
  if (kind === "confirm") {
    return (
      `${accent}y${RESET} ${muted}yes${RESET}` +
      sep +
      `${accent}n${RESET} ${muted}no${RESET}` +
      sep +
      `${accent}↵${RESET} ${muted}submit${RESET}` +
      sep +
      `${accent}esc${RESET} ${muted}skip${RESET}`
    );
  }
  if (kind === "select") {
    return (
      `${accent}↑↓${RESET} ${muted}choose${RESET}` +
      sep +
      `${accent}↵${RESET} ${muted}submit${RESET}` +
      sep +
      `${accent}esc${RESET} ${muted}skip${RESET}`
    );
  }
  return (
    `${accent}↵${RESET} ${muted}submit${RESET}` +
    sep +
    `${accent}esc${RESET} ${muted}skip${RESET}`
  );
}
