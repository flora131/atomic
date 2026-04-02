/**
 * E2E tests for the Autocomplete component.
 *
 * Renders the Autocomplete component inside a ThemeProvider using OpenTUI's
 * `testRender`, then inspects the captured character frame and span colours
 * to verify layout, filtering, prefix rendering, selection highlighting,
 * and max-suggestions capping.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import { Autocomplete } from "@/components/autocomplete.tsx";
import type { CommandDefinition } from "@/commands/tui/index.ts";
import type { CapturedSpan } from "@opentui/core";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/** Stub execute fn — the component never calls it. */
const stubExecute = (() => ({ success: true })) as CommandDefinition["execute"];

const testSuggestions: CommandDefinition[] = [
  { name: "help", description: "Show all commands", category: "builtin", execute: stubExecute },
  { name: "theme", description: "Switch theme", category: "builtin", execute: stubExecute },
  { name: "model", description: "Select model", category: "builtin", execute: stubExecute },
  { name: "mcp", description: "List MCP servers", category: "builtin", execute: stubExecute },
  { name: "compact", description: "Compact context", category: "builtin", execute: stubExecute },
  { name: "clear", description: "Clear session", category: "builtin", execute: stubExecute },
  { name: "exit", description: "Exit application", category: "builtin", execute: stubExecute },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERMINAL_WIDTH = 80;
const TERMINAL_HEIGHT = 24;

/** Convert a CapturedSpan's fg RGBA colour to a lowercase hex string. */
function spanFgHex(span: CapturedSpan): string {
  const [r, g, b] = span.fg.toInts();
  return (
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Return only the non-blank lines from a character frame, trimmed of
 * trailing whitespace for easier assertion.
 */
function visibleLines(frame: string): string[] {
  return frame
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}

/** Noop handler – used where the test doesn't care about the callback. */
const noop = () => {};

// ---------------------------------------------------------------------------
// Renderer lifecycle
// ---------------------------------------------------------------------------

/** Stack of destroyers accumulated during each test. */
let destroyers: (() => void)[] = [];

afterEach(() => {
  for (const destroy of destroyers) {
    destroy();
  }
  destroyers = [];
});

/**
 * Render the Autocomplete component inside a ThemeProvider and return helpers
 * for inspecting the output.
 */
async function renderAutocomplete(props: {
  input?: string;
  visible?: boolean;
  selectedIndex?: number;
  onSelect?: (cmd: CommandDefinition, action: "complete" | "execute") => void;
  onIndexChange?: (idx: number) => void;
  maxSuggestions?: number;
  namePrefix?: string;
  externalSuggestions?: CommandDefinition[];
}) {
  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <Autocomplete
        input={props.input ?? ""}
        visible={props.visible ?? true}
        selectedIndex={props.selectedIndex ?? 0}
        onSelect={props.onSelect ?? noop}
        onIndexChange={props.onIndexChange ?? noop}
        maxSuggestions={props.maxSuggestions}
        namePrefix={props.namePrefix}
        externalSuggestions={props.externalSuggestions ?? testSuggestions}
      />
    </ThemeProvider>,
    { width: TERMINAL_WIDTH, height: TERMINAL_HEIGHT },
  );

  destroyers.push(() => result.renderer.destroy());

  // Perform an initial render pass so the frame is populated.
  await result.renderOnce();

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Autocomplete E2E", () => {
  // -----------------------------------------------------------------------
  // 1. Hidden when not visible
  // -----------------------------------------------------------------------
  test("renders nothing when visible is false", async () => {
    const { captureCharFrame } = await renderAutocomplete({
      visible: false,
      externalSuggestions: testSuggestions,
    });

    const lines = visibleLines(captureCharFrame());
    expect(lines).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 2. Renders suggestions with "/" prefix
  // -----------------------------------------------------------------------
  test("renders suggestion names with the default '/' prefix", async () => {
    const { captureCharFrame } = await renderAutocomplete({
      visible: true,
      externalSuggestions: testSuggestions,
    });

    const lines = visibleLines(captureCharFrame());

    // At least some suggestions should be visible (the scrollbox may clip the
    // last item due to its scrollbar track consuming 1 row of height).
    expect(lines.length).toBeGreaterThanOrEqual(testSuggestions.length - 1);

    // Every *visible* line should contain a "/"-prefixed command name.
    for (const line of lines) {
      const hasSlashPrefix = testSuggestions.some((cmd) =>
        line.includes(`/${cmd.name}`),
      );
      expect(hasSlashPrefix).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // 3. Two-column layout — name and description side by side
  // -----------------------------------------------------------------------
  test("displays name and description on the same line (two-column layout)", async () => {
    const { captureCharFrame } = await renderAutocomplete({
      visible: true,
      externalSuggestions: testSuggestions,
    });

    const lines = visibleLines(captureCharFrame());

    // For each visible line, find the matching command and verify description
    // appears on the same line.
    for (const line of lines) {
      const matchedCmd = testSuggestions.find((cmd) =>
        line.includes(`/${cmd.name}`),
      );
      expect(matchedCmd).toBeDefined();
      expect(line).toContain(matchedCmd!.description);
    }
  });

  // -----------------------------------------------------------------------
  // 4. Selected index highlighted with accent colour
  // -----------------------------------------------------------------------
  test("highlights the selected row with the accent colour", async () => {
    const selectedIdx = 2; // "model"
    const { captureSpans } = await renderAutocomplete({
      visible: true,
      selectedIndex: selectedIdx,
      externalSuggestions: testSuggestions,
    });

    const { lines } = captureSpans();
    const accentHex = darkTheme.colors.accent.toLowerCase();
    const foregroundHex = darkTheme.colors.foreground.toLowerCase();

    // The line at `selectedIdx` should contain spans whose fg is the accent
    // colour, while other lines should use the normal foreground colour.
    const selectedLine = lines[selectedIdx]!;
    expect(selectedLine).toBeDefined();

    // At least one content span on the selected line must use the accent colour.
    const hasAccent = selectedLine.spans.some(
      (s) => s.text.trim().length > 0 && spanFgHex(s) === accentHex,
    );
    expect(hasAccent).toBe(true);

    // A non-selected line should NOT use the accent colour for its text.
    const otherIdx = 0;
    const otherLine = lines[otherIdx]!;
    expect(otherLine).toBeDefined();

    const otherHasAccent = otherLine.spans.some(
      (s) => s.text.trim().length > 0 && spanFgHex(s) === accentHex,
    );
    expect(otherHasAccent).toBe(false);

    // The non-selected line should use the foreground colour for the name.
    const hasForeground = otherLine.spans.some(
      (s) => s.text.trim().length > 0 && spanFgHex(s) === foregroundHex,
    );
    expect(hasForeground).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 5. Filters suggestions by input
  // -----------------------------------------------------------------------
  test("shows only matching commands when externalSuggestions are pre-filtered", async () => {
    // The component passes externalSuggestions through without further filtering,
    // so we simulate what the parent would do: pre-filter by "he" substring.
    const filtered = testSuggestions.filter((c) => c.name.includes("he"));

    const { captureCharFrame } = await renderAutocomplete({
      visible: true,
      input: "he",
      externalSuggestions: filtered,
    });

    const lines = visibleLines(captureCharFrame());

    // "help" and "theme" are the only names containing "he".
    expect(filtered).toHaveLength(2);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes("/help"))).toBe(true);

    // Commands that don't match should be absent.
    expect(lines.some((l) => l.includes("/model"))).toBe(false);
    expect(lines.some((l) => l.includes("/exit"))).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 6. Agent prefix — namePrefix="@"
  // -----------------------------------------------------------------------
  test("renders agent-style prefix when namePrefix is '@'", async () => {
    const agentSuggestions: CommandDefinition[] = [
      { name: "coder", description: "Coding agent", category: "agent", execute: stubExecute },
      { name: "reviewer", description: "Review agent", category: "agent", execute: stubExecute },
    ];

    const { captureCharFrame } = await renderAutocomplete({
      visible: true,
      namePrefix: "@",
      externalSuggestions: agentSuggestions,
    });

    const lines = visibleLines(captureCharFrame());

    // With namePrefix="@" and category="agent", the component uses "* " prefix.
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes("* coder"))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 7. Max suggestions
  // -----------------------------------------------------------------------
  test("limits displayed rows to maxSuggestions", async () => {
    const { captureCharFrame } = await renderAutocomplete({
      visible: true,
      maxSuggestions: 3,
      externalSuggestions: testSuggestions,
    });

    const lines = visibleLines(captureCharFrame());

    // The component sets the container height to min(suggestions.length, maxSuggestions).
    // With 7 suggestions and maxSuggestions=3, at most 3 rows are visible.
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  // -----------------------------------------------------------------------
  // Bonus: onIndexChange is called when selectedIndex is out of bounds
  // -----------------------------------------------------------------------
  test("clamps selectedIndex and notifies parent via onIndexChange", async () => {
    const indexChanges: number[] = [];
    const onIndexChange = (idx: number) => indexChanges.push(idx);

    const { renderOnce } = await renderAutocomplete({
      visible: true,
      selectedIndex: 999, // way out of bounds
      onIndexChange,
      externalSuggestions: testSuggestions,
    });

    // The clamping now fires synchronously during render (no extra useEffect cycle).
    await renderOnce();

    // The component should have called onIndexChange with the clamped value.
    expect(indexChanges.length).toBeGreaterThanOrEqual(1);
    const lastChange = indexChanges[indexChanges.length - 1];
    expect(lastChange).toBe(testSuggestions.length - 1);
  });
});
