import { describe, expect, test } from "bun:test";
import { buildContentSegments, type MessageToolCall } from "./chat.tsx";

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

describe("buildContentSegments adversarial formatting cases", () => {
  test("does not split text for hidden task insertions", () => {
    const content = "Now let me look at one existing spec for formatting reference and check the existing specs directory. I now have all the context needed. Let me create the spec.";
    const tasksOffset = content.indexOf("I now have");
    const segments = buildContentSegments(
      content,
      [],
      null,
      undefined,
      [{ content: "task", status: "pending" }] as any,
      tasksOffset,
      false
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]?.type).toBe("text");
    expect(segments[0]?.content).toBe(content);
  });

  test("inserts tasks inline when tasks are enabled", () => {
    const content = "alpha beta gamma";
    const tasksOffset = content.indexOf(" gamma");
    const segments = buildContentSegments(
      content,
      [],
      null,
      undefined,
      [{ content: "task", status: "pending" }] as any,
      tasksOffset,
      undefined,
    );

    expect(segments.map((segment) => segment.type)).toEqual([
      "text",
      "tasks",
      "text",
    ]);
  });

  test("preserves boundary whitespace around tool insertion", () => {
    const content = "directory. I now have all the context needed.";
    const offset = content.indexOf(" I now");
    const segments = buildContentSegments(content, [makeToolCall("t1", offset)]);
    const textSegments = segments
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.content);

    expect(textSegments).toEqual([
      "directory.",
      " I now have all the context needed.",
    ]);
  });

  test("does not split fenced code blocks containing blank lines", () => {
    const content = "```ts\nconst a = 1;\n\nconst b = 2;\n```";
    const segments = buildContentSegments(content, [makeToolCall("t1", content.length)]);
    const textSegments = segments
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.content);

    expect(textSegments).toEqual([content]);
  });

  test("preserves exact paragraph spacing when tools are interleaved", () => {
    const content = "First paragraph.\n\n\nSecond paragraph.";
    const segments = buildContentSegments(content, [makeToolCall("t1", content.length)]);
    const textSegments = segments
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.content);

    expect(textSegments).toEqual([content]);
  });

  test("handles multiple tool insertions at the same offset without gluing text", () => {
    const content = "A B C";
    const offset = content.indexOf(" B");
    const segments = buildContentSegments(content, [
      makeToolCall("t1", offset, "Read"),
      makeToolCall("t2", offset, "Glob"),
    ]);
    const textSegments = segments
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.content);
    const toolSegments = segments.filter((segment) => segment.type === "tool");

    expect(textSegments).toEqual(["A", " B C"]);
    expect(toolSegments).toHaveLength(2);
  });
});
