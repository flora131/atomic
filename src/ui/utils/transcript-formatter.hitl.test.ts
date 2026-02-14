import { describe, expect, test } from "bun:test";
import { formatTranscript } from "./transcript-formatter.ts";
import type { ChatMessage } from "../chat.tsx";

describe("formatTranscript HITL rendering", () => {
  test("renders canonical HITL response text instead of raw JSON", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "question",
          status: "completed",
          input: {
            question: "Pick one",
          },
          output: {
            answer: "",
            cancelled: false,
          },
        },
      ],
    };

    const lines = formatTranscript({
      messages: [msg],
      isStreaming: false,
    });

    // Find the HITL tool lines
    const toolHeaderLine = lines.find((line) => line.type === "tool-header");
    const toolContentLines = lines.filter((line) => line.type === "tool-content");

    // Assert tool header exists and contains tool name
    expect(toolHeaderLine).toBeDefined();
    expect(toolHeaderLine?.content).toContain("question");

    // Assert tool content includes the question text
    const questionLine = toolContentLines.find((line) => line.content.includes("Pick one"));
    expect(questionLine).toBeDefined();

    // Assert tool content includes the canonical HITL response (not raw JSON)
    const responseLine = toolContentLines.find((line) => line.content.includes('User answered: ""'));
    expect(responseLine).toBeDefined();
    expect(responseLine?.indent).toBe(1); // Should be indented

    // Assert raw JSON is NOT present in any line
    const hasRawJson = lines.some((line) => line.content.includes('{"answer"'));
    expect(hasRawJson).toBe(false);
  });
});
