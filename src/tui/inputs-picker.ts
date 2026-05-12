/**
 * Interactive argument picker for `/workflow <name>` invocations.
 *
 * Opens when the user types `/workflow <name>` in the TUI without enough
 * key=value tokens to satisfy the declared schema. Mirrors the form phase of
 * flora131/atomic's `workflow-picker-tui.tsx` design (mauve `▎` section
 * label, rounded field box per input, caption row, dim footer hints), with
 * the workflow already chosen — there is no fuzzy-list left pane.
 *
 *   ▎ <workflow name>
 *     <description, dim>
 *
 *   ▎ INPUTS                                    <focused+1> / <total>
 *
 *   ╭ prompt ─────────────────────────────────╮
 *   │ Build me a TUI for…                      │
 *   ╰──────────────────────────────────────────╯
 *     text  ·  required  ·  The high-level task to plan and execute.
 *
 *   ╭ focus ──────────────────────────────────╮
 *   │ ● minimal   ○ standard   ○ exhaustive    │
 *   ╰──────────────────────────────────────────╯
 *     select  ·  required  ·  How aggressively to scope the work.
 *
 *   tab next  ·  shift+tab prev  ·  ctrl+s run  ·  esc cancel
 *
 * Field-type renderers:
 *   - string / number : single-row text input with blinking cursor
 *   - text            : 3-row scrolling textarea (multi-line input)
 *   - boolean         : on/off toggle (space flips)
 *   - select          : radio row, ←/→ cycles choices
 *
 * cross-ref:
 *   - flora131/atomic research/designs/workflow-picker-tui.tsx (PROMPT phase)
 *   - flora131/atomic packages/atomic-sdk/src/components/workflow-picker-panel.tsx
 *   - src/tui/session-picker.ts (sibling overlay; same chrome + key style)
 *   - DESIGN.md §1 Iconography (mauve `▎` for section labels)
 */

