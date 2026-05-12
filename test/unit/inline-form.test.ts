/**
 * Unit tests for the Option-C inline workflow input form.
 *
 *   - inline-form-store: state seeding + lifecycle (createForm, finalize)
 *   - inline-form-card:  renders live + frozen views; routes status text
 *   - inline-form-editor: routes keystrokes per type without rendering a duplicate box
 *   - inline-form-overlay: emits sendMessage, swaps editor, restores it
 *
 * The editor side is exercised through its public surface (handleInput /
 * render). The overlay test uses a minimal `pi`/`ctx` mock that records
 * sendMessage + setEditorComponent calls — same pattern as the existing
 * extension test suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _resetForms,
  createForm,
  finalizeForm,
  getForm,
  touch,
} from "../../src/tui/inline-form-store.ts";
import { renderInlineCard } from "../../src/tui/inline-form-card.ts";
import { InlineFormEditor } from "../../src/tui/inline-form-editor.ts";
import {
  openInlineInputsForm,
  registerInlineFormRenderer,
} from "../../src/tui/inline-form-overlay.ts";
import { deriveGraphTheme } from "../../src/tui/graph-theme.ts";
import type { WorkflowInputEntry } from "../../src/extension/render-result.ts";

const FIELDS: readonly WorkflowInputEntry[] = [
  { name: "prompt", type: "text", required: true, description: "task" },
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

function makeState(overrides: Partial<Parameters<typeof createForm>[0]> = {}) {
  _resetForms();
  return createForm({
    formId: "wf-test",
    workflowName: "ralph",
    description: "loop a thinker",
    fields: FIELDS,
    rawText: { prompt: "", iters: "5", focus: "standard", verbose: "false" },
    focusedIdx: 0,
    caret: 0,
    status: "editing",
    ...overrides,
  });
}

// ── store ────────────────────────────────────────────────────────────────

test("store: createForm seeds version=0 and registers it", () => {
  const s = makeState();
  assert.equal(s.version, 0);
  assert.equal(getForm("wf-test"), s);
});

test("store: touch bumps version", () => {
  const s = makeState();
  touch(s);
  touch(s);
  assert.equal(s.version, 2);
});

test("store: finalizeForm flips status to submitted/cancelled", () => {
  const s = makeState();
  finalizeForm("wf-test", "submit");
  assert.equal(s.status, "submitted");
  const s2 = makeState({ formId: "wf-test-2" });
  finalizeForm("wf-test-2", "cancel");
  assert.equal(s2.status, "cancelled");
});

test("store: finalize unknown id is a no-op", () => {
  _resetForms();
  // Should not throw.
  finalizeForm("nope", "submit");
});

// ── card renderer ────────────────────────────────────────────────────────

function plain(lines: string[]): string {
  // eslint-disable-next-line no-control-regex
  return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

test("card (live): shows header pill, workflow chip, all fields, footer hints", () => {
  const state = makeState();
  const lines = renderInlineCard({ width: 80, state, theme: deriveGraphTheme({}) });
  const txt = plain(lines);
  assert.match(txt, /WORKFLOW/);
  assert.match(txt, /ralph/);
  assert.match(txt, /loop a thinker/);
  assert.match(txt, /prompt/);
  assert.match(txt, /iters/);
  assert.match(txt, /focus/);
  assert.match(txt, /verbose/);
  assert.match(txt, /1 \/ 4/);
  assert.match(txt, /EDIT/);
  assert.match(txt, /tab/);
  assert.match(txt, /ctrl\+s/);
});

test("card (live): hint row is anchored at the bottom of the widget", () => {
  const state = makeState();
  const lines = renderInlineCard({ width: 80, state, theme: deriveGraphTheme({}) });
  // The footer band is the trailing 3 lines; hints live on the middle row.
  const tail = lines.slice(-3).map((l) => plain([l]));
  assert.match(tail.join("\n"), /tab\s+next/);
  assert.match(tail.join("\n"), /esc\s+cancel/);
});

test("card (live): each field title is centred inside its top border", () => {
  const state = makeState();
  const lines = renderInlineCard({ width: 80, state, theme: deriveGraphTheme({}) });
  // A centred title row looks like `╭─...─ <name> ─...─╮` with leading
  // dashes before the name. The original left-aligned `╭ <name> ─...─╮`
  // must NOT appear.
  const visible = plain(lines);
  for (const name of ["prompt", "iters", "focus", "verbose"]) {
    assert.match(visible, new RegExp(`╭─+ ${name} ─+╮`));
    assert.doesNotMatch(visible, new RegExp(`╭ ${name} ─+╮`));
  }
});

test("card (submitted): shows ✓ submitted ribbon + composed command", () => {
  const state = makeState({
    rawText: {
      prompt: "build me a tui",
      iters: "5",
      focus: "minimal",
      verbose: "false",
    },
    status: "submitted",
  });
  const lines = renderInlineCard({ width: 80, state, theme: deriveGraphTheme({}) });
  const txt = plain(lines);
  assert.match(txt, /✓ submitted/);
  assert.match(txt, /\/workflow ralph/);
  assert.match(txt, /prompt="build me a tui"/);
  assert.match(txt, /focus=minimal/);
  // editing-status hints should NOT appear in frozen view.
  assert.doesNotMatch(txt, /✎ editing/);
});

test("card (cancelled): shows ✗ cancelled ribbon", () => {
  const state = makeState({ status: "cancelled" });
  const lines = renderInlineCard({ width: 80, state, theme: deriveGraphTheme({}) });
  assert.match(plain(lines), /✗ cancelled/);
});

test("card: select field renders all choices with dot markers", () => {
  const state = makeState({ focusedIdx: 2 });
  const txt = plain(renderInlineCard({ width: 80, state, theme: deriveGraphTheme({}) }));
  assert.match(txt, /○ minimal/);
  assert.match(txt, /● standard/);
  assert.match(txt, /○ exhaustive/);
});

test("card: focused text field shows the caret so the bottom editor can stay hidden", () => {
  const state = makeState({
    rawText: { prompt: "build", iters: "5", focus: "standard", verbose: "false" },
    focusedIdx: 0,
    caret: 2,
  });
  const txt = plain(renderInlineCard({ width: 80, state, theme: deriveGraphTheme({}) }));
  assert.match(txt, /bu▋ild/);
});

// ── editor ───────────────────────────────────────────────────────────────

function makeEditor(state = makeState()) {
  const renders: number[] = [];
  const tui = { requestRender: () => { renders.push(Date.now()); } };
  let exited: { outcome: "submit" | "cancel" } | null = null;
  const editor = new InlineFormEditor(tui, {
    formId: state.formId,
    theme: deriveGraphTheme({}),
    onExit: (outcome) => { exited = { outcome }; },
  });
  return { editor, state, renders, getExited: () => exited, dispose: () => editor.dispose?.() };
}

test("editor: typing a char inserts at caret on the focused text field", () => {
  const e = makeEditor();
  e.editor.handleInput("h");
  e.editor.handleInput("i");
  assert.equal(e.state.rawText.prompt, "hi");
  assert.equal(e.state.caret, 2);
  e.dispose();
});

test("editor: tab advances focus, shift+tab retreats", () => {
  const e = makeEditor();
  assert.equal(e.state.focusedIdx, 0);
  e.editor.handleInput("\t");
  assert.equal(e.state.focusedIdx, 1);
  e.editor.handleInput("\x1b[Z");
  assert.equal(e.state.focusedIdx, 0);
  e.dispose();
});

test("editor: esc fires onExit('cancel')", () => {
  const e = makeEditor();
  e.editor.handleInput("\x1b");
  assert.deepEqual(e.getExited(), { outcome: "cancel" });
  e.dispose();
});

test("editor: ctrl+s with missing required is a no-op (validation blocks)", () => {
  const e = makeEditor(); // prompt is empty
  e.editor.handleInput("\x13");
  assert.equal(e.getExited(), null);
  e.dispose();
});

test("editor: ctrl+s with all required filled fires onExit('submit')", () => {
  const state = makeState({
    rawText: { prompt: "build", iters: "5", focus: "standard", verbose: "false" },
  });
  const e = makeEditor(state);
  e.editor.handleInput("\x13");
  assert.deepEqual(e.getExited(), { outcome: "submit" });
  e.dispose();
});

test("editor: select field arrow keys cycle, space cycles", () => {
  const state = makeState({ focusedIdx: 2 });
  const e = makeEditor(state);
  assert.equal(state.rawText.focus, "standard");
  e.editor.handleInput("\x1b[C");
  assert.equal(state.rawText.focus, "exhaustive");
  e.editor.handleInput(" ");
  assert.equal(state.rawText.focus, "minimal"); // wrap
  e.editor.handleInput("\x1b[D");
  assert.equal(state.rawText.focus, "exhaustive"); // wrap back
  e.dispose();
});

test("editor: boolean field space toggles", () => {
  const state = makeState({ focusedIdx: 3 });
  const e = makeEditor(state);
  assert.equal(state.rawText.verbose, "false");
  e.editor.handleInput(" ");
  assert.equal(state.rawText.verbose, "true");
  e.editor.handleInput("\x1b[C");
  assert.equal(state.rawText.verbose, "false");
  e.dispose();
});

test("editor: render returns no rows so the bottom argument box is not duplicated", () => {
  const e = makeEditor();
  assert.deepEqual(e.editor.render(80), []);
  e.dispose();
});

test("editor: implements host resize methods (getTopBorderAvailableWidth / setTopBorder)", () => {
  const e = makeEditor();
  assert.equal(typeof e.editor.getTopBorderAvailableWidth, "function");
  assert.equal(typeof e.editor.setTopBorder, "function");
  assert.equal(e.editor.getTopBorderAvailableWidth!(120), 120);
  assert.equal(e.editor.getTopBorderAvailableWidth!(0), 0);
  assert.equal(e.editor.getTopBorderAvailableWidth!(-5), 0);
  assert.equal(e.editor.getTopBorderAvailableWidth!(Number.NaN), 0);
  assert.equal(e.editor.setTopBorder!({ content: "anything", width: 80 }), undefined);
  e.dispose();
});

test("editor: survives the host's resize-handler call sequence at many widths", () => {
  // This test simulates oh-my-pi InteractiveMode's #resizeHandler verbatim.
  // The handler runs on every `process.stdout.resize` event:
  //
  //   #resizeHandler = () => {
  //     #syncEditorMaxHeight();            // → editor.setMaxHeight(rows - reserved)
  //     updateEditorTopBorder();           // ↓
  //   }
  //   updateEditorTopBorder() {
  //     const w = editor.getTopBorderAvailableWidth(terminal.columns);
  //     const top = statusLine.getTopBorder(w);   // host-side
  //     editor.setTopBorder(top);
  //   }
  //
  // Regression target: getTopBorderAvailableWidth and setTopBorder MUST be
  // present on InlineFormEditor and must not throw across the full range of
  // terminal sizes a user can resize to — including pathologically narrow,
  // ridiculous-wide, and degenerate (0, NaN) inputs.
  const e = makeEditor();
  const fireHostResize = (columns: number, rows: number): number => {
    e.editor.setMaxHeight!(Math.max(1, rows - 4));
    const w = e.editor.getTopBorderAvailableWidth!(columns);
    assert.equal(typeof w, "number", `getTopBorderAvailableWidth returned non-number for cols=${columns}`);
    assert.ok(Number.isFinite(w), `getTopBorderAvailableWidth returned ${w} for cols=${columns}`);
    assert.ok(w >= 0, `getTopBorderAvailableWidth returned negative ${w} for cols=${columns}`);
    // statusLine.getTopBorder is host-owned and not exercised here; we pass
    // a faithful shape ({ content, width }) so setTopBorder sees realistic
    // input — the host always passes the same shape.
    e.editor.setTopBorder!({ content: "▎ session-name", width: w });
    // Render must still produce zero rows (the inline-form-card owns chrome).
    assert.deepEqual(e.editor.render(columns), []);
    return w;
  };

  // Common terminal widths
  for (const [cols, rows] of [
    [40, 12],
    [80, 24],
    [100, 30],
    [120, 40],
    [200, 50],
    [320, 80],
  ]) {
    const w = fireHostResize(cols, rows);
    assert.equal(w, cols, `width passthrough at cols=${cols}`);
  }

  // Pathological: zero / negative / non-finite / very large
  for (const cols of [0, -1, -100, Number.NaN, Number.POSITIVE_INFINITY, 100_000]) {
    const w = fireHostResize(cols, 24);
    assert.ok(w >= 0, `width must be non-negative for cols=${cols}, got ${w}`);
  }

  e.dispose();
});

test("editor: handleInput on a finalized form is a no-op", () => {
  const state = makeState({ status: "submitted" });
  const e = makeEditor(state);
  e.editor.handleInput("h");
  assert.equal(state.rawText.prompt, ""); // not touched
  e.dispose();
});

// ── overlay (orchestration) ───────────────────────────────────────────────

interface FakePiSurface {
  sentMessages: Array<{ customType: string; details?: { formId?: string } }>;
  renderers: Map<string, (payload: unknown) => unknown>;
  pi: {
    sendMessage: (m: { customType: string; content?: string; display?: boolean; details?: { formId?: string } }) => void;
    registerMessageRenderer: (event: string, r: (payload: unknown) => unknown) => void;
  };
}

function makeFakePi(): FakePiSurface {
  const sentMessages: FakePiSurface["sentMessages"] = [];
  const renderers = new Map<string, (payload: unknown) => unknown>();
  return {
    sentMessages,
    renderers,
    pi: {
      sendMessage: (m) => { sentMessages.push(m); },
      registerMessageRenderer: (event, r) => { renderers.set(event, r); },
    },
  };
}

interface FakeCtx {
  ui: {
    setEditorComponent: (factory: unknown | undefined) => void;
    getEditorComponent?: () => unknown | undefined;
  };
  installed: { factory: unknown | undefined }[];
}

function makeFakeCtx(): FakeCtx {
  const installed: { factory: unknown | undefined }[] = [];
  return {
    installed,
    ui: {
      setEditorComponent: (factory) => { installed.push({ factory }); },
      getEditorComponent: () => undefined,
    },
  };
}

test("overlay: openInlineInputsForm emits a custom message and swaps editor", async () => {
  _resetForms();
  const { pi, sentMessages } = makeFakePi();
  const ctx = makeFakeCtx();
  const theme = deriveGraphTheme({});

  // Kick off — don't await; the promise won't resolve until the editor exits.
  const pending = openInlineInputsForm(pi as never, ctx as never, {
    workflowName: "ralph",
    fields: FIELDS,
    theme,
  });

  // The message was emitted synchronously.
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]!.customType, "atomic-workflows:input-form");
  const formId = sentMessages[0]!.details!.formId!;
  assert.match(formId, /^wf-/);

  // An editor factory was installed.
  assert.equal(ctx.installed.length, 1);
  const installed = ctx.installed[0]!.factory as
    | ((tui: unknown, theme: unknown, kb: unknown) => InlineFormEditor)
    | undefined;
  assert.equal(typeof installed, "function");

  // Build the editor via the installed factory and submit it.
  const tui = { requestRender: () => {} };
  const editor = installed!(tui, {}, {});
  // Fill required prompt and submit.
  editor.handleInput("h");
  editor.handleInput("i");
  editor.handleInput("\x13");
  const result = await pending;
  assert.equal(result.kind, "run");
  if (result.kind === "run") {
    assert.equal(result.values.prompt, "hi");
    assert.equal(result.values.focus, "standard");
  }

  // Editor restored (setEditorComponent called again with previous = undefined).
  assert.equal(ctx.installed.length, 2);
  assert.equal(ctx.installed[1]!.factory, undefined);

  // Form state remained in the store, status: submitted (sticky scrollback).
  assert.equal(getForm(formId)?.status, "submitted");
});

test("overlay: openInlineInputsForm works with oh-my-pi runtime UI shape", async () => {
  _resetForms();
  const { pi, sentMessages } = makeFakePi();
  const baseCtx = makeFakeCtx();
  const ctx = {
    installed: baseCtx.installed,
    ui: {
      setEditorComponent: baseCtx.ui.setEditorComponent,
    },
  };

  const pending = openInlineInputsForm(pi as never, ctx as never, {
    workflowName: "ralph",
    fields: FIELDS,
    theme: deriveGraphTheme({}),
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(ctx.installed.length, 1);
  const installed = ctx.installed[0]!.factory as
    | ((tui: unknown, theme: unknown, kb: unknown) => InlineFormEditor)
    | undefined;
  assert.equal(typeof installed, "function");

  const editor = installed!({ requestRender: () => {} }, {}, {});
  editor.setUseTerminalCursor(true);
  assert.equal(editor.getUseTerminalCursor(), true);
  editor.setAutocompleteMaxVisible(30);
  assert.equal(editor.getAutocompleteMaxVisible(), 20);
  editor.setMaxHeight(4);
  editor.setHistoryStorage({});
  editor.setActionKeys("app.clear", ["ctrl+c"]);
  editor.setCustomKeyHandler("ctrl+x", () => {});
  editor.clearCustomKeyHandlers();
  editor.setAutocompleteProvider({});
  editor.insertTextAtCursor("\x1b");
  const result = await pending;
  assert.equal(result.kind, "cancel");
  assert.equal(ctx.installed[1]!.factory, undefined);
});

test("overlay: installed editor accepts oh-my-pi setup before card render", async () => {
  _resetForms();
  const { pi, sentMessages } = makeFakePi();
  let editor: InlineFormEditor | undefined;
  const ctx = {
    ui: {
      setEditorComponent: (factory: unknown | undefined) => {
        if (typeof factory !== "function") return;
        editor = (factory as (tui: unknown, theme: unknown, kb: unknown) => InlineFormEditor)(
          { requestRender: () => {} },
          {},
          {},
        );
        editor.setUseTerminalCursor(true);
        editor.setAutocompleteMaxVisible(30);
        editor.setMaxHeight(4);
        editor.setHistoryStorage({});
      },
    },
  };

  const pending = openInlineInputsForm(pi as never, ctx as never, {
    workflowName: "ralph",
    fields: FIELDS,
    theme: deriveGraphTheme({}),
  });

  assert.equal(sentMessages.length, 1);
  assert.ok(editor);
  assert.equal(editor.getUseTerminalCursor(), true);
  assert.equal(editor.getAutocompleteMaxVisible(), 20);
  editor.handleInput("o");
  editor.handleInput("k");
  editor.handleInput("\x13");
  const result = await pending;
  assert.equal(result.kind, "run");
});

test("overlay: host editor setup failure resolves unsupported without emitting card", async () => {
  _resetForms();
  const { pi, sentMessages } = makeFakePi();
  const ctx = {
    ui: {
      setEditorComponent: (factory: unknown | undefined) => {
        assert.equal(typeof factory, "function");
        const editor = (factory as (tui: unknown, theme: unknown, kb: unknown) => InlineFormEditor)(
          { requestRender: () => {} },
          {},
          {},
        );
        assert.equal(typeof editor.setUseTerminalCursor, "function");
        throw new TypeError("nextEditor.setUseTerminalCursor is not a function");
      },
    },
  };

  const result = await openInlineInputsForm(pi as never, ctx as never, {
    workflowName: "ralph",
    fields: FIELDS,
    theme: deriveGraphTheme({}),
  });

  assert.equal(result.kind, "unsupported");
  assert.equal(sentMessages.length, 0);
});

test("overlay: cancelling via esc returns {kind:'cancel'} + freezes state", async () => {
  _resetForms();
  const { pi, sentMessages } = makeFakePi();
  const ctx = makeFakeCtx();
  const pending = openInlineInputsForm(pi as never, ctx as never, {
    workflowName: "ralph",
    fields: FIELDS,
    theme: deriveGraphTheme({}),
  });
  const factory = ctx.installed[0]!.factory as
    | ((tui: unknown, theme: unknown, kb: unknown) => InlineFormEditor);
  const editor = factory({ requestRender: () => {} }, {}, {});
  editor.handleInput("\x1b");
  const result = await pending;
  assert.equal(result.kind, "cancel");
  const formId = sentMessages[0]!.details!.formId!;
  assert.equal(getForm(formId)?.status, "cancelled");
});

test("overlay: missing setEditorComponent → immediate unsupported (headless)", async () => {
  _resetForms();
  const { pi } = makeFakePi();
  const ctx = { ui: {} } as never;
  const result = await openInlineInputsForm(pi as never, ctx, {
    workflowName: "ralph",
    fields: FIELDS,
    theme: deriveGraphTheme({}),
  });
  assert.equal(result.kind, "unsupported");
});

test("overlay: prefilled values seed rawText", async () => {
  _resetForms();
  const { pi, sentMessages } = makeFakePi();
  const ctx = makeFakeCtx();
  const pending = openInlineInputsForm(pi as never, ctx as never, {
    workflowName: "ralph",
    fields: FIELDS,
    prefilled: { prompt: "already typed", focus: "exhaustive" },
    theme: deriveGraphTheme({}),
  });
  const formId = sentMessages[0]!.details!.formId!;
  const state = getForm(formId)!;
  assert.equal(state.rawText.prompt, "already typed");
  assert.equal(state.rawText.focus, "exhaustive");
  // Cancel so the promise resolves and we don't leak a timer.
  const factory = ctx.installed[0]!.factory as
    | ((tui: unknown, theme: unknown, kb: unknown) => InlineFormEditor);
  factory({ requestRender: () => {} }, {}, {}).handleInput("\x1b");
  await pending;
});

test("overlay: registerInlineFormRenderer preserves class-backed pi method binding", () => {
  class ClassBackedPi {
    readonly renderers = new Map<string, (payload: unknown) => unknown>();

    registerMessageRenderer(event: string, renderer: (payload: unknown) => unknown): void {
      this.renderers.set(event, renderer);
    }
  }

  const pi = new ClassBackedPi();
  registerInlineFormRenderer(pi as never, deriveGraphTheme({}));
  const first = pi.renderers.get("atomic-workflows:input-form");
  registerInlineFormRenderer(pi as never, deriveGraphTheme({}));
  const second = pi.renderers.get("atomic-workflows:input-form");
  // Second call did not re-register (same fn reference, or unchanged).
  assert.equal(first, second);
});
