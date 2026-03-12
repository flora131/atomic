import { describe, expect, test } from "bun:test";
import type { Part, ReasoningPart, TextPart, ToolPart, AgentPart } from "@/state/parts/types.ts";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import { buildPartRenderKeys, getConsumedTaskToolCallIds, orderPartsForTaskOutputDisplay } from "@/components/message-parts/message-bubble-parts.tsx";

function createReasoningPart(id: string, thinkingSourceKey: string): ReasoningPart {
  return {
    id,
    type: "reasoning",
    thinkingSourceKey,
    content: "thinking",
    durationMs: 100,
    isStreaming: true,
    createdAt: "2026-02-23T00:00:00.000Z",
  };
}

function createTextPart(id: string): TextPart {
  return {
    id,
    type: "text",
    content: "answer",
    isStreaming: true,
    createdAt: "2026-02-23T00:00:00.000Z",
  };
}

describe("buildPartRenderKeys", () => {
  test("renders concurrent reasoning sources as isolated source-bound keys", () => {
    const parts: Part[] = [
      createReasoningPart("part_1", "source:a"),
      createReasoningPart("part_2", "source:b"),
      createTextPart("part_3"),
    ];

    expect(buildPartRenderKeys(parts)).toEqual([
      "reasoning-source:source:a",
      "reasoning-source:source:b",
      "part_3",
    ]);
  });

  test("keeps reasoning identity stable across source updates", () => {
    const firstRender = buildPartRenderKeys([createReasoningPart("part_old", "source:a")]);
    const secondRender = buildPartRenderKeys([createReasoningPart("part_new", "source:a")]);

    expect(firstRender).toEqual(["reasoning-source:source:a"]);
    expect(secondRender).toEqual(["reasoning-source:source:a"]);
  });

  test("suffixes duplicate source keys to avoid key collisions", () => {
    const parts: Part[] = [
      createReasoningPart("part_1", "source:a"),
      createReasoningPart("part_2", "source:a"),
    ];

    expect(buildPartRenderKeys(parts)).toEqual([
      "reasoning-source:source:a",
      "reasoning-source:source:a#1",
    ]);
  });
});

describe("orderPartsForTaskOutputDisplay", () => {
  test("preserves part ordering", () => {
    const parts: Part[] = [
      createTextPart("text-1"),
      createToolPart("taskoutput-1", "TaskOutput"),
      createAgentPart([createAgent("task-tool-1", "explorer")]),
      createToolPart("bash-1", "bash"),
    ];

    const ordered = orderPartsForTaskOutputDisplay(parts);
    expect(ordered).toEqual(parts);
  });

  test("preserves ordering when no agent part exists", () => {
    const parts: Part[] = [
      createTextPart("text-1"),
      createToolPart("taskoutput-1", "TaskOutput"),
      createToolPart("bash-1", "bash"),
    ];

    const ordered = orderPartsForTaskOutputDisplay(parts);
    expect(ordered).toEqual(parts);
  });
});

// ============================================================================
// getConsumedTaskToolCallIds
// ============================================================================

function createToolPart(toolCallId: string, toolName: string): ToolPart {
  return {
    id: `part_${toolCallId}`,
    type: "tool",
    toolCallId,
    toolName,
    input: { prompt: "test" },
    state: { status: "running", startedAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function createAgent(
  taskToolCallId: string,
  name: string,
  inlineParts?: Part[],
): ParallelAgent {
  return {
    id: `agent-${taskToolCallId}`,
    taskToolCallId,
    name,
    task: `Task for ${name}`,
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    inlineParts,
  };
}

function createAgentPart(agents: ParallelAgent[], parentToolPartId?: string): AgentPart {
  return {
    id: "agent-part-1",
    type: "agent",
    agents,
    parentToolPartId,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("getConsumedTaskToolCallIds", () => {
  test("does not consume task tool blocks anymore", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "task"),
      createToolPart("tool-2", "task"),
      createAgentPart([
        createAgent("tool-1", "explorer"),
      ]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(0);
  });

  test("returns an empty set regardless of duplicated inline tools", () => {
    const inlineTool = createToolPart("inline-tool-1", "bash");
    const parts: Part[] = [
      createToolPart("inline-tool-1", "bash"),
      createAgentPart([
        createAgent("task-tool-1", "codebase-analyzer", [inlineTool]),
      ]),
    ];

    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(0);
  });
});