import type { WorkflowInputEntry } from "../extension/render-result.js";
import type { GraphTheme } from "./graph-theme.js";
import { paint } from "./color-utils.js";
import { matchesKey, truncateToWidth, visibleWidth } from "./text-helpers.js";

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
  /** True while the confirmation modal is on top of the form. */
  confirmOpen: boolean;
  /**
   * Set of field indices that failed validation on the most recent submit
   * attempt. Used to dim the `ctrl+s` hint and to highlight a field if the
   * user retries with required fields still empty.
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
    confirmOpen: false,
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
 * Used both to flag fields on submit and to drive the dim state of the
 * `ctrl+s run` footer hint.
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

function computeInvalid(
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
    // 3-row scrolling textarea — keeps the cursor line visible.
    const ROWS = 3;
    const allLines = raw.split("\n");
    const start = Math.max(0, allLines.length - ROWS);
    const rows: string[] = [];
    for (let i = 0; i < ROWS; i++) {
      const line = allLines[start + i] ?? "";
      const isCursorLine = focused && i === Math.min(ROWS - 1, allLines.length - 1 - start);
      rows.push(renderInlineText(line, isCursorLine, cursorOn, usable, theme, field.placeholder, raw === ""));
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
    const first = ph.slice(0, 1);
    const rest = ph.slice(1);
    const head = showCursor
      ? paint(first, theme.bg, { bg: theme.accent })
      : paint(first, theme.dim);
    return padLine(head + paint(rest, theme.dim), usable);
  }
  const c = caret ?? value.length;
  const safe = Math.max(0, Math.min(c, value.length));
  const before = value.slice(0, safe);
  const at = value.slice(safe, safe + 1);
  const after = value.slice(safe + 1);
  const cursorCell = showCursor
    ? at !== ""
      ? paint(at, theme.bg, { bg: theme.accent })
      : paint("▋", theme.accent)
    : at;
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

export function renderInputsPicker(opts: InputsPickerRenderOpts): string[] {
  const { theme, workflowName, description, fields, state, width, cursorOn } = opts;
  const lines: string[] = [];

  // Header chip — name + description, matching atomic's locked-in chip.
  // Both rows are clipped to terminal width so a long workflow name or
  // description cannot push the picker into a wrap on narrow terminals.
  const chipPrefix = paint("▎ ", theme.mauve);
  const nameBudget = Math.max(0, width - 2);
  lines.push(
    chipPrefix +
      paint(truncateToWidth(workflowName, nameBudget, "…"), theme.text, { bold: true }),
  );
  if (description) {
    const descBudget = Math.max(0, width - 2);
    lines.push("  " + paint(truncateToWidth(description, descBudget, "…"), theme.textMuted));
  }
  lines.push("");

  // Section label with field counter (1-based). When the terminal is too
  // narrow to hold both, the counter is the priority — drop "INPUTS" first
  // so the user always knows which field they're on.
  const counter = `${state.focusedIdx + 1} / ${fields.length}`;
  const labelLeft =
    paint("▎ ", theme.mauve) + paint("INPUTS", theme.textMuted, { bold: true });
  const labelLen = visibleWidth(labelLeft);
  if (labelLen + 1 + counter.length <= width) {
    const pad = width - labelLen - counter.length;
    lines.push(labelLeft + " ".repeat(pad) + paint(counter, theme.dim));
  } else if (counter.length + 2 <= width) {
    // Just the chip + counter, right-aligned.
    const pad = Math.max(0, width - 2 - counter.length);
    lines.push(chipPrefix + " ".repeat(pad) + paint(counter, theme.dim));
  } else {
    // Truly tiny — counter only, clipped.
    lines.push(paint(truncateToWidth(counter, width, "…"), theme.dim));
  }
  lines.push("");

  // Field blocks.
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const raw = state.rawText[f.name] ?? "";
    const focused = i === state.focusedIdx && !state.confirmOpen;
    const invalid = state.invalidIndices.includes(i)
      ? invalidForField(f, raw, i)
      : null;
    lines.push(...renderField(f, raw, focused, state.caret, cursorOn, invalid, theme, width));
    lines.push(""); // gap between fields
  }

  // Footer hints — tiered for narrow widths. The widest form ends up around
  // 57 visible cells; we step down to keys-with-labels-tight, keys-only,
  // and finally essentials-only when the terminal cannot hold the row. The
  // `ctrl+s` hint dims when any field is currently invalid.
  const anyInvalid = computeInvalid(fields, state.rawText).length > 0;
  const submitColor = anyInvalid ? theme.dim : theme.text;
  const submitLabelColor = anyInvalid ? theme.dim : theme.textMuted;
  lines.push(renderFooterHints(width, theme, submitColor, submitLabelColor));

  if (state.confirmOpen) {
    lines.push("");
    lines.push(...renderConfirmCard(opts));
  }
  return lines;
}

/**
 * Footer hint row, tier-degraded so it never wraps on resize. Tiers:
 *
 *   wide   (≥ widest):  tab next  ·  shift+tab prev  ·  ctrl+s run  ·  esc cancel
 *   medium (≥ keys):    tab  ·  shift+tab  ·  ctrl+s  ·  esc
 *   tight  (≥ short):   tab  ·  ⇧tab  ·  ⌃s  ·  esc
 *   narrow (else):      ⌃s  ·  esc
 *
 * The `ctrl+s` hint always survives — it is the only "run" affordance — and
 * `esc cancel` always survives so the user can back out.
 */
function renderFooterHints(
  width: number,
  theme: GraphTheme,
  submitColor: string,
  submitLabelColor: string,
): string {
  const sep = dimSep(theme);
  const sepWidth = 5; // "  ·  "
  const hint = (key: string, label: string, kc: string, lc: string): string =>
    paint(key, kc) + " " + paint(label, lc);
  const keyOnly = (key: string, kc: string): string => paint(key, kc);

  const wide = [
    { width: 8, render: () => hint("tab", "next", theme.text, theme.textMuted) },
    { width: 14, render: () => hint("shift+tab", "prev", theme.text, theme.textMuted) },
    { width: 10, render: () => hint("ctrl+s", "run", submitColor, submitLabelColor) },
    { width: 10, render: () => hint("esc", "cancel", theme.text, theme.textMuted) },
  ];
  const medium = [
    { width: 3, render: () => keyOnly("tab", theme.text) },
    { width: 9, render: () => keyOnly("shift+tab", theme.text) },
    { width: 6, render: () => keyOnly("ctrl+s", submitColor) },
    { width: 3, render: () => keyOnly("esc", theme.text) },
  ];
  const tight = [
    { width: 3, render: () => keyOnly("tab", theme.text) },
    { width: 4, render: () => keyOnly("⇧tab", theme.text) },
    { width: 2, render: () => keyOnly("⌃s", submitColor) },
    { width: 3, render: () => keyOnly("esc", theme.text) },
  ];
  const narrow = [
    { width: 2, render: () => keyOnly("⌃s", submitColor) },
    { width: 3, render: () => keyOnly("esc", theme.text) },
  ];

  for (const tier of [wide, medium, tight, narrow]) {
    const total = tier.reduce((s, h) => s + h.width, 0) + (tier.length - 1) * sepWidth;
    if (total <= width) {
      return tier.map((h) => h.render()).join(sep);
    }
  }
  // Truly tiny terminal — show just the run+cancel keys joined by a single space.
  return paint("⌃s", submitColor) + " " + paint("esc", theme.text);
}

