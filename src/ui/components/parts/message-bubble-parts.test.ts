import { describe, expect, test } from "bun:test";
import type { Part, ReasoningPart, TextPart, ToolPart, AgentPart } from "../../parts/types.ts";
import type { ParallelAgent } from "../parallel-agents-tree.tsx";
import { buildPartRenderKeys, getConsumedTaskToolCallIds } from "./message-bubble-parts.tsx";

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

function createAgent(taskToolCallId: string, name: string): ParallelAgent {
  return {
    id: `agent-${taskToolCallId}`,
    taskToolCallId,
    name,
    task: `Task for ${name}`,
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
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
  test("returns empty set when no AgentParts exist", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "task"),
      createToolPart("tool-2", "task"),
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

  test("does not consume Task ToolParts without matching agents", () => {
    const parts: Part[] = [
      createToolPart("tool-1", "task"),
      createToolPart("tool-2", "task"),
      createAgentPart([createAgent("tool-1", "explorer")]),
    ];
    const consumed = getConsumedTaskToolCallIds(parts);
    expect(consumed.size).toBe(1);
    expect(consumed.has("tool-1")).toBe(true);
    expect(consumed.has("tool-2")).toBe(false);
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

  test("limits fallback consumption to unmatched agent count", () => {
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
    // Only 1 agent without ID, so only 1 task ToolPart consumed by fallback
    expect(consumed.size).toBe(1);
    expect(consumed.has("tool-1")).toBe(true);
    expect(consumed.has("tool-2")).toBe(false);
    expect(consumed.has("tool-3")).toBe(false);
  });
});
