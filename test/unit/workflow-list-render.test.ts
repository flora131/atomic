/**
 * Unit tests for the workflow catalogue renderer
 * (`src/tui/workflow-list.ts`).
 *
 * Visual contract from ui/mockups.html §3:
 *   - One full-width `[ WORKFLOWS ]` band (mauve accent).
 *   - One card per workflow: tag (name) + description row + inputs row.
 *   - Optional inputs carry a trailing `?` marker.
 *   - Long lists collapse the tail to `+N more`.
 *   - Hint rows for `/workflow <name> …` and `/workflow inputs <name>`.
 *
 * cross-ref: src/tui/workflow-list.ts · src/tui/chat-surface.ts
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { renderWorkflowList } from "../../src/tui/workflow-list.js";
import { deriveGraphTheme } from "../../src/tui/graph-theme.js";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

describe("renderWorkflowList — empty", () => {
  test("themed: emits the band header + empty-state copy when no workflows", () => {
    const out = renderWorkflowList([], { theme: deriveGraphTheme({}), width: 100 });
    const plain = stripAnsi(out);
    assert.match(plain, /\[ WORKFLOWS \]/);
    assert.match(plain, /0 registered/);
    assert.match(plain, /no workflows registered/);
  });

  test("plain: same shape without ANSI escapes", () => {
    const out = renderWorkflowList([], { width: 100 });
    assert.doesNotMatch(out, /\x1b\[/);
    assert.match(out, /^ ▎ \[ WORKFLOWS \]/);
    assert.match(out, /0 registered/);
  });
});

describe("renderWorkflowList — populated", () => {
  test("renders one card per workflow with description and input signature", () => {
    const out = renderWorkflowList(
      [
        {
          name: "deep-research-codebase",
          description: "Partitioned, parallel research across a codebase.",
          inputs: [
            { name: "prompt", required: true },
            { name: "max_partitions", required: false },
          ],
        },
        {
          name: "open-claude-design",
          description: "Open Claude Code primed with the impeccable design skill.",
          inputs: [{ name: "target", required: true }],
        },
        {
          name: "ralph",
          description: "Ralph-the-rabbit improvement loop until an exit condition trips.",
          inputs: [
            { name: "prompt", required: true },
            { name: "iterations", required: false },
          ],
        },
      ],
      { theme: deriveGraphTheme({}), width: 110 },
    );
    const plain = stripAnsi(out);

    assert.match(plain, /\[ WORKFLOWS \]/);
    assert.match(plain, /3 registered/);

    // Tag + description per workflow.
    for (const name of ["deep-research-codebase", "open-claude-design", "ralph"]) {
      assert.ok(plain.includes(name), `tag missing for ${name}`);
    }
    assert.match(plain, /Partitioned, parallel research/);
    assert.match(plain, /impeccable design skill/);
    assert.match(plain, /improvement loop/);

    // Inputs row: required and optional names; optional carries `?`.
    assert.match(plain, /inputs\s+prompt/);
    assert.match(plain, /max_partitions\?/);
    assert.match(plain, /iterations\?/);

    // Hint rows.
    assert.match(plain, /▸ \/workflow <name> …/);
    assert.match(plain, /▸ \/workflow inputs <name>/);
  });

  test("required-only signature has no `?` marker", () => {
    const out = renderWorkflowList(
      [{ name: "x", description: "X.", inputs: [{ name: "a", required: true }, { name: "b", required: true }] }],
      { theme: deriveGraphTheme({}), width: 100 },
    );
    const plain = stripAnsi(out);
    assert.doesNotMatch(plain, /\?/);
  });

  test("collapses >3 inputs to +N more", () => {
    const out = renderWorkflowList(
      [
        {
          name: "big",
          description: "Many inputs.",
          inputs: [
            { name: "a", required: true },
            { name: "b", required: false },
            { name: "c", required: false },
            { name: "d", required: false },
            { name: "e", required: false },
          ],
        },
      ],
      { theme: deriveGraphTheme({}), width: 120 },
    );
    const plain = stripAnsi(out);
    assert.match(plain, /\+2 more/);
    assert.match(plain, /a/);
    assert.match(plain, /b\?/);
    assert.match(plain, /c\?/);
  });

  test("plain mode preserves card shape without ANSI", () => {
    const out = renderWorkflowList(
      [{ name: "wf", description: "desc.", inputs: [{ name: "p", required: true }] }],
      { width: 80 },
    );
    assert.doesNotMatch(out, /\x1b\[/);
    assert.match(out, /^ ▎ \[ WORKFLOWS \]/);
    assert.match(out, /│\s+\[wf\]/);
    assert.match(out, /desc\./);
    assert.match(out, /inputs\s+p/);
  });
});
