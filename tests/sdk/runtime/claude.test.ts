import { test, expect, describe } from "bun:test";
import { paneLooksReady, paneHasActiveTask } from "../../../src/sdk/workflows/index.ts";

// ---------------------------------------------------------------------------
// paneLooksReady
// ---------------------------------------------------------------------------

describe("paneLooksReady", () => {
  test("returns false for empty input", () => {
    expect(paneLooksReady("")).toBe(false);
    expect(paneLooksReady("   ")).toBe(false);
  });

  test("detects Claude Code prompt (❯)", () => {
    const capture = [
      "  Claude Code v1.2.3",
      "  /home/user/project",
      "",
      "❯ ",
    ].join("\n");
    expect(paneLooksReady(capture)).toBe(true);
  });

  test("detects Claude Code prompt with leading whitespace", () => {
    const capture = "  ❯ ";
    expect(paneLooksReady(capture)).toBe(true);
  });

  test("detects Codex prompt (›)", () => {
    const capture = [
      "OpenAI Codex",
      "model: o4-mini",
      "directory: /home/user/project",
      "",
      "› ",
    ].join("\n");
    expect(paneLooksReady(capture)).toBe(true);
  });

  test("detects generic prompt (>)", () => {
    const capture = "> ";
    expect(paneLooksReady(capture)).toBe(true);
  });

  test("detects Codex welcome screen", () => {
    const capture = [
      "OpenAI Codex",
      "",
      "How can I help you?",
      "",
      "›",
    ].join("\n");
    expect(paneLooksReady(capture)).toBe(true);
  });

  test("rejects bootstrapping state - loading", () => {
    const capture = [
      "Claude Code v1.2.3",
      "Loading...",
      "❯ ",
    ].join("\n");
    expect(paneLooksReady(capture)).toBe(false);
  });

  test("rejects bootstrapping state - initializing", () => {
    const capture = [
      "Initializing agent...",
      "❯ ",
    ].join("\n");
    expect(paneLooksReady(capture)).toBe(false);
  });

  test("rejects bootstrapping state - connecting", () => {
    const capture = "Connecting to API server\n❯ ";
    expect(paneLooksReady(capture)).toBe(false);
  });

  test("returns false for plain text with no prompt", () => {
    const capture = [
      "Some output from a command",
      "Another line of output",
      "No prompt character here",
    ].join("\n");
    expect(paneLooksReady(capture)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// paneHasActiveTask
// ---------------------------------------------------------------------------

describe("paneHasActiveTask", () => {
  test("returns false for empty input", () => {
    expect(paneHasActiveTask("")).toBe(false);
  });

  test("returns false for idle prompt", () => {
    const capture = [
      "Claude Code v1.2.3",
      "❯ ",
    ].join("\n");
    expect(paneHasActiveTask(capture)).toBe(false);
  });

  test("detects 'esc to interrupt' indicator", () => {
    const capture = [
      "Reading file src/index.ts",
      "  esc to interrupt",
    ].join("\n");
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("detects background terminal running", () => {
    const capture = [
      "Some output",
      "1 background terminal running",
    ].join("\n");
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("detects activity spinner with ellipsis dots", () => {
    const capture = "· Thinking...";
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("detects activity spinner with unicode ellipsis", () => {
    const capture = "✻ Processing…";
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("detects multi-word activity spinner", () => {
    const capture = "· Reading files...";
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("returns false for prompt with no activity indicators", () => {
    const capture = [
      "Here is the result of my analysis:",
      "- Item 1",
      "- Item 2",
      "",
      "❯ ",
    ].join("\n");
    expect(paneHasActiveTask(capture)).toBe(false);
  });

  test("only checks last 40 lines", () => {
    const oldLines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);
    oldLines[5] = "esc to interrupt"; // old indicator buried in scrollback
    const capture = [...oldLines, "❯ "].join("\n");
    // The "esc to interrupt" is on line 5 of 51 lines, so it's in the first 11 lines.
    // The last 40 lines are lines 12-51, which don't contain the indicator.
    expect(paneHasActiveTask(capture)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Note: the old "idle detection (paneLooksReady && !paneHasActiveTask)" section
// has been removed. Idle detection in waitForIdle now uses fs.watch on the
// ~/.atomic/claude-stop/ marker directory (see tests/sdk/providers/claude-wait-for-idle.test.ts).
// paneLooksReady and paneHasActiveTask are still used for delivery verification
// in the claudeQuery retry loop, so their individual tests above are retained.
// ---------------------------------------------------------------------------
