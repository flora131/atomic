import { describe, expect, test } from "bun:test";
import {
  buildAgentHeaderLabel,
  buildAgentInlinePrefix,
  deduplicateAgents,
  getAgentInlineDisplayParts,
  getAgentTaskLabel,
  getBackgroundSubStatusText,
  getStatusIndicatorColor,
  shouldAnimateAgentStatus,
} from "./parallel-agents-tree.tsx";
import type { Part } from "../parts/types.ts";
import type { ParallelAgent } from "./parallel-agents-tree.tsx";
import { PART_REGISTRY } from "./parts/registry.tsx";
import { buildParallelAgentsHeaderHint } from "../utils/background-agent-tree-hints.ts";
import { BACKGROUND_TREE_HINT_CONTRACT } from "../utils/background-agent-contracts.ts";

describe("ParallelAgentsTree status indicator colors", () => {
  const colors = {
    muted: "#888888",
    success: "#00ff00",
    warning: "#ffff00",
    error: "#ff0000",
  };

  test("renders running and background as muted static indicators", () => {
    expect(getStatusIndicatorColor("running", colors)).toBe(colors.muted);
    expect(getStatusIndicatorColor("background", colors)).toBe(colors.muted);
  });

  test("renders completed as success", () => {
    expect(getStatusIndicatorColor("completed", colors)).toBe(colors.success);
  });

  test("renders pending and interrupted as warning", () => {
    expect(getStatusIndicatorColor("pending", colors)).toBe(colors.warning);
    expect(getStatusIndicatorColor("interrupted", colors)).toBe(colors.warning);
  });

  test("renders error as error color", () => {
    expect(getStatusIndicatorColor("error", colors)).toBe(colors.error);
  });

  test("animates running-style statuses", () => {
    expect(shouldAnimateAgentStatus("running")).toBe(true);
    expect(shouldAnimateAgentStatus("background")).toBe(true);
    expect(shouldAnimateAgentStatus("pending")).toBe(false);
    expect(shouldAnimateAgentStatus("completed")).toBe(false);
    expect(shouldAnimateAgentStatus("error")).toBe(false);
    expect(shouldAnimateAgentStatus("interrupted")).toBe(false);
  });
});

describe("ParallelAgentsTree labeling", () => {
  test("avoids duplicate 'agent agent' header labels", () => {
    expect(buildAgentHeaderLabel(1, "agent")).toBe("1 agent");
    expect(buildAgentHeaderLabel(2, "agents")).toBe("2 agents");
    expect(buildAgentHeaderLabel(1, "codebase-online-researcher")).toBe(
      "1 codebase-online-researcher agent"
    );
  });

  test("uses agent name when task label is generic placeholder", () => {
    expect(
      getAgentTaskLabel({
        name: "codebase-online-researcher",
        task: "Sub-agent task",
      })
    ).toBe("codebase-online-researcher");
    expect(
      getAgentTaskLabel({
        name: "codebase-online-researcher",
        task: "Research Rust TUI stacks",
      })
    ).toBe("Research Rust TUI stacks");
  });
});

