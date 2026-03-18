import { describe, expect, test } from "bun:test";
import {
  findFirstLineByType,
  findLinesByType,
  formatTranscript,
  type ChatMessage,
} from "./transcript-formatter.test-support.ts";

describe("formatTranscript - User Messages", () => {
  test("renders user-prompt line with prompt cursor for user messages", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: "Hello, world!",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const promptLine = findFirstLineByType(lines, "user-prompt");
    expect(promptLine).toBeDefined();
    expect(promptLine!.type).toBe("user-prompt");
    expect(promptLine!.content).toContain("Hello, world!");
    expect(promptLine!.indent).toBe(0);
  });

  test("renders blank line after each user message", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: "Test",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const promptIdx = lines.findIndex((l) => l.type === "user-prompt");
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    const nextLine = lines[promptIdx + 1];
    expect(nextLine).toBeDefined();
    expect(nextLine!.type).toBe("blank");
    expect(nextLine!.content).toBe("");
  });
});

describe("formatTranscript - Assistant Text", () => {
  test("renders assistant-bullet for first line of assistant content", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "This is the first line",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const bulletLine = findFirstLineByType(lines, "assistant-bullet");
    expect(bulletLine).toBeDefined();
    expect(bulletLine!.type).toBe("assistant-bullet");
    expect(bulletLine!.content).toContain("This is the first line");
    expect(bulletLine!.indent).toBe(0);
  });

  test("renders assistant-text for multiline content with correct indent", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "First line\nSecond line\nThird line",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const bulletLines = findLinesByType(lines, "assistant-bullet");
    expect(bulletLines.length).toBe(1);

    const textLines = findLinesByType(lines, "assistant-text");
    expect(textLines.length).toBe(2);
    expect(textLines[0]!.type).toBe("assistant-text");
    expect(textLines[0]!.indent).toBe(1);
    expect(textLines[0]!.content).toContain("Second line");
    expect(textLines[1]!.content).toContain("Third line");
  });

  test("handles empty assistant content gracefully (no bullet emitted)", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const bulletLine = findFirstLineByType(lines, "assistant-bullet");
    expect(bulletLine).toBeUndefined();
  });

  test("handles whitespace-only assistant content (no bullet emitted)", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "   \n  \n   ",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const bulletLine = findFirstLineByType(lines, "assistant-bullet");
    expect(bulletLine).toBeUndefined();
  });
});

describe("formatTranscript - System Messages", () => {
  test("renders system message with warning icon as assistant-text type", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "system",
      content: "System notification",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const textLine = findFirstLineByType(lines, "assistant-text");
    expect(textLine).toBeDefined();
    expect(textLine!.type).toBe("assistant-text");
    expect(textLine!.content).toContain("\u26A0");
    expect(textLine!.content).toContain("System notification");
  });

  test("renders blank line after system message", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "system",
      content: "Warning message",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const systemIdx = lines.findIndex((l) => l.type === "assistant-text" && l.content.includes("Warning message"));
    expect(systemIdx).toBeGreaterThanOrEqual(0);
    const nextLine = lines[systemIdx + 1];
    expect(nextLine).toBeDefined();
    expect(nextLine!.type).toBe("blank");
  });
});

describe("formatTranscript - Multiple Messages", () => {
  test("handles conversation with user and assistant alternating", () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "Hello", timestamp: new Date().toISOString() },
      { id: "m2", role: "assistant", content: "Hi there!", timestamp: new Date().toISOString() },
      { id: "m3", role: "user", content: "How are you?", timestamp: new Date().toISOString() },
      { id: "m4", role: "assistant", content: "I'm doing well", timestamp: new Date().toISOString() },
    ];

    const lines = formatTranscript({ messages, isStreaming: false });

    const userPrompts = findLinesByType(lines, "user-prompt");
    const assistantBullets = findLinesByType(lines, "assistant-bullet");

    expect(userPrompts.length).toBe(2);
    expect(assistantBullets.length).toBe(2);
  });

  test("all lines have valid TranscriptLine structure", () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "Test", timestamp: new Date().toISOString() },
      {
        id: "m2",
        role: "assistant",
        content: "Response",
        timestamp: new Date().toISOString(),
        modelId: "test-model",
        parts: [
          {
            id: "t1",
            type: "tool",
            toolCallId: "t1",
            toolName: "Read",
            input: { file_path: "test.ts" },
            state: { status: "completed", output: undefined, durationMs: 0 },
            createdAt: new Date().toISOString(),
          },
        ],
      },
      { id: "m3", role: "system", content: "Info", timestamp: new Date().toISOString() },
    ];

    const lines = formatTranscript({ messages, isStreaming: false });

    for (const line of lines) {
      expect(typeof line.type).toBe("string");
      expect(typeof line.content).toBe("string");
      expect(typeof line.indent).toBe("number");
      expect(line.indent).toBeGreaterThanOrEqual(0);
    }
  });
});
