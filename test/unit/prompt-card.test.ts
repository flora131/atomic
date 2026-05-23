/**
 * Smoke tests for the HIL prompt card (graph viewer overlay surface).
 * cross-ref: src/tui/prompt-card.ts
 *
 * Covers:
 *  - createPromptCardState seeds caret from `initial`
 *  - renderPromptCard returns width-bounded ANSI lines for every kind
 *  - handlePromptCardInput discriminates submit/cancel/noop correctly
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  createPromptCardState,
  defaultResponseFor,
  handlePromptCardInput,
  renderPromptCard,
} from "../../packages/workflows/src/tui/prompt-card.ts";
import { deriveGraphTheme } from "../../packages/workflows/src/tui/graph-theme.ts";
import type { PendingPrompt } from "../../packages/workflows/src/shared/store-types.ts";
import { visibleWidth } from "../../packages/workflows/src/tui/text-helpers.ts";

const theme = deriveGraphTheme({});
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

function makePrompt(overrides: Partial<PendingPrompt> = {}): PendingPrompt {
  return {
    id: "test-prompt",
    kind: "input",
    message: "Hello there",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("createPromptCardState", () => {
  test("seeds rawText + caret from initial value", () => {
    const state = createPromptCardState(makePrompt({ initial: "seed" }));
    assert.equal(state.rawText, "seed");
    assert.equal(state.caret, 4);
    assert.equal(state.selectedIndex, 0);
    assert.equal(state.confirmValue, false);
  });

  test("defaults to empty rawText when initial is undefined", () => {
    const state = createPromptCardState(makePrompt());
    assert.equal(state.rawText, "");
    assert.equal(state.caret, 0);
  });
});

describe("handlePromptCardInput — confirm", () => {
  test("y submits true, n submits false", () => {
    const state = createPromptCardState(makePrompt({ kind: "confirm" }));
    assert.deepEqual(handlePromptCardInput("y", state), { kind: "submit", response: true });
    const state2 = createPromptCardState(makePrompt({ kind: "confirm" }));
    assert.deepEqual(handlePromptCardInput("n", state2), { kind: "submit", response: false });
  });

  test("space toggles current selection without submitting", () => {
    const state = createPromptCardState(makePrompt({ kind: "confirm" }));
    assert.equal(state.confirmValue, false);
    assert.deepEqual(handlePromptCardInput(" ", state), { kind: "noop" });
    assert.equal(state.confirmValue, true);
  });

  test("enter submits the currently toggled value", () => {
    const state = createPromptCardState(makePrompt({ kind: "confirm" }));
    state.confirmValue = true;
    assert.deepEqual(handlePromptCardInput("\r", state), { kind: "submit", response: true });
  });

  test("esc variants and ctrl+c variants cancel", () => {
    for (const key of [
      "\x1b",
      "\x1b[27u",
      "\x1b[27;1;27~",
      "\x03",
      "\x1b[99;5u",
      "\x1b[99;5:1u",
      "\x1b[27;5;99~",
    ]) {
      const state = createPromptCardState(makePrompt({ kind: "confirm" }));
      assert.deepEqual(handlePromptCardInput(key, state), { kind: "cancel" }, `key=${JSON.stringify(key)}`);
    }
  });
});

describe("handlePromptCardInput — select", () => {
  test("arrow keys cycle the index without submitting", () => {
    const state = createPromptCardState(makePrompt({ kind: "select", choices: ["a", "b", "c"] }));
    handlePromptCardInput("\x1b[B", state);
    assert.equal(state.selectedIndex, 1);
    handlePromptCardInput("\x1b[B", state);
    assert.equal(state.selectedIndex, 2);
    handlePromptCardInput("\x1b[B", state);
    assert.equal(state.selectedIndex, 0, "wraps at the end");
  });

  test("enter submits the selected choice", () => {
    const state = createPromptCardState(makePrompt({ kind: "select", choices: ["a", "b", "c"] }));
    state.selectedIndex = 1;
    assert.deepEqual(handlePromptCardInput("\r", state), { kind: "submit", response: "b" });
  });
});

describe("handlePromptCardInput — input", () => {
  test("typing chars appends to rawText", () => {
    const state = createPromptCardState(makePrompt({ kind: "input" }));
    handlePromptCardInput("h", state);
    handlePromptCardInput("i", state);
    assert.equal(state.rawText, "hi");
    assert.equal(state.caret, 2);
  });

  test("backspace removes char before caret", () => {
    const state = createPromptCardState(makePrompt({ kind: "input", initial: "abc" }));
    handlePromptCardInput("\x7f", state);
    assert.equal(state.rawText, "ab");
    assert.equal(state.caret, 2);
  });

  test("enter submits the buffer", () => {
    const state = createPromptCardState(makePrompt({ kind: "input", initial: "answer" }));
    assert.deepEqual(
      handlePromptCardInput("\r", state),
      { kind: "submit", response: "answer" },
    );
  });
});

describe("handlePromptCardInput — editor", () => {
  test("enter inserts a newline (not submit)", () => {
    const state = createPromptCardState(makePrompt({ kind: "editor", initial: "line1" }));
    handlePromptCardInput("\r", state);
    assert.equal(state.rawText, "line1\n");
    assert.equal(state.caret, 6);
  });

  test("tab focuses Submit response action and enter submits the buffer", () => {
    const state = createPromptCardState(makePrompt({ kind: "editor", initial: "draft" }));
    assert.deepEqual(handlePromptCardInput("\t", state), { kind: "noop" });
    assert.equal(state.editorSubmitFocused, true);
    assert.deepEqual(
      handlePromptCardInput("\r", state),
      { kind: "submit", response: "draft" },
    );
  });
});

describe("defaultResponseFor", () => {
  test("input/editor default to initial or empty", () => {
    assert.equal(defaultResponseFor(makePrompt({ kind: "input" })), "");
    assert.equal(defaultResponseFor(makePrompt({ kind: "editor", initial: "x" })), "x");
  });

  test("confirm defaults to false", () => {
    assert.equal(defaultResponseFor(makePrompt({ kind: "confirm" })), false);
  });

  test("select defaults to first choice (or empty)", () => {
    assert.equal(
      defaultResponseFor(makePrompt({ kind: "select", choices: ["a", "b"] })),
      "a",
    );
    assert.equal(defaultResponseFor(makePrompt({ kind: "select" })), "");
  });
});

describe("renderPromptCard", () => {
  test("renders multiple lines, each within width", () => {
    const state = createPromptCardState(
      makePrompt({ kind: "input", message: "What's your name?" }),
    );
    const lines = renderPromptCard({ state, theme, width: 60, cursorOn: true });
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= 60, `line exceeds 60 cells: ${visibleWidth(line)}`);
    }
  });

  test("renders for every prompt kind without throwing", () => {
    const kinds: PendingPrompt["kind"][] = ["input", "confirm", "select", "editor"];
    for (const kind of kinds) {
      const state = createPromptCardState(
        makePrompt({ kind, choices: kind === "select" ? ["a", "b"] : undefined }),
      );
      const lines = renderPromptCard({ state, theme, width: 50, cursorOn: false });
      assert.ok(lines.length > 0, `kind ${kind} produced no lines`);
    }
  });

  test("includes the prompt message in the rendered text", () => {
    const state = createPromptCardState(makePrompt({ message: "UNIQUE-MARKER-XYZ" }));
    const lines = renderPromptCard({ state, theme, width: 60, cursorOn: false });
    const joined = lines.join("\n");
    assert.ok(joined.includes("UNIQUE-MARKER-XYZ"), "message text must appear in output");
  });

  test("response field uses rounded border chrome", () => {
    const state = createPromptCardState(makePrompt({ kind: "input" }));
    const lines = renderPromptCard({ state, theme, width: 60, cursorOn: false });
    const plain = lines.map(stripAnsi).join("\n");

    assert.match(plain, /╭ response ─+╮/);
    assert.match(plain, /╰─+╯/);
    assert.doesNotMatch(plain, /[\u250c\u2510\u2514\u2518]/);
  });
});