/**
 * Centered "ready to run" card that shows the composed slash invocation.
 * Returns an array of lines so the caller can splat into the master list
 * and each row is clipped to terminal width on its own.
 */
function renderConfirmCard(opts: InputsPickerRenderOpts): string[] {
  const { theme, workflowName, fields, state, width } = opts;
  const values = coerceValues(fields, state.rawText);
  const head =
    paint("✓ ", theme.success) +
    paint("ready to run", theme.text, { bold: true });
  const cmdParts: string[] = [
    paint("/workflow ", theme.dim) + paint(workflowName, theme.text),
  ];
  for (const f of fields) {
    if (values[f.name] === undefined) continue;
    const shown = shortVal(String(state.rawText[f.name] ?? ""));
    cmdParts.push(
      paint("  ", theme.dim) +
        paint(f.name, theme.text) +
        paint("=", theme.dim) +
        paint(shown, theme.text),
    );
  }
  const prompt =
    paint("submit this workflow?  ", theme.dim) +
    paint("y", theme.success, { bold: true }) +
    paint(" submit", theme.dim) +
    paint("  ·  ", theme.dim) +
    paint("n", theme.error, { bold: true }) +
    paint(" cancel", theme.dim);
  return [
    truncateToWidth(head, width, "…", true),
    "",
    ...cmdParts.map((row) => truncateToWidth(row, width, "…", true)),
    "",
    truncateToWidth(prompt, width, "…", true),
  ];
}