describe("deduplicateAgents", () => {
  function makeAgent(overrides: Partial<ParallelAgent> & { id: string }): ParallelAgent {
    return {
      name: "reviewer",
      task: "Sub-agent task",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  test("returns same array when no duplicates exist", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "a1", taskToolCallId: "t1", task: "Review code" }),
      makeAgent({ id: "a2", taskToolCallId: "t2", task: "Find bugs" }),
    ];
    expect(deduplicateAgents(agents)).toBe(agents);
  });

  test("merges two agents sharing the same taskToolCallId", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "tool_1", taskToolCallId: "tool_1", task: "", toolUses: 7, currentTool: "read" }),
      makeAgent({ id: "sub_1", taskToolCallId: "tool_1", task: "Review snake TUI", status: "completed" }),
    ];
    const result = deduplicateAgents(agents);
    expect(result.length).toBe(1);
    expect(result[0]!.task).toBe("Review snake TUI");
    expect(result[0]!.toolUses).toBe(7);
    expect(result[0]!.status).toBe("completed");
    expect(result[0]!.id).toBe("sub_1");
  });

  test("prefers non-tool_ id format", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "tool_123", taskToolCallId: "tool_123", task: "" }),
      makeAgent({ id: "ses_abc", taskToolCallId: "tool_123", task: "Real task" }),
    ];
    const result = deduplicateAgents(agents);
    expect(result[0]!.id).toBe("ses_abc");
  });

  test("preserves agents without taskToolCallId", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "a1", task: "Orphan task" }),
      makeAgent({ id: "a2", taskToolCallId: "t1", task: "Grouped task" }),
    ];
    const result = deduplicateAgents(agents);
    expect(result.length).toBe(2);
  });

  test("returns same array when only one agent", () => {
    const agents = [makeAgent({ id: "a1", taskToolCallId: "t1" })];
    expect(deduplicateAgents(agents)).toBe(agents);
  });

  test("takes result and error from either entry", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "tool_1", taskToolCallId: "tool_1", result: "All good" }),
      makeAgent({ id: "sub_1", taskToolCallId: "tool_1", error: "Oops", status: "error" }),
    ];
    const result = deduplicateAgents(agents);
    expect(result[0]!.result).toBe("All good");
    expect(result[0]!.error).toBe("Oops");
  });

  test("merges uncorrelated generic+descriptive duplicates for same agent", () => {
    const agents: ParallelAgent[] = [
      makeAgent({
        id: "agent-generic",
        name: "debugger",
        task: "Sub-agent task",
        toolUses: 12,
      }),
      makeAgent({
        id: "agent-real",
        name: "debugger",
        task: "Debug stuck spinner",
        toolUses: 12,
      }),
    ];

    const result = deduplicateAgents(agents);
    expect(result).toHaveLength(1);
    expect(result[0]!.task).toBe("Debug stuck spinner");
    expect(result[0]!.toolUses).toBe(12);
  });

  test("does not merge uncorrelated descriptive tasks for same agent name", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "agent-1", name: "debugger", task: "Debug stuck spinner" }),
      makeAgent({ id: "agent-2", name: "debugger", task: "Investigate login timeout" }),
    ];

    const result = deduplicateAgents(agents);
    expect(result).toHaveLength(2);
  });

  test("merges mixed-correlation eager placeholder with descriptive SDK row", () => {
    const agents: ParallelAgent[] = [
      makeAgent({
        id: "tool_42",
        taskToolCallId: "tool_42",
        name: "debugger",
        task: "Sub-agent task",
        toolUses: 12,
        currentTool: "glob",
      }),
      makeAgent({
        id: "subagent-42",
        name: "debugger",
        task: "Debug stuck spinner",
        toolUses: 12,
        currentTool: "glob",
      }),
    ];

    const result = deduplicateAgents(agents);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("subagent-42");
    expect(result[0]!.task).toBe("Debug stuck spinner");
    expect(result[0]!.toolUses).toBe(12);
  });

  test("does not merge mixed-correlation rows without eager placeholder shape", () => {
    const agents: ParallelAgent[] = [
      makeAgent({
        id: "agent-tracked",
        taskToolCallId: "external-call-1",
        name: "debugger",
        task: "Sub-agent task",
        toolUses: 12,
      }),
      makeAgent({
        id: "agent-untracked",
        name: "debugger",
        task: "Debug stuck spinner",
        toolUses: 12,
      }),
    ];

    const result = deduplicateAgents(agents);
    expect(result).toHaveLength(2);
  });
});

