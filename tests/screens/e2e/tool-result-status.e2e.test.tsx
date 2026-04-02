/**
 * ToolResult Status E2E Tests
 *
 * End-to-end rendering tests for the ToolResult component using
 * OpenTUI's testRender. Validates visual output for each execution status,
 * tool-specific input summaries, output display, and collapse behavior.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import { ToolResult, type ToolResultProps } from "@/components/tool-result.tsx";
import { STATUS } from "@/theme/icons.ts";

// ============================================================================
// HELPERS
// ============================================================================

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 40;

let activeRenderer: { renderer: { destroy(): void } } | null = null;

/**
 * Render the ToolResult inside a ThemeProvider and capture the text frame.
 */
async function renderToolResult(
  props: ToolResultProps,
  options?: { width?: number; height?: number },
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <ToolResult {...props} />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
}

// ============================================================================
// TEARDOWN
// ============================================================================

afterEach(() => {
  if (activeRenderer) {
    activeRenderer.renderer.destroy();
    activeRenderer = null;
  }
});

// ============================================================================
// STATUS INDICATOR TESTS
// ============================================================================

describe("ToolResult status indicators E2E", () => {
  // --------------------------------------------------------------------------
  // 1. Pending tool — shows ○ indicator
  // --------------------------------------------------------------------------
  test("pending status shows ○ indicator", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "echo hello" },
      status: "pending",
    });

    // Pending uses the open circle indicator
    expect(frame).toContain(STATUS.pending); // ○
    // Should show the tool name
    expect(frame).toContain("bash");
  });

  // --------------------------------------------------------------------------
  // 2. Running tool — shows ● indicator
  // --------------------------------------------------------------------------
  test("running status shows ● indicator", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "cargo build" },
      status: "running",
    });

    // Running uses the filled circle indicator (via AnimatedBlinkIndicator)
    expect(frame).toContain(STATUS.active); // ●
    // Should show the tool name
    expect(frame).toContain("bash");
  });

  // --------------------------------------------------------------------------
  // 3. Completed tool — shows ● indicator
  // --------------------------------------------------------------------------
  test("completed status shows ● indicator", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "echo done" },
      output: "done",
      status: "completed",
    });

    // Completed uses the filled circle indicator
    expect(frame).toContain(STATUS.active); // ●
    // Should show the tool name
    expect(frame).toContain("bash");
  });

  // --------------------------------------------------------------------------
  // 4. Error tool — shows ● indicator
  // --------------------------------------------------------------------------
  test("error status shows ● indicator", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "exit 1" },
      output: "command failed",
      status: "error",
    });

    // Error uses the filled circle indicator
    expect(frame).toContain(STATUS.active); // ●
    // Should show the tool name
    expect(frame).toContain("bash");
  });

  // --------------------------------------------------------------------------
  // 5. Interrupted tool — shows ● indicator
  // --------------------------------------------------------------------------
  test("interrupted status shows ● indicator", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "sleep 999" },
      status: "interrupted",
    });

    // Interrupted uses the filled circle indicator
    expect(frame).toContain(STATUS.active); // ●
    // Should show the tool name
    expect(frame).toContain("bash");
  });
});

// ============================================================================
// TOOL INPUT SUMMARY TESTS
// ============================================================================

describe("ToolResult tool-specific input display E2E", () => {
  // --------------------------------------------------------------------------
  // 6. Bash tool display — shows command text
  // --------------------------------------------------------------------------
  test("bash tool shows command text in summary", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "cargo build" },
      output: "Compiling project...\nFinished dev",
      status: "completed",
    });

    // Bash summary shows the truncated command
    expect(frame).toContain("cargo build");
    // Should show tool name
    expect(frame).toContain("bash");
  });

  // --------------------------------------------------------------------------
  // 7. Read tool display — shows file path
  // --------------------------------------------------------------------------
  test("read tool shows file path in title", async () => {
    const frame = await renderToolResult({
      toolName: "read",
      input: { file_path: "src/main.rs" },
      output: "fn main() {\n    println!(\"Hello\");\n}",
      status: "completed",
    });

    // Read tool title shows the file name (extracted from path by the renderer)
    expect(frame).toContain("main.rs");
    // Should show tool name
    expect(frame).toContain("read");
  });
});

// ============================================================================
// OUTPUT DISPLAY TESTS
// ============================================================================

describe("ToolResult output and collapse behavior E2E", () => {
  // --------------------------------------------------------------------------
  // 8. Tool with output — shows output section when provided
  // --------------------------------------------------------------------------
  test("shows output content when output is provided and status is not pending", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "echo hello" },
      output: "hello",
      status: "completed",
      initialExpanded: true,
    });

    // With initialExpanded=true and short output, content should be visible
    expect(frame).toContain("hello");
  });

  // --------------------------------------------------------------------------
  // 9. Collapsed output — long output is collapsed by default
  // --------------------------------------------------------------------------
  test("collapses long output by default showing only first N lines", async () => {
    // Build output with many lines to exceed the default maxCollapsedLines (5)
    const lines = Array.from({ length: 20 }, (_, i) => `output line ${i + 1}`);
    const output = lines.join("\n");

    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "cat big-file.txt" },
      output,
      status: "completed",
      maxCollapsedLines: 5,
    });

    // The "more lines" collapse indicator should appear
    expect(frame).toContain("more lines");

    // Early lines should be visible
    expect(frame).toContain("output line 1");

    // Lines beyond the collapse limit should NOT be visible
    expect(frame).not.toContain("output line 20");
  });

  // --------------------------------------------------------------------------
  // Pending tool does NOT show output content
  // --------------------------------------------------------------------------
  test("pending status does not render output content", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "echo secret" },
      output: "should not appear",
      status: "pending",
    });

    // Pending tools should not show output content
    expect(frame).not.toContain("should not appear");
  });

  // --------------------------------------------------------------------------
  // Expanded output shows all lines
  // --------------------------------------------------------------------------
  test("expanded output shows all lines when initialExpanded is true", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const output = lines.join("\n");

    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "cat file.txt" },
      output,
      status: "completed",
      initialExpanded: true,
      maxCollapsedLines: 5,
    });

    // With initialExpanded=true, all lines should be visible
    expect(frame).toContain("line 1");
    expect(frame).toContain("line 10");
    // Should NOT show collapse indicator
    expect(frame).not.toContain("more lines");
  });

  // --------------------------------------------------------------------------
  // Error tool shows error output
  // --------------------------------------------------------------------------
  test("error status renders error output text", async () => {
    const frame = await renderToolResult({
      toolName: "bash",
      input: { command: "exit 1" },
      output: "fatal: process exited with code 1",
      status: "error",
    });

    // Error output should be rendered
    expect(frame).toContain("fatal: process exited with code 1");
  });
});
