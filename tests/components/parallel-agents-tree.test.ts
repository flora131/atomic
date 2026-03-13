import { describe, expect, test } from "bun:test";
import {
  buildAgentInlineBranchPrefix,
  buildAgentHeaderLabel,
  buildAgentInlinePrefix,
  collectDoneRenderMarkers,
  getForegroundHeaderText,
  getAgentInlineDisplayParts,
  getAgentTaskLabel,
  getBackgroundSubStatusText,
  getStatusIndicatorColor,
  shouldRenderAgentCurrentTool,
  shouldAnimateAgentStatus,
  MAX_VISIBLE_INLINE_TOOLS,
} from "@/components/parallel-agents-tree.tsx";
import type { Part } from "@/state/parts/types.ts";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import { PART_REGISTRY } from "@/components/message-parts/registry.tsx";

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

  test("uses running-style header text for pending-only foreground trees", () => {
    expect(
      getForegroundHeaderText([
        { status: "pending" },
        { status: "pending" },
      ])
    ).toBe("Running 2 agents…");
  });

  test("suppresses initial sub-agent dispatch tool rendering", () => {
    expect(
      shouldRenderAgentCurrentTool({
        status: "running",
        currentTool: "Task",
        toolUses: 1,
      })
    ).toBe(false);

    expect(
      shouldRenderAgentCurrentTool({
        status: "running",
        currentTool: "agent",
        toolUses: 1,
      })
    ).toBe(false);
  });

  test("keeps rendering real tool activity", () => {
    expect(
      shouldRenderAgentCurrentTool({
        status: "running",
        currentTool: "bash",
        toolUses: 1,
      })
    ).toBe(true);
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

describe("collectDoneRenderMarkers", () => {
  test("emits markers only once for completed agents until status changes", () => {
    const emitted = new Set<string>();
    const first = collectDoneRenderMarkers(
      [
        { id: "agent-1", status: "running" },
        { id: "agent-2", status: "completed" },
      ],
      emitted,
    );
    expect(first).toEqual(["agent-2"]);

    const second = collectDoneRenderMarkers(
      [{ id: "agent-2", status: "completed" }],
      emitted,
    );
    expect(second).toEqual([]);

    const third = collectDoneRenderMarkers(
      [{ id: "agent-2", status: "running" }],
      emitted,
    );
    expect(third).toEqual([]);

    const fourth = collectDoneRenderMarkers(
      [{ id: "agent-2", status: "completed" }],
      emitted,
    );
    expect(fourth).toEqual(["agent-2"]);
  });

  test("drops emitted ids when agents disappear from the tree", () => {
    const emitted = new Set<string>(["agent-1"]);
    const markers = collectDoneRenderMarkers(
      [{ id: "agent-2", status: "completed" }],
      emitted,
    );
    expect(markers).toEqual(["agent-2"]);
    expect(emitted.has("agent-1")).toBe(false);
  });

  test("does not emit markers for completed agents hidden by visibility slicing", () => {
    const emitted = new Set<string>();
    const agents = [
      { id: "agent-visible", status: "running" as const },
      { id: "agent-hidden", status: "completed" as const },
    ];

    const markers = collectDoneRenderMarkers(agents.slice(0, 1), emitted);
    expect(markers).toEqual([]);
    expect(emitted.has("agent-hidden")).toBe(false);
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
    "task-result",
    "text",
    "tool",
    "workflow-step",
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

  test("keeps only tool parts in inline display", () => {
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
    expect(result).toHaveLength(3);
    expect(result.map((part) => part.id)).toEqual(["part-text", "part-tool", "part-reasoning"]);
  });

  test("filters unsupported inline part types", () => {
    const result = getAgentInlineDisplayParts(inlineParts);
    expect(result).toHaveLength(2);
    expect(result.every((part) => Boolean(PART_REGISTRY[part.type]))).toBe(true);
  });

  test("builds tree connector prefix for inline part rows", () => {
    expect(buildAgentInlinePrefix("│ ")).toBe("│ └─ ");
    expect(buildAgentInlinePrefix("")).toBe("└─ ");
  });

  test("builds branch-aware prefixes for inline tool rows", () => {
    expect(buildAgentInlineBranchPrefix("│ ", false)).toBe("│ ├─ ");
    expect(buildAgentInlineBranchPrefix("│ ", true)).toBe("│ └─ ");
    expect(buildAgentInlineBranchPrefix("", true)).toBe("└─ ");
  });
});

describe("MAX_VISIBLE_INLINE_TOOLS", () => {
  test("limits inline tool display to 3 items", () => {
    expect(MAX_VISIBLE_INLINE_TOOLS).toBe(3);
  });

  test("getAgentInlineDisplayParts returns all parts for slicing by component", () => {
    const fiveParts: Part[] = Array.from({ length: 5 }, (_, i) => ({
      id: `part-${i}`,
      type: "tool" as const,
      createdAt: `2026-01-01T00:00:0${i}.000Z`,
      toolCallId: `tc-${i}`,
      toolName: "bash",
      input: {},
      state: { status: "completed" as const, output: undefined, durationMs: 0 },
    }));

    const all = getAgentInlineDisplayParts(fiveParts);
    expect(all).toHaveLength(5);

    const hiddenCount = Math.max(0, all.length - MAX_VISIBLE_INLINE_TOOLS);
    const visible = all.slice(-MAX_VISIBLE_INLINE_TOOLS);
    expect(visible).toHaveLength(3);
    expect(hiddenCount).toBe(2);
    expect(visible[0]!.id).toBe("part-2");
    expect(visible[2]!.id).toBe("part-4");
  });
});
