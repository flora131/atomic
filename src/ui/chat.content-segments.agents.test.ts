import { describe, expect, test } from "bun:test";
import { buildContentSegments, type MessageToolCall } from "./chat.tsx";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";

function makeToolCall(
  id: string,
  offset: number,
  toolName = "Read"
): MessageToolCall {
  return {
    id,
    toolName,
    input: {},
    status: "completed",
    contentOffsetAtStart: offset,
  };
}

function makeAgent(
  id: string,
  task: string,
  contentOffsetAtStart?: number,
  taskToolCallId?: string,
): ParallelAgent {
  return {
    id,
    name: "research",
    task,
    status: "running",
    startedAt: new Date().toISOString(),
    contentOffsetAtStart,
    taskToolCallId,
  };
}

describe("buildContentSegments agent insertion", () => {
  test("inserts agent groups in chronological order using Task tool offsets", () => {
    const content = "before middle after";
    const firstOffset = content.indexOf(" middle");
    const secondOffset = content.indexOf(" after");

    const segments = buildContentSegments(
      content,
      [
        makeToolCall("a1", firstOffset, "Task"),
        makeToolCall("a2", secondOffset, "Task"),
      ],
      [
        makeAgent("a1", "first"),
        makeAgent("a2", "second"),
      ],
    );

    const agentSegments = segments.filter((segment) => segment.type === "agents");
    expect(agentSegments).toHaveLength(2);
    expect(agentSegments[0]?.agents?.map((agent) => agent.id)).toEqual(["a1"]);
    expect(agentSegments[1]?.agents?.map((agent) => agent.id)).toEqual(["a2"]);
  });

  test("places agents at the start when no explicit offsets exist", () => {
    const content = "results text";
    const segments = buildContentSegments(content, [], [makeAgent("agent-1", "collect results")]);

    expect(segments[0]?.type).toBe("agents");
    expect(segments[1]?.type).toBe("text");
    expect(segments[1]?.content).toBe(content);
  });

  test("groups agents sharing the same offset into a single tree segment", () => {
    const content = "alpha beta";
    const offset = content.indexOf(" beta");

    const segments = buildContentSegments(
      content,
      [
        makeToolCall("a1", offset, "Task"),
        makeToolCall("a2", offset, "Task"),
      ],
      [
        makeAgent("a1", "task one"),
        makeAgent("a2", "task two"),
      ],
    );

    const agentSegments = segments.filter((segment) => segment.type === "agents");
    expect(agentSegments).toHaveLength(1);
    expect(agentSegments[0]?.agents?.map((agent) => agent.id)).toEqual(["a1", "a2"]);
  });

  test("uses agent content offsets when Task tool offsets are unavailable", () => {
    const content = "alpha beta gamma";
    const firstOffset = content.indexOf(" beta");
    const secondOffset = content.indexOf(" gamma");

    const segments = buildContentSegments(
      content,
      [],
      [
        makeAgent("w1", "first worker", firstOffset),
        makeAgent("w2", "second worker", secondOffset),
      ],
    );

    const agentSegments = segments.filter((segment) => segment.type === "agents");
    expect(agentSegments).toHaveLength(2);
    expect(agentSegments[0]?.agents?.map((agent) => agent.id)).toEqual(["w1"]);
    expect(agentSegments[1]?.agents?.map((agent) => agent.id)).toEqual(["w2"]);
  });

  test("renders Task tool card before agents tree at the same offset", () => {
    const content = "alpha beta";
    const offset = content.indexOf(" beta");
    const segments = buildContentSegments(
      content,
      [makeToolCall("a1", offset, "Task")],
      [makeAgent("a1", "task one")],
    );

    expect(segments.map((segment) => segment.type)).toEqual([
      "text",
      "tool",
      "agents",
      "text",
    ]);
  });

  test("uses taskToolCallId to preserve ordering after eager ID remap", () => {
    const content = "alpha beta gamma";
    const offset = content.indexOf(" gamma");
    const segments = buildContentSegments(
      content,
      [makeToolCall("tool-42", offset, "Task")],
      [makeAgent("subagent-real-id", "task one", undefined, "tool-42")],
    );

    const agentSegments = segments.filter((segment) => segment.type === "agents");
    expect(agentSegments).toHaveLength(1);
    expect(segments.map((segment) => segment.type)).toEqual([
      "text",
      "tool",
      "agents",
      "text",
    ]);
  });
});
