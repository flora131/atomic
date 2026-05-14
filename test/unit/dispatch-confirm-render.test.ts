/**
 * Unit tests for the `/workflow <name> …` dispatch confirmation
 * (`src/tui/dispatch-confirm.ts`).
 *
 * Visual contract — ui/dispatch-mockup.html §1 (compact two-row shape):
 *  - One tagged card: stripe + 8-char runId tag + bold workflow name +
 *    inline inputs (`k=v · k=v · +N more`) + right-aligned `● running`
 *    badge.
 *  - Inputs wrap to a second body row only when row 1's interior cannot
 *    hold them; the body row uses the same overflow rules.
 *  - One hint row: `▸ /workflow connect <short-id>   attach & watch`.
 *
 * Explicitly removed (was in the legacy 7-row layout): the `✓ submitted`
 * echo, the `[ DISPATCHED ]` band, the `run id` muted caption beside the
 * tag, the `status starting…` body row, and the second `▸ /workflow
 * status` hint row.
 *
 * cross-ref: src/tui/dispatch-confirm.ts · src/tui/chat-surface.ts
 *            · ui/dispatch-mockup.html
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { renderDispatchConfirm } from "../../src/tui/dispatch-confirm.js";
import { deriveGraphTheme } from "../../src/tui/graph-theme.js";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

describe("renderDispatchConfirm — themed", () => {
  test("emits one tagged card (runId + workflow + inputs + ● running) and one connect hint", () => {
    const out = renderDispatchConfirm({
      workflowName: "deep-research-codebase",
      runId: "0391c9c1-aaaa-bbbb-cccc-dddddddddddd",
      inputs: { prompt: "map the codebase", max_partitions: 4 },
      theme: deriveGraphTheme({}),
      width: 140,
    });
    const plain = stripAnsi(out);

    // Identity: short runId in the tag + workflow name on the same row.
    assert.match(plain, /0391c9c1/);
    assert.match(plain, /deep-research-codebase/);

    // Status badge in the trailing slot.
    assert.match(plain, /● running/);

    // Inputs ride row 1 (wide terminal → inline path).
    assert.match(plain, /prompt="map the codebase"/);
    assert.match(plain, /max_partitions=4/);

    // One hint row, connect-only.
    assert.match(plain, /▸ \/workflow connect 0391c9c1\s+attach & watch/);

    // Legacy chrome MUST be gone.
    assert.doesNotMatch(plain, /✓ submitted/);
    assert.doesNotMatch(plain, /\[ DISPATCHED \]/);
    assert.doesNotMatch(plain, /\brun id\b/);
    assert.doesNotMatch(plain, /\bstarting…/);
    assert.doesNotMatch(plain, /▸ \/workflow status/);

    // Total visual rows: 1 card row + 1 hint row = 2 newline-separated lines.
    assert.equal(out.split("\n").length, 2, `expected 2 lines, got:\n${plain}`);

    // Themed mode emits ANSI escapes.
    assert.match(out, /\x1b\[/);
  });

  test("wide terminal → inputs ride row 1 as the title suffix (single card line)", () => {
    const out = renderDispatchConfirm({
      workflowName: "deep-research-codebase",
      runId: "be3181c1-aaaa-bbbb-cccc-dddddddddddd",
      inputs: { prompt: "explore the codebase", max_partitions: 4 },
      theme: deriveGraphTheme({}),
      width: 160,
    });
    const lines = stripAnsi(out).split("\n");
    // Card row carries identity + inputs + status; hint row follows.
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /be3181c1/);
    assert.match(lines[0]!, /deep-research-codebase/);
    assert.match(lines[0]!, /prompt="explore the codebase"/);
    assert.match(lines[0]!, /max_partitions=4/);
    assert.match(lines[0]!, /● running$/);
    assert.match(lines[1]!, /▸ \/workflow connect be3181c1/);
  });

  test("narrow terminal → inputs wrap to a body row, card grows to 2 rows", () => {
    const out = renderDispatchConfirm({
      workflowName: "deep-research-codebase",
      runId: "be3181c1-aaaa-bbbb-cccc-dddddddddddd",
      inputs: { prompt: "explore the codebase", max_partitions: 4 },
      theme: deriveGraphTheme({}),
      width: 60,
    });
    const lines = stripAnsi(out).split("\n");
    // 1 stripe row (identity + badge) + 1 body row (inputs) + 1 hint row.
    assert.equal(lines.length, 3, `expected 3 lines, got:\n${stripAnsi(out)}`);
    assert.match(lines[0]!, /be3181c1/);
    assert.match(lines[0]!, /● running/);
    // Body row carries inputs; identity does not repeat on row 2.
    assert.match(lines[1]!, /prompt=/);
    assert.doesNotMatch(lines[1]!, /be3181c1/);
    assert.match(lines[2]!, /▸ \/workflow connect be3181c1/);
  });

  test("zero inputs renders a single identity row + hint, with no body row", () => {
    const out = renderDispatchConfirm({
      workflowName: "primer",
      runId: "5b91ee54-aaaa-bbbb-cccc-dddddddddddd",
      inputs: {},
      theme: deriveGraphTheme({}),
      width: 100,
    });
    const lines = stripAnsi(out).split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /5b91ee54/);
    assert.match(lines[0]!, /primer/);
    assert.match(lines[0]!, /● running/);
    assert.match(lines[1]!, /▸ \/workflow connect 5b91ee54/);
    // No legacy `(none)` placeholder.
    assert.doesNotMatch(stripAnsi(out), /\(none\)/);
  });

  test("more than 3 inputs collapses tail to +N more", () => {
    const out = renderDispatchConfirm({
      workflowName: "ship-feature",
      runId: "7c4a91bf-eeee-ffff-aaaa-bbbbbbbbbbbb",
      inputs: {
        prompt: "x",
        model: "claude-opus-4",
        max_partitions: 12,
        target: "main",
        branch: "feat/x",
        dry_run: false,
      },
      theme: deriveGraphTheme({}),
      width: 160,
    });
    const plain = stripAnsi(out);
    assert.match(plain, /\+3 more/);
  });

  test("string values are quoted; truncation preserves closing quote", () => {
    const longValue =
      "map every TypeScript file in the codebase, focus on stage runner architecture and persistence ports";
    const out = renderDispatchConfirm({
      workflowName: "deep-research",
      runId: "abcd1234-aaaa-bbbb-cccc-dddddddddddd",
      inputs: { prompt: longValue },
      theme: deriveGraphTheme({}),
      width: 80,
    });
    const plain = stripAnsi(out);
    const inputsLine = plain.split("\n").find((l) => l.includes("prompt="))!;
    assert.match(inputsLine, /prompt="[^"]+…?"/, `inputs line: ${inputsLine}`);
  });
});

describe("renderDispatchConfirm — plain", () => {
  test("preserves the compact shape without ANSI escapes", () => {
    const out = renderDispatchConfirm({
      workflowName: "ralph",
      runId: "abc12345-aaaa-bbbb-cccc-dddddddddddd",
      inputs: { prompt: "hello" },
      width: 140,
    });
    assert.doesNotMatch(out, /\x1b\[/);

    // Plain stripe + tag + bold-degraded workflow name + status badge.
    assert.match(out, /│\s+\[abc12345\]\s+ralph/);
    assert.match(out, /● running/);

    // Inputs present (inline on wide terminal).
    assert.match(out, /prompt="hello"/);

    // One hint, connect-only.
    assert.match(out, /▸ \/workflow connect abc12345\s+attach & watch/);

    // Legacy chrome MUST be gone in plain mode too.
    assert.doesNotMatch(out, /✓ submitted/);
    assert.doesNotMatch(out, /\[ DISPATCHED \]/);
    assert.doesNotMatch(out, /\brun id\b/);
    assert.doesNotMatch(out, /\bstarting…/);
    assert.doesNotMatch(out, /▸ \/workflow status/);
  });

  test("zero inputs in plain mode renders just identity row + hint", () => {
    const out = renderDispatchConfirm({
      workflowName: "primer",
      runId: "5b91ee54-aaaa-bbbb-cccc-dddddddddddd",
      inputs: {},
      width: 100,
    });
    const lines = out.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /│\s+\[5b91ee54\]\s+primer/);
    assert.match(lines[0]!, /● running/);
    assert.match(lines[1]!, /▸ \/workflow connect 5b91ee54/);
  });
});
