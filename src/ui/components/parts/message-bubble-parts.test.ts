import { describe, expect, test } from "bun:test";
import type { Part, ReasoningPart, TextPart, ToolPart, AgentPart } from "../../parts/types.ts";
import type { ParallelAgent } from "../parallel-agents-tree.tsx";
import { buildPartRenderKeys, getConsumedTaskToolCallIds, orderPartsForTaskOutputDisplay } from "./message-bubble-parts.tsx";

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
  test("consumes sub-agent dispatch tools even when no AgentParts exist", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "task"),
      createToolPart("tool-2", "task"),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(2);
    expect(consumed.has("tool-1")).toBe(true);
    expect(consumed.has("tool-2")).toBe(true);
  });

  test("does not consume non-subagent tools when no AgentParts exist", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "bash"),
      createToolPart("tool-2", "read"),
    ];
    expect(getConsumedTaskToolCallIds(parts).size).toBe(0);
  });

  test("returns Task toolCallIds that have corresponding agents", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "task"),
      createToolPart("tool-2", "task"),
      createAgentPart([
        createAgent("tool-1", "explorer"),
        createAgent("tool-2", "analyzer"),
      ]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(2);
    expect(consumed.has("tool-1")).toBe(true);
    expect(consumed.has("tool-2")).toBe(true);
  });

  test("consumes any ToolPart whose toolCallId matches an AgentPart (Copilot agent-named tools)", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "codebase-analyzer"),
      createAgentPart([createAgent("tool-1", "explorer")]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(1);
    expect(consumed.has("tool-1")).toBe(true);
  });

  test("still consumes sub-agent dispatch tools even when only some are matched to agents", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "task"),
      createToolPart("tool-2", "task"),
      createAgentPart([createAgent("tool-1", "explorer")]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(2);
    expect(consumed.has("tool-1")).toBe(true);
    expect(consumed.has("tool-2")).toBe(true);
  });

  test("handles PascalCase Task tool name", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "Task"),
      createAgentPart([createAgent("tool-1", "explorer")]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.has("tool-1")).toBe(true);
  });

  test("consumes Copilot agent-name ToolPart when matching AgentPart exists", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "general-purpose"),
      createToolPart("tool-2", "codebase-analyzer"),
      createToolPart("tool-3", "bash"),
      createAgentPart([
        createAgent("tool-1", "general-purpose"),
        createAgent("tool-2", "codebase-analyzer"),
      ]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(2);
    expect(consumed.has("tool-1")).toBe(true);
    expect(consumed.has("tool-2")).toBe(true);
    // tool-3 (bash) has no matching AgentPart, so it should NOT be consumed
    expect(consumed.has("tool-3")).toBe(false);
  });

  test("consumes top-level ToolPart duplicated by agent inline tool activity", () => {
    const inlineTool = createToolPart("inline-tool-1", "bash");
    const parts: Part[] = [
      createToolPart("inline-tool-1", "bash"),
      createToolPart("standalone-tool", "bash"),
      createAgentPart([
        createAgent("task-tool-1", "codebase-analyzer", [inlineTool]),
      ]),
    ];

    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.has("inline-tool-1")).toBe(true);
    expect(consumed.has("standalone-tool")).toBe(false);
  });

  test("consumes duplicated inline tool blocks regardless of tool name", () => {
    const inlineTaskOutput = createToolPart("taskoutput-1", "TaskOutput");
    const parts: Part[] = [
      createToolPart("taskoutput-1", "TaskOutput"),
      createAgentPart([
        createAgent("task-tool-1", "codebase-analyzer", [inlineTaskOutput]),
      ]),
    ];

    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.has("taskoutput-1")).toBe(true);
  });

  test("consumes task ToolPart when agent lacks taskToolCallId (Claude SDK fallback)", () => {
    const agentWithoutId: ParallelAgent = {
      id: "agent-no-id",
      taskToolCallId: undefined,
      name: "codebase-analyzer",
      task: "Explore the repo",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    const parts: Part[] = [
      createToolPart("synth-tool-1", "Task"),
      createAgentPart([agentWithoutId]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(1);
    expect(consumed.has("synth-tool-1")).toBe(true);
  });

  test("consumes task ToolPart when agent taskToolCallId does not match any ToolPart", () => {
    const parts: Part[] = [
      createToolPart("synth-tool-1", "task"),
      createAgentPart([createAgent("toolu_ABC", "explorer")]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(1);
    expect(consumed.has("synth-tool-1")).toBe(true);
  });

  test("consumes all sub-agent dispatch tools regardless of fallback count", () => {
    const agentWithoutId: ParallelAgent = {
      id: "agent-no-id",
      taskToolCallId: undefined,
      name: "explorer",
      task: "Explore",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    const parts: Part[] = [
      createToolPart("tool-1", "task"),
      createToolPart("tool-2", "task"),
      createToolPart("tool-3", "task"),
      createAgentPart([agentWithoutId]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(3);
    expect(consumed.has("tool-1")).toBe(true);
    expect(consumed.has("tool-2")).toBe(true);
    expect(consumed.has("tool-3")).toBe(true);
  });
});
