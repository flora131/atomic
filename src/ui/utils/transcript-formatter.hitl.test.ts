import { describe, expect, test } from "bun:test";
import { formatTranscript, type TranscriptLine } from "./transcript-formatter.ts";
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

    // Structurally filter lines by type
    const toolHeaderLines = lines.filter((line: TranscriptLine) => line.type === "tool-header");
    const toolContentLines = lines.filter((line: TranscriptLine) => line.type === "tool-content");

    // Assert tool header exists with correct type and contains tool name
    expect(toolHeaderLines.length).toBe(1);
    expect(toolHeaderLines[0]!.type).toBe("tool-header");
    expect(toolHeaderLines[0]!.content).toContain("question");

    // Assert tool content lines exist with correct type
    expect(toolContentLines.length).toBeGreaterThanOrEqual(2);

    // First content line should contain the question text
    const questionLine = toolContentLines[0]!;
    expect(questionLine.type).toBe("tool-content");
    expect(questionLine.content).toContain("Pick one");

    // Second content line should contain the canonical HITL display text
    const responseLine = toolContentLines[1]!;
    expect(responseLine.type).toBe("tool-content");
    expect(responseLine.indent).toBe(1);
    expect(responseLine.content).toContain('User answered: ""');

    // Assert no line of type tool-content contains raw JSON structure
    const rawJsonLines = toolContentLines.filter(
      (line: TranscriptLine) => line.content.includes('{"answer"') || line.content.includes('"cancelled"')
    );
    expect(rawJsonLines.length).toBe(0);
  });
});
