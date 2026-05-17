/**
 * Unit tests for src/tui/inputs-picker.ts and src/shared/render-inputs-schema.ts.
 *
 * Covers:
 *   - createInputsPickerState seeds defaults, choices, and prefilled values
 *   - handleInputsPickerInput dispatches per type (string/select/boolean)
 *   - validation flags required fields and refuses submit until all valid
 *   - confirm modal y/enter commits, n/esc returns to form
 *   - coerceValues maps rawText to typed objects (number/bool/select)
 *   - renderInputsPicker emits the section label, field rows, footer hints
 *   - renderInputsSchema pretty/plain modes both produce expected content
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  coerceValues,
  createInputsPickerState,
  handleInputsPickerInput,
  invalidForField,
  renderInputsPicker,
} from "../../packages/workflows/src/tui/inputs-picker.ts";
import { renderInputsSchema } from "../../packages/workflows/src/shared/render-inputs-schema.ts";
import { deriveGraphTheme } from "../../packages/workflows/src/tui/graph-theme.ts";
import type { WorkflowInputEntry } from "../../packages/workflows/src/extension/render-result.ts";
import { makeFakeKeybindings } from "../support/fake-keybindings.ts";

const KB = makeFakeKeybindings();

const FIELDS: WorkflowInputEntry[] = [
  { name: "prompt", type: "text", required: true, description: "task to do" },
  { name: "iters", type: "number", required: false, default: 5 },
  {
    name: "focus",
    type: "select",
    required: true,
    choices: ["minimal", "standard", "exhaustive"],
    default: "standard",
  },
  { name: "verbose", type: "boolean", required: false },
];

// ── State construction ─────────────────────────────────────────────────────

test("createInputsPickerState seeds defaults, selects, and booleans", () => {
  const s = createInputsPickerState(FIELDS);
  assert.equal(s.rawText.prompt, "");
  assert.equal(s.rawText.iters, "5");
  assert.equal(s.rawText.focus, "standard");
  assert.equal(s.rawText.verbose, "false");
  // First invalid field (prompt) is focused.
  assert.equal(s.focusedIdx, 0);
});

test("createInputsPickerState respects prefilled values from CLI tokens", () => {
  const s = createInputsPickerState(FIELDS, { prompt: "build x", focus: "minimal" });
  assert.equal(s.rawText.prompt, "build x");
  assert.equal(s.rawText.focus, "minimal");
  // Both required fields satisfied → focus on first field (idx 0).
  assert.equal(s.focusedIdx, 0);
});

test("createInputsPickerState seeds select first-choice when no default", () => {
  const fields: WorkflowInputEntry[] = [
    { name: "mode", type: "select", required: true, choices: ["a", "b", "c"] },
  ];
  const s = createInputsPickerState(fields);
  assert.equal(s.rawText.mode, "a");
});

// ── Validation ─────────────────────────────────────────────────────────────

test("invalidForField flags required+empty and non-numeric numbers", () => {
  assert.equal(invalidForField(FIELDS[0]!, "", 0), "required");
  assert.equal(invalidForField(FIELDS[0]!, "hi", 0), null);
  assert.equal(invalidForField(FIELDS[1]!, "abc", 1), "must be a number");
  assert.equal(invalidForField(FIELDS[1]!, "42", 1), null);
  assert.equal(invalidForField(FIELDS[1]!, "", 1), null); // optional, empty ok
});

test("invalidForField rejects select values not in choices", () => {
  assert.equal(invalidForField(FIELDS[2]!, "weird", 2), "not in choices");
  assert.equal(invalidForField(FIELDS[2]!, "standard", 2), null);
});

// ── Key handling ───────────────────────────────────────────────────────────

test("text field: typing inserts characters, backspace removes", () => {
  const s = createInputsPickerState(FIELDS);
  handleInputsPickerInput("h", s, FIELDS, KB);
  handleInputsPickerInput("i", s, FIELDS, KB);
  assert.equal(s.rawText.prompt, "hi");
  assert.equal(s.caret, 2);
  handleInputsPickerInput("\x7f", s, FIELDS, KB);
  assert.equal(s.rawText.prompt, "h");
  assert.equal(s.caret, 1);
});

test("tab and shift+tab move focus, wrapping", () => {
  const s = createInputsPickerState(FIELDS);
  assert.equal(s.focusedIdx, 0);
  handleInputsPickerInput("\t", s, FIELDS, KB);
  assert.equal(s.focusedIdx, 1);
  handleInputsPickerInput("\x1b[Z", s, FIELDS, KB);
  assert.equal(s.focusedIdx, 0);
  // Wrap backward from 0 → focused Run action
  handleInputsPickerInput("\x1b[Z", s, FIELDS, KB);
  assert.equal(s.focusedIdx, FIELDS.length);
});

test("select field: arrows cycle through choices", () => {
  const s = createInputsPickerState(FIELDS);
  s.focusedIdx = 2; // focus on `focus` field
  assert.equal(s.rawText.focus, "standard");
  handleInputsPickerInput("\x1b[C", s, FIELDS, KB); // right
  assert.equal(s.rawText.focus, "exhaustive");
  handleInputsPickerInput("\x1b[C", s, FIELDS, KB); // wraps
  assert.equal(s.rawText.focus, "minimal");
  handleInputsPickerInput("\x1b[D", s, FIELDS, KB); // wraps back
  assert.equal(s.rawText.focus, "exhaustive");
});

test("boolean field: space and arrows flip", () => {
  const s = createInputsPickerState(FIELDS);
  s.focusedIdx = 3;
  assert.equal(s.rawText.verbose, "false");
  handleInputsPickerInput(" ", s, FIELDS, KB);
  assert.equal(s.rawText.verbose, "true");
  handleInputsPickerInput("\x1b[D", s, FIELDS, KB);
  assert.equal(s.rawText.verbose, "false");
});

test("esc variants and ctrl+c cancel from form mode", () => {
  for (const key of ["\x1b", "\x1b[27u", "\x1b[27;1;27~", "\x03"]) {
    const state = createInputsPickerState(FIELDS);
    const action = handleInputsPickerInput(key, state, FIELDS, KB);
    assert.deepEqual(action, { kind: "cancel" }, `key=${JSON.stringify(key)}`);
  }
});

test("enter on focused Run with missing required fields opens no modal and focuses invalid", () => {
  const s = createInputsPickerState(FIELDS);
  s.focusedIdx = FIELDS.length;
  // prompt is empty (required) — submit should be blocked.
  const a = handleInputsPickerInput("\r", s, FIELDS, KB);
  assert.deepEqual(a, { kind: "noop" });
  assert.equal(s.confirmOpen, false);
  assert.equal(s.focusedIdx, 0); // jumped to first invalid field
  assert.deepEqual(s.invalidIndices, [0]);
});

test("enter on focused Run with all required filled opens confirm modal", () => {
  const s = createInputsPickerState(FIELDS, { prompt: "build something" });
  s.focusedIdx = FIELDS.length;
  handleInputsPickerInput("\r", s, FIELDS, KB);
  assert.equal(s.confirmOpen, true);
});

test("confirm modal: y returns coerced values; n returns to form", () => {
  const s = createInputsPickerState(FIELDS, { prompt: "hi", focus: "minimal" });
  s.rawText.iters = "8";
  s.rawText.verbose = "true";
  s.focusedIdx = FIELDS.length;
  handleInputsPickerInput("\r", s, FIELDS, KB);
  assert.equal(s.confirmOpen, true);
  // n returns to form
  const back = handleInputsPickerInput("n", s, FIELDS, KB);
  assert.deepEqual(back, { kind: "noop" });
  assert.equal(s.confirmOpen, false);
  // Reopen and confirm
  s.focusedIdx = FIELDS.length;
  handleInputsPickerInput("\r", s, FIELDS, KB);
  const run = handleInputsPickerInput("y", s, FIELDS, KB);
  assert.equal(run.kind, "run");
  if (run.kind === "run") {
    assert.deepEqual(run.values, {
      prompt: "hi",
      iters: 8,
      focus: "minimal",
      verbose: true,
    });
  }
});

// ── Coercion ──────────────────────────────────────────────────────────────

test("coerceValues maps types correctly and skips empty optionals", () => {
  const out = coerceValues(FIELDS, {
    prompt: "do x",
    iters: "10",
    focus: "exhaustive",
    verbose: "true",
  });
  assert.deepEqual(out, {
    prompt: "do x",
    iters: 10,
    focus: "exhaustive",
    verbose: true,
  });

  const sparse = coerceValues(FIELDS, {
    prompt: "y",
    iters: "",
    focus: "standard",
    verbose: "false",
  });
  // iters is empty + optional → omitted; verbose still recorded
  assert.equal(sparse.iters, undefined);
  assert.equal(sparse.verbose, false);
});

test("coerceValues parses JSON-shaped text values", () => {
  const fields: WorkflowInputEntry[] = [
    { name: "tags", type: "text", required: false },
  ];
  const out = coerceValues(fields, { tags: '["a","b"]' });
  assert.deepEqual(out.tags, ["a", "b"]);
});

// ── Rendering ─────────────────────────────────────────────────────────────

test("renderInputsPicker emits header, section label, fields, and hints", () => {
  const theme = deriveGraphTheme({});
  const state = createInputsPickerState(FIELDS, { prompt: "build" });
  const lines = renderInputsPicker({
    width: 80,
    theme,
    workflowName: "ralph",
    description: "loop a thinker",
    fields: FIELDS,
    state,
    cursorOn: true,
  });
  // eslint-disable-next-line no-control-regex
  const joined = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(joined, /ralph/);
  assert.match(joined, /loop a thinker/);
  assert.match(joined, /INPUTS/);
  assert.match(joined, /1 \/ 5/);
  assert.match(joined, /prompt/);
  assert.match(joined, /iters/);
  assert.match(joined, /focus/);
  assert.match(joined, /verbose/);
  assert.match(joined, /Run workflow/);
  assert.match(joined, /tab/);
  assert.match(joined, /enter/);
  assert.doesNotMatch(joined, /ctrl\+s/);
  assert.match(joined, /esc/);
});

test("renderInputsPicker shows confirm card when modal is open", () => {
  const theme = deriveGraphTheme({});
  const state = createInputsPickerState(FIELDS, { prompt: "build a tui" });
  state.confirmOpen = true;
  const lines = renderInputsPicker({
    width: 80,
    theme,
    workflowName: "ralph",
    fields: FIELDS,
    state,
    cursorOn: true,
  });
  // eslint-disable-next-line no-control-regex
  const joined = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(joined, /ready to run/);
  assert.match(joined, /\/workflow ralph/);
  assert.match(joined, /submit/);
  assert.match(joined, /cancel/);
});

test("renderInputsPicker pads field content rows to match the field card width", () => {
  // Regression: when a focused field is empty, the cursor was rendered as a
  // single `▋` glyph with no trailing padding before the right `│`. The
  // top and bottom borders span the full card width, so the field looked
  // like a narrow tower under a wide roof. Every row of the field card
  // (top border, content rows, bottom border) must share the same visible
  // width so the right border sits flush.
  const theme = deriveGraphTheme({});
  const width = 80;
  const state = createInputsPickerState(FIELDS);
  const lines = renderInputsPicker({
    width,
    theme,
    workflowName: "ralph",
    fields: FIELDS,
    state,
    cursorOn: true,
  });
  // eslint-disable-next-line no-control-regex
  const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
  const plain = lines.map(stripAnsi);

  // Find each field-card block (top `╭…╮`, content `│…│`, bottom `╰…╯`).
  const topIdxs = plain
    .map((row, i) => (row.startsWith("╭") && row.endsWith("╮") ? i : -1))
    .filter((i) => i >= 0);
  assert.ok(topIdxs.length >= 2, "expected multiple field-card blocks");

  for (const topIdx of topIdxs) {
    const top = plain[topIdx]!;
    // Walk down until we hit the matching bottom border.
    let bottomIdx = topIdx + 1;
    while (bottomIdx < plain.length && !plain[bottomIdx]!.startsWith("╰")) {
      bottomIdx += 1;
    }
    assert.ok(bottomIdx < plain.length, "missing bottom border for field card");
    const bottom = plain[bottomIdx]!;
    assert.equal(top.length, bottom.length, "top/bottom border widths must match");
    for (let i = topIdx + 1; i < bottomIdx; i += 1) {
      const row = plain[i]!;
      assert.ok(
        row.startsWith("│ ") && row.endsWith("│"),
        `content row not bracketed by │ … │: ${JSON.stringify(row)}`,
      );
      assert.equal(
        row.length,
        top.length,
        `content row width ${row.length} != border width ${top.length}: ${JSON.stringify(row)}`,
      );
    }
  }
});

test("renderInputsPicker stays well-formed across a wide range of widths (resize sweep)", () => {
  // Simulates a user resizing their terminal mid-picker — width is the only
  // signal the renderer gets, so every width from tight (20) to ultra-wide
  // (320) must produce field rows that line up and a footer that fits.
  const theme = deriveGraphTheme({});
  const state = createInputsPickerState(FIELDS);
  // eslint-disable-next-line no-control-regex
  const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
  for (const width of [20, 30, 40, 60, 80, 100, 120, 160, 200, 320]) {
    const lines = renderInputsPicker({
      width,
      theme,
      workflowName: "deep-research-codebase",
      description: "Research a codebase across N parallel specialist stages.",
      fields: FIELDS,
      state,
      cursorOn: true,
    });
    const plain = lines.map(stripAnsi);

    // No rendered row may exceed `width` visible cells — overflow wraps the
    // overlay and breaks the card geometry.
    for (const row of plain) {
      assert.ok(
        row.length <= width,
        `width=${width}: row exceeds budget (${row.length} > ${width}): ${JSON.stringify(row)}`,
      );
    }

    // Every field card's borders + content rows must align.
    const topIdxs = plain
      .map((row, i) => (row.startsWith("╭") && row.endsWith("╮") ? i : -1))
      .filter((i) => i >= 0);
    assert.ok(topIdxs.length >= 1, `width=${width}: expected at least one field card`);
    for (const topIdx of topIdxs) {
      const top = plain[topIdx]!;
      let bottomIdx = topIdx + 1;
      while (bottomIdx < plain.length && !plain[bottomIdx]!.startsWith("╰")) bottomIdx += 1;
      assert.ok(bottomIdx < plain.length, `width=${width}: missing bottom border`);
      const bottom = plain[bottomIdx]!;
      assert.equal(top.length, bottom.length, `width=${width}: top/bottom width mismatch`);
      for (let i = topIdx + 1; i < bottomIdx; i += 1) {
        const row = plain[i]!;
        assert.ok(
          row.startsWith("│ ") && row.endsWith("│"),
          `width=${width}: content row not bracketed: ${JSON.stringify(row)}`,
        );
        assert.equal(
          row.length,
          top.length,
          `width=${width}: content row width ${row.length} != border ${top.length}`,
        );
      }
    }
  }
});

test("renderInputsPicker footer degrades gracefully on narrow terminals", () => {
  // Wide: all 4 hints with labels.
  // Medium: keys with labels but shorter — `prev`/`cancel` drop out.
  // Tight: keys only, including compact `⇧tab` / `↵`.
  // Narrow: only the essentials — `↵` and `esc`.
  const theme = deriveGraphTheme({});
  const state = createInputsPickerState(FIELDS);
  // eslint-disable-next-line no-control-regex
  const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
  const lastNonEmpty = (lines: string[]): string => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i] && stripAnsi(lines[i]!).trim() !== "") return stripAnsi(lines[i]!);
    }
    return "";
  };
  const renderAt = (width: number): string =>
    lastNonEmpty(
      renderInputsPicker({
        width,
        theme,
        workflowName: "ralph",
        fields: FIELDS,
        state,
        cursorOn: true,
      }),
    );

  // Wide — labels visible.
  const wide = renderAt(120);
  assert.match(wide, /tab next/);
  assert.match(wide, /shift\+tab prev/);
  assert.match(wide, /enter choose/);
  assert.match(wide, /esc cancel/);

  // Medium — keys only, but full key names.
  const medium = renderAt(40);
  assert.match(medium, /shift\+tab/);
  assert.doesNotMatch(medium, /shift\+tab prev/);
  assert.doesNotMatch(medium, /esc cancel/);

  // Tight — compact glyphs.
  const tight = renderAt(28);
  assert.match(tight, /⇧tab/);
  assert.match(tight, /↵/);
  assert.match(tight, /esc/);
  assert.doesNotMatch(tight, /shift\+tab/);

  // Narrow — essentials only.
  const narrow = renderAt(12);
  assert.match(narrow, /↵/);
  assert.match(narrow, /esc/);
  assert.doesNotMatch(narrow, /tab/);
});

// ── renderInputsSchema ────────────────────────────────────────────────────

test("renderInputsSchema (plain) preserves legacy text format", () => {
  const out = renderInputsSchema("demo", FIELDS);
  assert.match(out, /^Inputs for "demo":/);
  assert.match(out, /prompt: text \(required\) — task to do/);
  assert.match(out, /iters: number \[default: 5\]/);
  assert.match(out, /focus: select \(required\) \[default: "standard"\] \{choices: minimal, standard, exhaustive\}/);
});

test("renderInputsSchema (pretty) emits themed header and field blocks", () => {
  const theme = deriveGraphTheme({});
  const ansi = renderInputsSchema("demo", FIELDS, { theme });
  // eslint-disable-next-line no-control-regex
  const out = ansi.replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(out, /INPUTS FOR DEMO/);
  assert.match(out, /prompt/);
  assert.match(out, /text/);
  assert.match(out, /required/);
  assert.match(out, /optional/);
  assert.match(out, /values: /);
  assert.match(out, /minimal/);
  assert.match(out, /default: 5/);
  assert.match(out, /4 inputs/);
  assert.match(out, /2 required/);
  assert.match(out, /pass via key=value or run/);
});

test("renderInputsSchema returns short string for zero-input workflows", () => {
  const out = renderInputsSchema("nullary", []);
  assert.equal(out, 'Workflow "nullary" has no declared inputs.');
});

// ── injected keybindings: word / line / char editing (picker overlay) ──────

test("picker: ctrl+w deletes the word left of the caret", () => {
  const s = createInputsPickerState(FIELDS, { prompt: "alpha beta gamma" });
  s.caret = 16; // end of "gamma"
  handleInputsPickerInput("\x17", s, FIELDS, KB);
  assert.equal(s.rawText.prompt, "alpha beta ");
  assert.equal(s.caret, 11);
});

test("picker: ctrl+u deletes from caret to logical line start", () => {
  const s = createInputsPickerState(FIELDS, {
    prompt: "line one\nline two\nline three",
  });
  s.caret = 14; // mid "line two": 9 + 5
  handleInputsPickerInput("\x15", s, FIELDS, KB);
  // Deletes "line " from line-two only; surrounding lines stay intact.
  assert.equal(s.rawText.prompt, "line one\ntwo\nline three");
  assert.equal(s.caret, 9);
});

test("picker: ctrl+k deletes from caret to logical line end without crossing newlines", () => {
  const s = createInputsPickerState(FIELDS, {
    prompt: "line one\nline two\nline three",
  });
  s.caret = 13; // mid "line two": 9 + 4 (after "line")
  handleInputsPickerInput("\x0b", s, FIELDS, KB);
  assert.equal(s.rawText.prompt, "line one\nline\nline three");
  assert.equal(s.caret, 13);
});

test("picker: ctrl+a / ctrl+e jump to logical line start / end", () => {
  const s = createInputsPickerState(FIELDS, {
    prompt: "first line\nsecond line",
  });
  s.caret = 14; // inside "second line"
  handleInputsPickerInput("\x01", s, FIELDS, KB);
  assert.equal(s.caret, 11);
  handleInputsPickerInput("\x05", s, FIELDS, KB);
  assert.equal(s.caret, 22);
});

test("picker: alt+d deletes the word right of the caret", () => {
  const s = createInputsPickerState(FIELDS, { prompt: "alpha beta gamma" });
  s.caret = 6; // start of "beta"
  handleInputsPickerInput("\x1bd", s, FIELDS, KB);
  assert.equal(s.rawText.prompt, "alpha  gamma");
  assert.equal(s.caret, 6);
});

test("picker: alt+left / alt+right jump by whole word", () => {
  const s = createInputsPickerState(FIELDS, { prompt: "alpha beta gamma" });
  s.caret = 16; // end
  handleInputsPickerInput("\x1b[1;3D", s, FIELDS, KB);
  assert.equal(s.caret, 11); // start of "gamma"
  handleInputsPickerInput("\x1b[1;3D", s, FIELDS, KB);
  assert.equal(s.caret, 6); // start of "beta"
  handleInputsPickerInput("\x1b[1;3C", s, FIELDS, KB);
  assert.equal(s.caret, 10); // end of "beta"
});

test("picker: ctrl+d deletes the char right of the caret", () => {
  const s = createInputsPickerState(FIELDS, { prompt: "abc" });
  s.caret = 1;
  handleInputsPickerInput("\x04", s, FIELDS, KB);
  assert.equal(s.rawText.prompt, "ac");
  assert.equal(s.caret, 1);
});

test("picker: user-remapped delete word backward respects injected keybindings", () => {
  const kb = makeFakeKeybindings({
    "tui.editor.deleteWordBackward": ["\x18"], // ctrl+x
  });
  const s = createInputsPickerState(FIELDS, { prompt: "one two" });
  s.caret = 7;
  handleInputsPickerInput("\x18", s, FIELDS, kb);
  assert.equal(s.rawText.prompt, "one ");
  assert.equal(s.caret, 4);
  // Original ctrl+w no longer triggers the action under override.
  s.rawText.prompt = "alpha beta";
  s.caret = 10;
  handleInputsPickerInput("\x17", s, FIELDS, kb);
  assert.equal(s.rawText.prompt, "alpha beta");
  assert.equal(s.caret, 10);
});
