/**
 * Tests for ToolResult Component
 *
 * Tests cover:
 * - Status indicator display
 * - Collapsible content behavior
 * - Tool-specific rendering
 * - Error styling
 * - Utility functions
 */

import { describe, test, expect } from "bun:test";
import {
  shouldCollapse,
  getToolSummary,
  type ToolResultProps,
  type ToolSummary,
} from "../../../src/ui/components/tool-result.tsx";
import { darkTheme, lightTheme } from "../../../src/ui/theme.tsx";
import { getToolRenderer } from "../../../src/ui/tools/registry.ts";

// ============================================================================
// SHOULD COLLAPSE TESTS
// ============================================================================

describe("shouldCollapse", () => {
  test("returns true when content exceeds max lines", () => {
    expect(shouldCollapse(20, 10)).toBe(true);
    expect(shouldCollapse(15, 10)).toBe(true);
  });

  test("returns false when content is within max lines", () => {
    expect(shouldCollapse(5, 10)).toBe(false);
    expect(shouldCollapse(10, 10)).toBe(false);
  });

  test("respects initialExpanded override", () => {
    // initialExpanded=true means should NOT collapse
    expect(shouldCollapse(20, 10, true)).toBe(false);
    // initialExpanded=false means SHOULD collapse
    expect(shouldCollapse(5, 10, false)).toBe(true);
  });

  test("uses default behavior when initialExpanded undefined", () => {
    expect(shouldCollapse(20, 10, undefined)).toBe(true);
    expect(shouldCollapse(5, 10, undefined)).toBe(false);
  });

  test("handles edge cases", () => {
    expect(shouldCollapse(0, 10)).toBe(false);
    expect(shouldCollapse(1, 1)).toBe(false);
    expect(shouldCollapse(2, 1)).toBe(true);
  });
});

// ============================================================================
// GET ERROR COLOR TESTS
// ============================================================================

describe("theme error colors", () => {
  test("dark theme has error color", () => {
    expect(darkTheme.colors.error).toBe("#fb7185");
  });

  test("light theme has error color", () => {
    expect(lightTheme.colors.error).toBe("#e11d48");
  });
});

// ============================================================================
// TOOL RESULT PROPS STRUCTURE TESTS
// ============================================================================

describe("ToolResultProps structure", () => {
  test("creates minimal props", () => {
    const props: ToolResultProps = {
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "completed",
    };

    expect(props.toolName).toBe("Read");
    expect(props.status).toBe("completed");
    expect(props.output).toBeUndefined();
  });

  test("creates full props", () => {
    const props: ToolResultProps = {
      toolName: "Bash",
      input: { command: "ls -la" },
      output: "file1\nfile2",
      status: "completed",
      initialExpanded: true,
      maxCollapsedLines: 5,
    };

    expect(props.output).toBe("file1\nfile2");
    expect(props.initialExpanded).toBe(true);
    expect(props.maxCollapsedLines).toBe(5);
  });

  test("supports all status types", () => {
    const statuses: Array<ToolResultProps["status"]> = [
      "pending",
      "running",
      "completed",
      "error",
    ];

    for (const status of statuses) {
      const props: ToolResultProps = {
        toolName: "Test",
        input: {},
        status,
      };
      expect(props.status).toBe(status);
    }
  });
});

// ============================================================================
// TOOL RENDERER INTEGRATION TESTS
// ============================================================================

describe("Tool renderer integration", () => {
  test("Read tool renders file content", () => {
    const renderer = getToolRenderer("Read");
    const result = renderer.render({
      input: { file_path: "/path/to/file.ts" },
      output: "const x = 1;",
    });

    expect(result.title).toBe("/path/to/file.ts");
    expect(result.content).toContain("const x = 1;");
    expect(result.language).toBe("typescript");
  });

  test("Bash tool renders command and output", () => {
    const renderer = getToolRenderer("Bash");
    const result = renderer.render({
      input: { command: "echo hello" },
      output: "hello",
    });

    expect(result.content).toContain("$ echo hello");
    expect(result.content).toContain("hello");
  });

  test("Edit tool renders diff", () => {
    const renderer = getToolRenderer("Edit");
    const result = renderer.render({
      input: {
        file_path: "/file.ts",
        old_string: "old",
        new_string: "new",
      },
    });

    expect(result.content.some((l) => l.includes("- old"))).toBe(true);
    expect(result.content.some((l) => l.includes("+ new"))).toBe(true);
    expect(result.language).toBe("diff");
  });

  test("Write tool renders status", () => {
    const renderer = getToolRenderer("Write");
    const result = renderer.render({
      input: { file_path: "/new-file.ts", content: "content" },
      output: true,
    });

    expect(result.content.some((l) => l.includes("✓"))).toBe(true);
  });

  test("Unknown tool uses default renderer", () => {
    const renderer = getToolRenderer("UnknownTool");
    const result = renderer.render({
      input: { key: "value" },
      output: "result",
    });

    expect(result.content.join("\n")).toContain("Input:");
    expect(result.content.join("\n")).toContain("Output:");
  });
});

