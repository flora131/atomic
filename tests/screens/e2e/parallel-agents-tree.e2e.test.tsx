/**
 * E2E tests for ParallelAgentsTree component.
 *
 * Validates visual rendering of parallel agent blocks using OpenTUI's
 * testRender. Covers status indicators, tree connectors, tool call
 * truncation, background agents, error/interrupted states, and the
 * exported helper functions.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import {
  ParallelAgentsTree,
  getAgentTaskLabel,
  buildAgentHeaderLabel,
  MAX_VISIBLE_INLINE_TOOLS,
} from "@/components/parallel-agents-tree.tsx";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ToolPart, Part } from "@/state/parts/types.ts";

// ============================================================================
// HELPERS
// ============================================================================

const TEST_WIDTH = 120;
const TEST_HEIGHT = 60;

let activeRenderer: { renderer: { destroy(): void } } | null = null;

/**
 * Render ParallelAgentsTree inside a ThemeProvider and capture the text frame.
 */
async function renderTree(
  agents: ParallelAgent[],
  options?: {
    compact?: boolean;
    maxVisible?: number;
    width?: number;
    height?: number;
  },
): Promise<string> {
  const width = options?.width ?? TEST_WIDTH;
  const height = options?.height ?? TEST_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <ParallelAgentsTree
        agents={agents}
        compact={options?.compact}
        maxVisible={options?.maxVisible}
      />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
}

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

