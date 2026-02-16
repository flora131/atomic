import { describe, expect, test } from "bun:test";
import {
  buildContentSegments,
  type MessageToolCall,
} from "./chat.tsx";

function makeToolCall(
  id: string,
  offset: number,
  toolName: string,
  status: MessageToolCall["status"] = "completed",
): MessageToolCall {
  return {
    id,
    toolName,
    input: {},
    status,
    contentOffsetAtStart: offset,
  };
}

describe("buildContentSegments inline tool visibility", () => {
  test("keeps Skill and Task tools visible inline", () => {
    const toolCalls: MessageToolCall[] = [
      makeToolCall("s1", 0, "Skill"),
      makeToolCall("s2", 0, "skill"),
      makeToolCall("t1", 0, "Task"),
      makeToolCall("t2", 0, "task"),
    ];

    const segments = buildContentSegments("response", toolCalls);
    const toolNames = segments
      .filter((segment) => segment.type === "tool")
      .map((segment) => segment.toolCall?.toolName);

    expect(toolNames).toEqual(["Skill", "skill", "Task", "task"]);
  });

  test("filters running HITL tools but keeps completed HITL as inline record", () => {
    const toolCalls: MessageToolCall[] = [
      makeToolCall("h-running", 0, "ask_user", "running"),
      makeToolCall("h-done", 0, "ask_user", "completed"),
    ];

    const segments = buildContentSegments("response", toolCalls);
    const toolSegments = segments.filter((segment) => segment.type === "tool");
    const hitlSegments = segments.filter((segment) => segment.type === "hitl");

    expect(toolSegments).toHaveLength(0);
    expect(hitlSegments).toHaveLength(1);
    expect(hitlSegments[0]?.toolCall?.id).toBe("h-done");
  });

  test("renders MCP tools (including ask_question) as normal inline tool entries", () => {
    const toolCalls: MessageToolCall[] = [
      makeToolCall("m1", 0, "mcp__deepwiki__ask_question"),
      makeToolCall("m2", 0, "mcp__deepwiki__read_wiki_structure"),
    ];

    const segments = buildContentSegments("response", toolCalls);
    const toolNames = segments
      .filter((segment) => segment.type === "tool")
      .map((segment) => segment.toolCall?.toolName);

    expect(toolNames).toEqual([
      "mcp__deepwiki__ask_question",
      "mcp__deepwiki__read_wiki_structure",
    ]);
  });
});