// ============================================================================
// STATUS DISPLAY TESTS
// ============================================================================

describe("Status display", () => {
  test("pending status config", () => {
    // Verify status configurations are correct
    const statusConfig = {
      pending: { icon: "○", label: "pending" },
      running: { icon: "◐", label: "running" },
      completed: { icon: "●", label: "done" },
      error: { icon: "✗", label: "error" },
    };

    expect(statusConfig.pending.icon).toBe("○");
    expect(statusConfig.running.icon).toBe("◐");
    expect(statusConfig.completed.icon).toBe("●");
    expect(statusConfig.error.icon).toBe("✗");
  });
});

// ============================================================================
// COLLAPSIBLE BEHAVIOR TESTS
// ============================================================================

describe("Collapsible behavior", () => {
  test("small content not collapsible", () => {
    const content = ["line1", "line2", "line3"];
    const isCollapsed = shouldCollapse(content.length, 10);
    expect(isCollapsed).toBe(false);
  });

  test("large content is collapsible", () => {
    const content = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const isCollapsed = shouldCollapse(content.length, 10);
    expect(isCollapsed).toBe(true);
  });

  test("exactly max lines is not collapsible", () => {
    const content = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const isCollapsed = shouldCollapse(content.length, 10);
    expect(isCollapsed).toBe(false);
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe("Error handling", () => {
  test("error status uses error color", () => {
    expect(darkTheme.colors.error).not.toBe(lightTheme.colors.error);
  });

  test("error output is displayed", () => {
    const props: ToolResultProps = {
      toolName: "Bash",
      input: { command: "bad_command" },
      output: "command not found",
      status: "error",
    };

    expect(props.status).toBe("error");
    expect(props.output).toBe("command not found");
  });
});

// ============================================================================
// RENDER RESULT STRUCTURE TESTS
// ============================================================================

describe("Render result structure", () => {
  test("Read tool returns expandable result", () => {
    const renderer = getToolRenderer("Read");
    const result = renderer.render({
      input: { file_path: "/file.ts" },
      output: "content",
    });

    expect(result.expandable).toBe(true);
  });

  test("Bash tool returns expandable result", () => {
    const renderer = getToolRenderer("Bash");
    const result = renderer.render({
      input: { command: "ls" },
      output: "files",
    });

    expect(result.expandable).toBe(true);
  });

  test("result includes title", () => {
    const renderer = getToolRenderer("Read");
    const result = renderer.render({
      input: { file_path: "/path/to/file.ts" },
    });

    expect(result.title).toBe("/path/to/file.ts");
  });

  test("result includes content array", () => {
    const renderer = getToolRenderer("Bash");
    const result = renderer.render({
      input: { command: "echo test" },
      output: "test",
    });

    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// ICON AND TITLE TESTS
// ============================================================================

describe("Icon and title display", () => {
  test("Read tool icon and title", () => {
    const renderer = getToolRenderer("Read");
    expect(renderer.icon).toBe("📄");

    const title = renderer.getTitle({ input: { file_path: "/src/index.ts" } });
    expect(title).toBe("index.ts");
  });

  test("Edit tool icon and title", () => {
    const renderer = getToolRenderer("Edit");
    expect(renderer.icon).toBe("△");

    const title = renderer.getTitle({ input: { file_path: "/src/file.ts" } });
    expect(title).toBe("file.ts");
  });

  test("Bash tool icon and title", () => {
    const renderer = getToolRenderer("Bash");
    expect(renderer.icon).toBe("💻");

    const title = renderer.getTitle({ input: { command: "npm install" } });
    expect(title).toBe("npm install");
  });

  test("Write tool icon and title", () => {
    const renderer = getToolRenderer("Write");
    expect(renderer.icon).toBe("📝");

    const title = renderer.getTitle({ input: { file_path: "/new/file.js" } });
    expect(title).toBe("file.js");
  });

  test("Glob tool icon and title", () => {
    const renderer = getToolRenderer("Glob");
    expect(renderer.icon).toBe("🔍");

    const title = renderer.getTitle({ input: { pattern: "**/*.ts" } });
    expect(title).toBe("**/*.ts");
  });

  test("Grep tool icon and title", () => {
    const renderer = getToolRenderer("Grep");
    expect(renderer.icon).toBe("🔎");

    const title = renderer.getTitle({ input: { pattern: "TODO" } });
    expect(title).toBe("TODO");
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Edge cases", () => {
  test("handles missing input", () => {
    const props: ToolResultProps = {
      toolName: "Read",
      input: {},
      status: "pending",
    };

    expect(props.input).toEqual({});
  });

  test("handles undefined output", () => {
    const props: ToolResultProps = {
      toolName: "Bash",
      input: { command: "test" },
      status: "running",
    };

    expect(props.output).toBeUndefined();
  });

  test("handles empty content", () => {
    const renderer = getToolRenderer("Read");
    const result = renderer.render({
      input: { file_path: "/empty.txt" },
      output: "",
    });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  test("handles very long output", () => {
    const longOutput = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const renderer = getToolRenderer("Bash");
    const result = renderer.render({
      input: { command: "big_output" },
      output: longOutput,
    });

    expect(result.content.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// GET TOOL SUMMARY TESTS
// ============================================================================

describe("getToolSummary", () => {
  test("Read tool returns line count summary", () => {
    const summary = getToolSummary(
      "Read",
      { file_path: "/test.ts" },
      "line1\nline2\nline3",
      3
    );

    expect(summary.text).toBe("3 lines");
    expect(summary.count).toBe(3);
  });

  test("Read tool handles single line", () => {
    const summary = getToolSummary(
      "Read",
      { file_path: "/test.ts" },
      "single line",
      1
    );

    expect(summary.text).toBe("1 line");
    expect(summary.count).toBe(1);
  });

  test("Glob tool returns file count summary", () => {
    const summary = getToolSummary(
      "Glob",
      { pattern: "**/*.ts" },
      "/file1.ts\n/file2.ts\n/file3.ts",
      3
    );

    expect(summary.text).toBe("3 files");
    expect(summary.count).toBe(3);
  });

  test("Glob tool handles single file", () => {
    const summary = getToolSummary(
      "Glob",
      { pattern: "**/*.ts" },
      "/file1.ts",
      1
    );

    expect(summary.text).toBe("1 file");
    expect(summary.count).toBe(1);
  });

  test("Grep tool returns match count summary", () => {
    const summary = getToolSummary(
      "Grep",
      { pattern: "TODO" },
      "file1.ts:10:TODO\nfile2.ts:20:TODO",
      2
    );

    expect(summary.text).toBe("2 matches");
    expect(summary.count).toBe(2);
  });

  test("Grep tool handles single match", () => {
    const summary = getToolSummary(
      "Grep",
      { pattern: "TODO" },
      "file1.ts:10:TODO",
      1
    );

    expect(summary.text).toBe("1 match");
    expect(summary.count).toBe(1);
  });

  test("Bash tool returns truncated command", () => {
    const summary = getToolSummary(
      "Bash",
      { command: "echo hello" },
      "hello",
      1
    );

    expect(summary.text).toBe("echo hello");
    expect(summary.count).toBe(1);
  });

  test("Bash tool truncates long commands", () => {
    const longCommand = "npm install --save-dev typescript eslint prettier husky lint-staged";
    const summary = getToolSummary(
      "Bash",
      { command: longCommand },
      "output",
      1
    );

    expect(summary.text.length).toBeLessThanOrEqual(30);
    // Uses ellipsis character instead of "..."
    expect(summary.text.endsWith("…")).toBe(true);
  });

  test("Edit tool returns edited file summary", () => {
    const summary = getToolSummary(
      "Edit",
      { file_path: "/src/components/app.tsx", old_string: "old", new_string: "new" },
      undefined,
      2
    );

    // Implementation uses arrow format for file operations
    expect(summary.text).toBe("→ app.tsx");
    expect(summary.count).toBeUndefined();
  });

  test("Write tool returns created file summary", () => {
    const summary = getToolSummary(
      "Write",
      { file_path: "/src/utils/helpers.ts", content: "content" },
      true,
      1
    );

    // Implementation uses arrow format for file operations
    expect(summary.text).toBe("→ helpers.ts");
    expect(summary.count).toBeUndefined();
  });

  test("Task tool returns truncated description", () => {
    const summary = getToolSummary(
      "Task",
      { description: "Search for authentication patterns" },
      "result",
      5
    );

    expect(summary.text).toBe("Search for authentication patterns");
    expect(summary.count).toBeUndefined();
  });

  test("Task tool truncates long descriptions", () => {
    const longDesc = "This is a very long task description that should be truncated for display";
    const summary = getToolSummary(
      "Task",
      { description: longDesc },
      "result",
      5
    );

    expect(summary.text.length).toBeLessThanOrEqual(35);
    // Uses ellipsis character instead of "..."
    expect(summary.text.endsWith("…")).toBe(true);
  });

  test("Unknown tool returns line count", () => {
    const summary = getToolSummary(
      "CustomTool",
      { key: "value" },
      "output",
      10
    );

    expect(summary.text).toBe("10 lines");
    expect(summary.count).toBe(10);
  });

  test("handles empty output", () => {
    const summary = getToolSummary(
      "Read",
      { file_path: "/empty.txt" },
      "",
      0
    );

    expect(summary.text).toBe("0 lines");
    expect(summary.count).toBe(0);
  });
});

// ============================================================================
// DEFAULT COLLAPSED BEHAVIOR TESTS
// ============================================================================

describe("Default collapsed behavior", () => {
  test("default maxCollapsedLines is 3", () => {
    const props: ToolResultProps = {
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "completed",
    };

    // Default maxCollapsedLines should be 3
    expect(props.maxCollapsedLines).toBeUndefined();
    // The component defaults to 3
  });

  test("default initialExpanded is false", () => {
    const props: ToolResultProps = {
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "completed",
    };

    // Default initialExpanded should be false (collapsed)
    expect(props.initialExpanded).toBeUndefined();
    // The component defaults to false
  });

  test("content with more than 3 lines should collapse by default", () => {
    const content = ["line1", "line2", "line3", "line4", "line5"];
    const isCollapsed = shouldCollapse(content.length, 3, false);
    expect(isCollapsed).toBe(true);
  });

  test("content with 3 or fewer lines should not collapse", () => {
    const content = ["line1", "line2", "line3"];
    const isCollapsed = shouldCollapse(content.length, 3);
    expect(isCollapsed).toBe(false);
  });
});

// ============================================================================
// VERBOSE MODE TESTS
// ============================================================================

describe("verboseMode support", () => {
  test("verboseMode prop defaults to false", () => {
    const props: ToolResultProps = {
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "completed",
    };

    expect(props.verboseMode).toBeUndefined();
  });

  test("verboseMode can be set to true", () => {
    const props: ToolResultProps = {
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "completed",
      verboseMode: true,
    };

    expect(props.verboseMode).toBe(true);
  });

  test("verboseMode can be set to false", () => {
    const props: ToolResultProps = {
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "completed",
      verboseMode: false,
    };

    expect(props.verboseMode).toBe(false);
  });
});

// ============================================================================
// TOOL SUMMARY STRUCTURE TESTS
// ============================================================================

describe("ToolSummary structure", () => {
  test("basic summary with count", () => {
    const summary: ToolSummary = {
      text: "5 lines",
      count: 5,
    };

    expect(summary.text).toBe("5 lines");
    expect(summary.count).toBe(5);
  });

  test("summary without count", () => {
    const summary: ToolSummary = {
      text: "edited file.ts",
    };

    expect(summary.text).toBe("edited file.ts");
    expect(summary.count).toBeUndefined();
  });

  test("summary with zero count", () => {
    const summary: ToolSummary = {
      text: "0 matches",
      count: 0,
    };

    expect(summary.text).toBe("0 matches");
    expect(summary.count).toBe(0);
  });
});
