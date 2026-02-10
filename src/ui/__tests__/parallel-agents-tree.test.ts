/**
 * Tests for ParallelAgentsTree utility functions
 *
 * Covers Feature 6: Sub-status text defaults
 * - getSubStatusText returns currentTool when set
 * - getSubStatusText returns "Initializing..." for running agents without currentTool
 * - getSubStatusText returns "Done" for completed agents without currentTool
 * - getSubStatusText returns error message for error agents
 * - getSubStatusText returns null for background agents without currentTool
 */

import { describe, test, expect } from "bun:test";
import {
  getSubStatusText,
  getAgentColor,
  getStatusIcon,
  formatDuration,
  truncateText,
  type ParallelAgent,
} from "../components/parallel-agents-tree.tsx";

// ============================================================================
// getSubStatusText Tests
// ============================================================================

describe("getSubStatusText", () => {
  function makeAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
    return {
      id: "test-1",
      name: "Explore",
      task: "Find files",
      status: "running",
      startedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  test("returns currentTool when set on a running agent", () => {
    const agent = makeAgent({ status: "running", currentTool: "Bash: grep -r 'foo'" });
    expect(getSubStatusText(agent)).toBe("Bash: grep -r 'foo'");
  });

  test("returns currentTool when set on a completed agent", () => {
    const agent = makeAgent({ status: "completed", currentTool: "Read: file.ts" });
    expect(getSubStatusText(agent)).toBe("Read: file.ts");
  });

  test("returns 'Initializing...' for running agent without currentTool", () => {
    const agent = makeAgent({ status: "running" });
    expect(getSubStatusText(agent)).toBe("Initializing...");
  });

  test("returns 'Initializing...' for pending agent without currentTool", () => {
    const agent = makeAgent({ status: "pending" });
    expect(getSubStatusText(agent)).toBe("Initializing...");
  });

  test("returns 'Done' for completed agent without currentTool", () => {
    const agent = makeAgent({ status: "completed" });
    expect(getSubStatusText(agent)).toBe("Done");
  });

  test("returns error message for error agent without currentTool", () => {
    const agent = makeAgent({ status: "error", error: "Connection refused" });
    expect(getSubStatusText(agent)).toBe("Connection refused");
  });

  test("returns 'Error' for error agent without currentTool or error message", () => {
    const agent = makeAgent({ status: "error" });
    expect(getSubStatusText(agent)).toBe("Error");
  });

  test("returns null for background agent without currentTool", () => {
    const agent = makeAgent({ status: "background" });
    expect(getSubStatusText(agent)).toBeNull();
  });

  test("currentTool takes precedence over default status text", () => {
    // Even for completed agents, if currentTool is still set, show it
    const agent = makeAgent({ status: "error", error: "Some error", currentTool: "Finishing up..." });
    expect(getSubStatusText(agent)).toBe("Finishing up...");
  });
});

// ============================================================================
// Existing Utility Functions Tests
// ============================================================================

describe("getAgentColor", () => {
  test("returns correct Catppuccin Mocha color for known agent types (default)", () => {
    expect(getAgentColor("Explore")).toBe("#89b4fa");   // Mocha Blue
    expect(getAgentColor("Plan")).toBe("#cba6f7");      // Mocha Mauve
    expect(getAgentColor("debugger")).toBe("#f38ba8");   // Mocha Red
  });

  test("returns Catppuccin Latte colors when isDark=false", () => {
    expect(getAgentColor("Explore", false)).toBe("#1e66f5");  // Latte Blue
    expect(getAgentColor("Plan", false)).toBe("#8839ef");     // Latte Mauve
    expect(getAgentColor("debugger", false)).toBe("#d20f39"); // Latte Red
  });

  test("returns default color for unknown agent types", () => {
    expect(getAgentColor("unknown-agent")).toBe("#6c7086"); // Mocha Overlay 0
  });
});

describe("getStatusIcon", () => {
  test("returns correct icons for each status", () => {
    expect(getStatusIcon("pending")).toBe("○");
    expect(getStatusIcon("running")).toBe("●");
    expect(getStatusIcon("completed")).toBe("●");
    expect(getStatusIcon("error")).toBe("●");
    expect(getStatusIcon("background")).toBe("◌");
  });
});

describe("formatDuration", () => {
  test("returns empty string for undefined", () => {
    expect(formatDuration(undefined)).toBe("");
  });

  test("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  test("formats seconds", () => {
    expect(formatDuration(3500)).toBe("3s");
  });

  test("formats minutes", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });
});

describe("truncateText", () => {
  test("returns short text unchanged", () => {
    expect(truncateText("hello", 40)).toBe("hello");
  });

  test("truncates long text with ellipsis", () => {
    const long = "a".repeat(50);
    const result = truncateText(long, 40);
    expect(result.length).toBe(40);
    expect(result.endsWith("...")).toBe(true);
  });

  test("uses default maxLength of 40", () => {
    const exact = "a".repeat(40);
    expect(truncateText(exact)).toBe(exact);
    const over = "a".repeat(41);
    expect(truncateText(over).length).toBe(40);
  });
});