describe("getBackgroundSubStatusText", () => {
  test("always returns background status text while active", () => {
    const running: ParallelAgent = {
      id: "bg-1",
      name: "codebase-locator",
      task: "Locate APIs",
      status: "background",
      background: true,
      startedAt: "2026-01-01T00:00:00.000Z",
      currentTool: "rg",
      toolUses: 12,
    };
    expect(getBackgroundSubStatusText(running)).toBe("Running codebase-locator in background…");
  });

  test("returns terminal status text for completed, error, interrupted", () => {
    const completed: ParallelAgent = {
      id: "bg-2",
      name: "debugger",
      task: "Investigate",
      status: "completed",
      background: true,
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    const errored: ParallelAgent = {
      ...completed,
      id: "bg-3",
      status: "error",
      error: "Failed",
    };
    const interrupted: ParallelAgent = {
      ...completed,
      id: "bg-4",
      status: "interrupted",
    };

    expect(getBackgroundSubStatusText(completed)).toBe("Done");
    expect(getBackgroundSubStatusText(errored)).toBe("Failed");
    expect(getBackgroundSubStatusText(interrupted)).toBe("Interrupted");
  });
});

describe("buildParallelAgentsHeaderHint integration with ParallelAgent", () => {
  function makeAgent(overrides: Partial<ParallelAgent> & { id: string }): ParallelAgent {
    return {
      name: "reviewer",
      task: "Sub-agent task",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  test("returns running hint for active background agents", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "bg-1", background: true, status: "running" }),
    ];
    expect(buildParallelAgentsHeaderHint(agents, false)).toBe(
      BACKGROUND_TREE_HINT_CONTRACT.whenRunning,
    );
  });

  test("returns completion hint for completed background agents with showExpandHint", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "bg-1", background: true, status: "completed" }),
    ];
    expect(buildParallelAgentsHeaderHint(agents, true)).toBe(
      BACKGROUND_TREE_HINT_CONTRACT.whenComplete,
    );
  });

  test("returns default hint for foreground-only agents with showExpandHint", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "fg-1", status: "completed" }),
    ];
    expect(buildParallelAgentsHeaderHint(agents, true)).toBe(
      BACKGROUND_TREE_HINT_CONTRACT.defaultHint,
    );
  });

  test("returns empty string when no hint should show", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "fg-1", status: "completed" }),
    ];
    expect(buildParallelAgentsHeaderHint(agents, false)).toBe("");
  });
});

describe("agent inline display helpers", () => {
  const expectedInlinePartTypes: Array<Part["type"]> = [
    "agent",
    "compaction",
    "mcp-snapshot",
    "reasoning",
    "skill-load",
    "task-list",
    "text",
    "tool",
  ];

  const inlineParts: Part[] = [
    {
      id: "part-1",
      type: "text",
      createdAt: "2026-01-01T00:00:00.000Z",
      content: "first",
      isStreaming: false,
    },
    {
      id: "part-2",
      type: "reasoning",
      createdAt: "2026-01-01T00:00:01.000Z",
      content: "second",
      durationMs: 0,
      isStreaming: false,
    },
  ];

  test("uses registry renderers for all supported inline part types", () => {
    expect(Object.keys(PART_REGISTRY).sort()).toEqual(expectedInlinePartTypes);
  });

  test("suppresses tool and text parts from inline display", () => {
    const mixedParts: Part[] = [
      {
        id: "part-text",
        type: "text",
        createdAt: "2026-01-01T00:00:00.000Z",
        content: "hello",
        isStreaming: false,
      },
      {
        id: "part-tool",
        type: "tool",
        createdAt: "2026-01-01T00:00:01.000Z",
        toolCallId: "tc-1",
        toolName: "bash",
        input: {},
        state: { status: "pending" },
      },
      {
        id: "part-reasoning",
        type: "reasoning",
        createdAt: "2026-01-01T00:00:02.000Z",
        content: "thinking",
        durationMs: 100,
        isStreaming: false,
      },
    ] as Part[];
    const result = getAgentInlineDisplayParts(mixedParts);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("part-reasoning");
  });

  test("filters out text and tool parts in inline display", () => {
    const result = getAgentInlineDisplayParts(inlineParts);
    // part-1 is "text" (suppressed), part-2 is "reasoning" (kept)
    expect(result).toHaveLength(1);
    expect(result.map((part) => part.id)).toEqual(["part-2"]);
    expect(result.every((part) => Boolean(PART_REGISTRY[part.type]))).toBe(true);
  });

  test("builds tree connector prefix for inline part rows", () => {
    expect(buildAgentInlinePrefix("│ ")).toBe("│    ╰  ");
    expect(buildAgentInlinePrefix("  ")).toBe("     ╰  ");
  });
});