function shortVal(s: string): string {
  const trimmed = s.replace(/\n/g, " ").trim();
  if (trimmed.length > 48) return trimmed.slice(0, 45) + "…";
  return trimmed.length === 0 ? "<empty>" : trimmed;
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
 *   tab / down       — next field
 *   shift+tab / up   — previous field
 *   left / right     — select: cycle choices; boolean: flip; text: caret
 *   space            — boolean: flip
 *   enter            — text: newline; otherwise: next field
 *   ctrl+s           — open confirm modal (if all required filled)
 *   backspace        — delete char left of caret
 *   esc              — close picker without running
 *
 * Keys (confirm modal mode):
 *   y / enter        — run
 *   n / esc          — back to form
 */
export function handleInputsPickerInput(
  key: string,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
): InputsPickerAction {
  if (fields.length === 0) {
    // Defensive: a workflow with zero declared inputs shouldn't reach the
    // picker (we gate on `fields.length > 0` at the open() site), but if
    // it does, treat any keystroke as a noop and let the host close us.
    if (matchesKey(key, "escape")) return { kind: "cancel" };
    return { kind: "noop" };
  }
  if (state.confirmOpen) return handleConfirmKey(key, state, fields);
  return handleFormKey(key, state, fields);
}

function handleFormKey(
  key: string,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
): InputsPickerAction {
  const field = fields[state.focusedIdx]!;
  const name = field.name;
  const cur = state.rawText[name] ?? "";

  // ── Global navigation ──
  if (matchesKey(key, "escape")) return { kind: "cancel" };
  if (key === "\t") {
    moveFocus(state, fields, +1);
    return { kind: "noop" };
  }
  if (key === "\x1b[Z") {
    moveFocus(state, fields, -1);
    return { kind: "noop" };
  }
  if (key === "\x13") {
    // ctrl+s — attempt submit
    const invalid = computeInvalid(fields, state.rawText);
    if (invalid.length > 0) {
      state.invalidIndices = invalid;
      state.focusedIdx = invalid[0]!;
      state.caret = (state.rawText[fields[state.focusedIdx]!.name] ?? "").length;
      return { kind: "noop" };
    }
    state.invalidIndices = [];
    state.confirmOpen = true;
    return { kind: "noop" };
  }

  // ── Per-type edits ──
  if (field.type === "select") {
    return handleSelectKey(key, field, state, fields);
  }
  if (field.type === "boolean") {
    return handleBooleanKey(key, field, state, fields);
  }

  // string / text / number — text editing semantics.
  if (matchesKey(key, "up")) {
    moveFocus(state, fields, -1);
    return { kind: "noop" };
  }
  if (matchesKey(key, "down")) {
    moveFocus(state, fields, +1);
    return { kind: "noop" };
  }
  if (matchesKey(key, "left")) {
    state.caret = Math.max(0, state.caret - 1);
    return { kind: "noop" };
  }
  if (matchesKey(key, "right")) {
    state.caret = Math.min(cur.length, state.caret + 1);
    return { kind: "noop" };
  }
  if (key === "\x7f" || key === "\b") {
    if (state.caret > 0) {
      state.rawText[name] = cur.slice(0, state.caret - 1) + cur.slice(state.caret);
      state.caret -= 1;
    }
    return { kind: "noop" };
  }
  if (matchesKey(key, "enter")) {
    if (field.type === "text") {
      state.rawText[name] = cur.slice(0, state.caret) + "\n" + cur.slice(state.caret);
      state.caret += 1;
    } else {
      moveFocus(state, fields, +1);
    }
    return { kind: "noop" };
  }
  // Printable insert.
  if (key.length === 1 && key >= " " && key <= "~") {
    state.rawText[name] = cur.slice(0, state.caret) + key + cur.slice(state.caret);
    state.caret += 1;
    return { kind: "noop" };
  }
  return { kind: "noop" };
}

function handleSelectKey(
  key: string,
  field: WorkflowInputEntry,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
): InputsPickerAction {
  const choices = field.choices ?? [];
  if (choices.length === 0) return { kind: "noop" };
  const current = state.rawText[field.name] ?? choices[0]!;
  const idx = Math.max(0, choices.indexOf(current));
  if (matchesKey(key, "left") || matchesKey(key, "h")) {
    state.rawText[field.name] = choices[(idx - 1 + choices.length) % choices.length]!;
    return { kind: "noop" };
  }
  if (matchesKey(key, "right") || matchesKey(key, "l")) {
    state.rawText[field.name] = choices[(idx + 1) % choices.length]!;
    return { kind: "noop" };
  }
  if (matchesKey(key, "up")) {
    moveFocus(state, fields, -1);
    return { kind: "noop" };
  }
  if (matchesKey(key, "down")) {
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
): InputsPickerAction {
  if (
    key === " " ||
    matchesKey(key, "enter") ||
    matchesKey(key, "left") ||
    matchesKey(key, "right")
  ) {
    state.rawText[field.name] = state.rawText[field.name] === "true" ? "false" : "true";
    return { kind: "noop" };
  }
  if (matchesKey(key, "up")) {
    moveFocus(state, fields, -1);
    return { kind: "noop" };
  }
  if (matchesKey(key, "down")) {
    moveFocus(state, fields, +1);
    return { kind: "noop" };
  }
  return { kind: "noop" };
}

function handleConfirmKey(
  key: string,
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
): InputsPickerAction {
  if (matchesKey(key, "y") || matchesKey(key, "enter")) {
    return { kind: "run", values: coerceValues(fields, state.rawText) };
  }
  if (matchesKey(key, "n") || matchesKey(key, "escape")) {
    state.confirmOpen = false;
    return { kind: "noop" };
  }
  return { kind: "noop" };
}

function moveFocus(
  state: InputsPickerState,
  fields: readonly WorkflowInputEntry[],
  delta: number,
): void {
  const n = fields.length;
  state.focusedIdx = (state.focusedIdx + delta + n) % n;
  const next = fields[state.focusedIdx]!;
  state.caret = (state.rawText[next.name] ?? "").length;
}
