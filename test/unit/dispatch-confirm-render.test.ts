/**
 * Unit tests for the `/workflow <name> …` dispatch confirmation
 * (`src/tui/dispatch-confirm.ts`).
 *
 * Visual contract from ui/mockups.html §1:
 *   - `✓ submitted` echo line.
 *   - `[ DISPATCHED ]` band with workflow subtitle + `● running` badge.
 *   - Tagged card carrying short runId, `run id` muted suffix, inputs
 *     summary, and a `starting…` status row.
 *   - Two hint rows: `/workflow connect <id>` and `/workflow status`.
 *
 * cross-ref: src/tui/dispatch-confirm.ts · src/tui/chat-surface.ts
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { renderDispatchConfirm } from "../../src/tui/dispatch-confirm.js";
import { deriveGraphTheme } from "../../src/tui/graph-theme.js";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

describe("renderDispatchConfirm — themed", () => {
  test("emits submitted line, DISPATCHED band, runId tag, inputs summary, hint rows", () => {
    const out = renderDispatchConfirm({
      workflowName: "deep-research-codebase",
      runId: "0391c9c1-aaaa-bbbb-cccc-dddddddddddd",
      inputs: { prompt: "map the codebase", max_partitions: 4 },
      theme: deriveGraphTheme({}),
      width: 120,
    });
    const plain = stripAnsi(out);

    // Submitted echo + band.
    assert.match(plain, /✓ submitted/);
    assert.match(plain, /\/workflow deep-research-codebase/);
    assert.match(plain, /\[ DISPATCHED \]/);
    assert.match(plain, /● running/);

    // Card: 8-char short runId in the tag, "run id" subtitle.
    assert.match(plain, /\[?0391c9c1\]?/);
    assert.match(plain, /run id/);

    // Inputs summary — names and values.
    assert.match(plain, /inputs\s+prompt=/);
    assert.match(plain, /"map the codebase"/);
    assert.match(plain, /max_partitions=4/);

    // Status row.
    assert.match(plain, /starting…/);

    // Hint rows.
    assert.match(plain, /▸ \/workflow connect 0391c9c1/);
    assert.match(plain, /▸ \/workflow status/);

    // Themed mode emits ANSI escapes.
    assert.match(out, /\x1b\[/);
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
      width: 130,
    });
    const plain = stripAnsi(out);
    assert.match(plain, /\+3 more/);
  });

  test("string values are quoted; truncation preserves closing quote", () => {
    const longValue = "map every TypeScript file in the codebase, focus on stage runner architecture and persistence ports";
    const out = renderDispatchConfirm({
      workflowName: "deep-research",
      runId: "abcd1234-aaaa-bbbb-cccc-dddddddddddd",
      inputs: { prompt: longValue },
      theme: deriveGraphTheme({}),
      width: 80,
    });
    const plain = stripAnsi(out);
    // Truncated value retains opening + closing quotes.
    const inputsLine = plain.split("\n").find((l) => l.includes("inputs"))!;
    assert.match(inputsLine, /prompt="[^"]+…?"/, `inputs line: ${inputsLine}`);
  });

  test("zero inputs renders the (none) marker", () => {
    const out = renderDispatchConfirm({
      workflowName: "nullary",
      runId: "00000000-aaaa-bbbb-cccc-dddddddddddd",
      inputs: {},
      theme: deriveGraphTheme({}),
      width: 100,
    });
    const plain = stripAnsi(out);
    assert.match(plain, /inputs\s+\(none\)/);
  });
});

describe("renderDispatchConfirm — plain", () => {
  test("preserves shape without ANSI escapes", () => {
    const out = renderDispatchConfirm({
      workflowName: "ralph",
      runId: "abc12345-aaaa-bbbb-cccc-dddddddddddd",
      inputs: { prompt: "hello" },
      width: 100,
    });
    assert.doesNotMatch(out, /\x1b\[/);
    assert.match(out, /^✓ submitted/);
    assert.match(out, /▎ \[ DISPATCHED \]/);
    assert.match(out, /│\s+\[abc12345\]/);
    assert.match(out, /run id/);
    assert.match(out, /inputs\s+prompt="hello"/);
    assert.match(out, /status\s+starting…/);
    assert.match(out, /▸ \/workflow connect abc12345/);
    assert.match(out, /▸ \/workflow status/);
  });
});