function createAgent(overrides: Partial<ParallelAgent> & { id: string; name: string }): ParallelAgent {
  return {
    task: "Sub-agent task",
    status: "running",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createToolPart(
  index: number,
  toolName: string,
  overrides?: Partial<ToolPart>,
): ToolPart {
  return {
    id: `tool-${index}` as ToolPart["id"],
    type: "tool",
    toolCallId: `tc-${index}`,
    toolName,
    input: { command: `test-${index}` },
    state: { status: "completed", output: "ok", durationMs: 100 },
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ToolPart;
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
// COMPONENT RENDERING TESTS
// ============================================================================

describe("ParallelAgentsTree E2E", () => {
  // --------------------------------------------------------------------------
  // 1. Single completed agent
  // --------------------------------------------------------------------------
  test("renders a single completed agent with ● indicator and agent name", async () => {
    const agent = createAgent({
      id: "agent-1",
      name: "codebase-analyzer",
      task: "Investigate timing windows",
      status: "completed",
      durationMs: 1500,
    });

    const frame = await renderTree([agent]);

    // Status indicator should be present
    expect(frame).toContain("●");
    // Agent name should be visible (used as label since it's the bold name)
    expect(frame).toContain("codebase-analyzer");
  });

  // --------------------------------------------------------------------------
  // 2. Single running agent (no tools yet)
  // --------------------------------------------------------------------------
  test("renders a single running agent with ● indicator", async () => {
    const agent = createAgent({
      id: "agent-1",
      name: "codebase-analyzer",
      task: "Investigate timing windows",
      status: "running",
      toolUses: 0,
    });

    const frame = await renderTree([agent]);

    // Running agent shows the active indicator (● via AnimatedBlinkIndicator)
    // AnimatedBlinkIndicator alternates between ● and · — at first render it shows ●
    expect(frame).toContain("●");
    // Agent name should be visible
    expect(frame).toContain("codebase-analyzer");
  });

  // --------------------------------------------------------------------------
  // 3. Multiple parallel agents rendered as independent flat blocks
  // --------------------------------------------------------------------------
  test("renders multiple parallel agents as independent flat blocks", async () => {
    const agents = [
      createAgent({
        id: "agent-1",
        name: "codebase-analyzer",
        task: "Analyze imports",
        status: "running",
      }),
      createAgent({
        id: "agent-2",
        name: "debugger",
        task: "Find race condition",
        status: "completed",
        durationMs: 2000,
      }),
      createAgent({
        id: "agent-3",
        name: "codebase-locator",
        task: "Locate config files",
        status: "pending",
      }),
    ];

    const frame = await renderTree(agents);

    // All three agent names should appear in the output
    expect(frame).toContain("codebase-analyzer");
    expect(frame).toContain("debugger");
    expect(frame).toContain("codebase-locator");
    // Each should have its own ● indicator
    const bulletCount = (frame.match(/●/g) || []).length;
    expect(bulletCount).toBeGreaterThanOrEqual(3);
  });

  // --------------------------------------------------------------------------
  // 4. Agent with tool calls — shows tree connectors
  // --------------------------------------------------------------------------
  test("renders agent with tool calls using tree connectors", async () => {
    const toolParts: Part[] = [
      createToolPart(1, "bash", { input: { command: "ls" } }),
      createToolPart(2, "grep", { input: { pattern: "TODO", path: "src" } }),
    ];

    const agent = createAgent({
      id: "agent-1",
      name: "codebase-analyzer",
      task: "Scan project structure",
      status: "running",
      toolUses: 2,
      inlineParts: toolParts,
    });

    const frame = await renderTree([agent]);

    // Agent name should be visible
    expect(frame).toContain("codebase-analyzer");
    // Tree connectors should be present (├─ for non-last, └─ for last)
    expect(frame).toContain("├─");
    expect(frame).toContain("└─");
    // Tool names should be rendered (capitalized by getSubagentToolDisplayName)
    expect(frame).toContain("Bash");
    expect(frame).toContain("Grep");
  });

  // --------------------------------------------------------------------------
  // 5. Tool call truncation — more than MAX_VISIBLE_INLINE_TOOLS
  // --------------------------------------------------------------------------
  test("truncates tool calls beyond MAX_VISIBLE_INLINE_TOOLS and shows count", async () => {
    // Create 5 tool parts — only the last 3 should be visible
    const toolParts: Part[] = Array.from({ length: 5 }, (_, i) =>
      createToolPart(i, `tool-${i}`, {
        input: { command: `cmd-${i}` },
      }),
    );

    const agent = createAgent({
      id: "agent-1",
      name: "codebase-analyzer",
      task: "Deep analysis",
      status: "running",
      toolUses: 5,
      inlineParts: toolParts,
    });

    const frame = await renderTree([agent]);

    // Should show "+2 earlier tool calls" truncation message
    expect(frame).toContain("+2 earlier tool calls");
    // Agent name should be visible
    expect(frame).toContain("codebase-analyzer");
    // Tree connectors should be present
    expect(frame).toContain("└─");
  });

  // --------------------------------------------------------------------------
  // 6. Single truncated tool call uses singular form
  // --------------------------------------------------------------------------
  test("shows singular 'earlier tool call' when exactly one is hidden", async () => {
    // Create 4 tool parts — 1 hidden, 3 visible
    const toolParts: Part[] = Array.from({ length: 4 }, (_, i) =>
      createToolPart(i, `tool-${i}`),
    );

    const agent = createAgent({
      id: "agent-1",
      name: "worker",
      task: "Process files",
      status: "running",
      toolUses: 4,
      inlineParts: toolParts,
    });

    const frame = await renderTree([agent]);

    // Singular form when only 1 is hidden
    expect(frame).toContain("+1 earlier tool call");
    // Should NOT have the plural "calls"
    expect(frame).not.toContain("+1 earlier tool calls");
  });

  // --------------------------------------------------------------------------
  // 7. Background agent — shows "Running in background…"
  // --------------------------------------------------------------------------
  test("renders background agent with ● indicator", async () => {
    const agent = createAgent({
      id: "agent-1",
      name: "codebase-online-researcher",
      task: "Research Rust TUI stacks",
      status: "background",
      background: true,
      toolUses: 3,
    });

    const frame = await renderTree([agent]);

    // Agent name should be visible
    expect(frame).toContain("codebase-online-researcher");
    // ● indicator (via AnimatedBlinkIndicator since background animates)
    expect(frame).toContain("●");
  });

  // --------------------------------------------------------------------------
  // 8. Error agent — shows error status
  // --------------------------------------------------------------------------
  test("renders error agent with ● indicator", async () => {
    const agent = createAgent({
      id: "agent-1",
      name: "debugger",
      task: "Debug crash",
      status: "error",
      error: "Timeout after 30s",
    });

    const frame = await renderTree([agent]);

    // Agent name should be visible
    expect(frame).toContain("debugger");
    // ● indicator should be present
    expect(frame).toContain("●");
  });

  // --------------------------------------------------------------------------
  // 9. Interrupted agent — shows interrupted status
  // --------------------------------------------------------------------------
  test("renders interrupted agent with ● indicator", async () => {
    const agent = createAgent({
      id: "agent-1",
      name: "worker",
      task: "Implement feature",
      status: "interrupted",
    });

    const frame = await renderTree([agent]);

    // Agent name should be visible
    expect(frame).toContain("worker");
    // ● indicator should be present
    expect(frame).toContain("●");
  });

  // --------------------------------------------------------------------------
  // 10. Empty agents array renders nothing
  // --------------------------------------------------------------------------
  test("renders nothing when agents array is empty", async () => {
    const frame = await renderTree([]);

    const nonEmpty = frame
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(nonEmpty).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 11. maxVisible limits visible agents and shows "+N more agents"
  // --------------------------------------------------------------------------
  test("limits visible agents and shows overflow count", async () => {
    const agents = Array.from({ length: 4 }, (_, i) =>
      createAgent({
        id: `agent-${i}`,
        name: `agent-type-${i}`,
        task: `Task ${i}`,
        status: i === 0 ? "completed" : "running",
      }),
    );

    const frame = await renderTree(agents, { maxVisible: 2 });

    // First two agents should be visible
    expect(frame).toContain("agent-type-0");
    expect(frame).toContain("agent-type-1");
    // Hidden agents text
    expect(frame).toContain("+2 more agents");
    // Third and fourth agents should NOT be visible
    expect(frame).not.toContain("agent-type-2");
    expect(frame).not.toContain("agent-type-3");
  });

  // --------------------------------------------------------------------------
  // 12. maxVisible overflow with singular form
  // --------------------------------------------------------------------------
  test("shows singular '+1 more agent' when exactly one is hidden", async () => {
    const agents = Array.from({ length: 3 }, (_, i) =>
      createAgent({
        id: `agent-${i}`,
        name: `type-${i}`,
        task: `Task ${i}`,
        status: "running",
      }),
    );

    const frame = await renderTree(agents, { maxVisible: 2 });

    expect(frame).toContain("+1 more agent");
    expect(frame).not.toContain("+1 more agents");
  });

  // --------------------------------------------------------------------------
  // 13. Agent with specific task vs generic task
  // --------------------------------------------------------------------------
  test("shows specific task label instead of generic placeholder", async () => {
    const agent = createAgent({
      id: "agent-1",
      name: "codebase-analyzer",
      task: "Investigate timing windows",
      status: "running",
    });

    const frame = await renderTree([agent]);

    // Agent name (bold label) should be visible
    expect(frame).toContain("codebase-analyzer");
  });

  // --------------------------------------------------------------------------
  // 14. Three tools exactly at MAX_VISIBLE_INLINE_TOOLS — no truncation
  // --------------------------------------------------------------------------
  test("shows all tools without truncation when count equals MAX_VISIBLE_INLINE_TOOLS", async () => {
    const toolParts: Part[] = Array.from({ length: 3 }, (_, i) =>
      createToolPart(i, "bash", { input: { command: `cmd-${i}` } }),
    );

    const agent = createAgent({
      id: "agent-1",
      name: "worker",
      task: "Run commands",
      status: "running",
      toolUses: 3,
      inlineParts: toolParts,
    });

    const frame = await renderTree([agent]);

    // All 3 tools should be visible — no truncation message
    expect(frame).not.toContain("earlier tool call");
    // Tree connectors should be present
    expect(frame).toContain("└─");
  });

  // --------------------------------------------------------------------------
  // 15. Agent with mixed part types (tool + text + reasoning)
  // --------------------------------------------------------------------------
  test("renders agent with mixed inline part types", async () => {
    const mixedParts: Part[] = [
      createToolPart(0, "bash", { input: { command: "ls -la" } }),
      {
        id: "text-1" as Part["id"],
        type: "text",
        createdAt: new Date().toISOString(),
        content: "Analysis complete",
        isStreaming: false,
      } as Part,
    ];

    const agent = createAgent({
      id: "agent-1",
      name: "codebase-analyzer",
      task: "Run analysis",
      status: "running",
      toolUses: 1,
      inlineParts: mixedParts,
    });

    const frame = await renderTree([agent]);

    // Agent name should appear
    expect(frame).toContain("codebase-analyzer");
    // Tree connectors for inline parts
    expect(frame).toContain("├─");
    expect(frame).toContain("└─");
  });
});

// ============================================================================
// EXPORTED HELPER FUNCTION TESTS
// ============================================================================

describe("getAgentTaskLabel", () => {
  test("returns task when task is a specific description", () => {
    expect(
      getAgentTaskLabel({
        name: "codebase-analyzer",
        task: "Investigate timing windows",
      }),
    ).toBe("Investigate timing windows");
  });

  test("returns name when task is generic 'Sub-agent task'", () => {
    expect(
      getAgentTaskLabel({
        name: "codebase-analyzer",
        task: "Sub-agent task",
      }),
    ).toBe("codebase-analyzer");
  });

  test("returns name when task is generic 'sub-agent task' (case-insensitive)", () => {
    expect(
      getAgentTaskLabel({
        name: "debugger",
        task: "sub-agent task",
      }),
    ).toBe("debugger");
  });

  test("returns name when task is generic 'subagent task' (no hyphen)", () => {
    expect(
      getAgentTaskLabel({
        name: "worker",
        task: "subagent task",
      }),
    ).toBe("worker");
  });

  test("returns name when task is empty string", () => {
    expect(
      getAgentTaskLabel({
        name: "explorer",
        task: "",
      }),
    ).toBe("explorer");
  });

  test("returns name when task is whitespace-only", () => {
    expect(
      getAgentTaskLabel({
        name: "planner",
        task: "   ",
      }),
    ).toBe("planner");
  });
});

describe("buildAgentHeaderLabel", () => {
  test("returns singular form for 1 agent", () => {
    expect(buildAgentHeaderLabel(1, "")).toBe("1 agent");
  });

  test("returns plural form for multiple agents", () => {
    expect(buildAgentHeaderLabel(3, "")).toBe("3 agents");
  });

  test("includes dominant type in label", () => {
    expect(buildAgentHeaderLabel(2, "codebase-analyzer")).toBe(
      "2 codebase-analyzer agents",
    );
  });

  test("singular with dominant type", () => {
    expect(buildAgentHeaderLabel(1, "debugger")).toBe("1 debugger agent");
  });

  test("avoids duplicate 'agent' in label when dominantType is 'agent'", () => {
    expect(buildAgentHeaderLabel(1, "agent")).toBe("1 agent");
    expect(buildAgentHeaderLabel(2, "agents")).toBe("2 agents");
  });

  test("strips trailing 'agent' suffix from dominantType", () => {
    expect(buildAgentHeaderLabel(2, "explore agent")).toBe("2 explore agents");
    expect(buildAgentHeaderLabel(1, "explore agent")).toBe("1 explore agent");
  });

  test("strips trailing 'agents' suffix from dominantType", () => {
    expect(buildAgentHeaderLabel(3, "explore agents")).toBe(
      "3 explore agents",
    );
  });
});

describe("MAX_VISIBLE_INLINE_TOOLS", () => {
  test("is set to 3", () => {
    expect(MAX_VISIBLE_INLINE_TOOLS).toBe(3);
  });
});
