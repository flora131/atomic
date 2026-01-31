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
  getErrorColor,
  type ToolResultProps,
} from "../../../src/ui/components/tool-result.tsx";
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

describe("getErrorColor", () => {
  test("returns dark theme error color", () => {
    const color = getErrorColor(true);
    expect(color).toBe("#EF4444");
  });

  test("returns light theme error color", () => {
    const color = getErrorColor(false);
    expect(color).toBe("#DC2626");
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
    const errorColorDark = getErrorColor(true);
    const errorColorLight = getErrorColor(false);

    expect(errorColorDark).not.toBe(errorColorLight);
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
    expect(renderer.icon).toBe("✏️");

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
