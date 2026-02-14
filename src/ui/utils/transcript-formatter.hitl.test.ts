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

    const rendered = lines.map((line) => line.content).join("\n");
    expect(rendered).toContain('User answered: ""');
    expect(rendered).not.toContain('{"answer"');
  });
});
