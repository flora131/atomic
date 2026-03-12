import { describe, expect, test } from "bun:test";
import {
  findFirstLineByType,
  findLinesByType,
  formatTranscript,
  type ChatMessage,
  type StreamingMeta,
} from "./transcript-formatter.test-support.ts";

describe("formatTranscript - Timestamps", () => {
  test("renders timestamp with model ID from message", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Response",
      timestamp: "2026-02-15T14:30:00.000Z",
      modelId: "claude-3-opus",
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const timestampLine = findFirstLineByType(lines, "timestamp");
    expect(timestampLine).toBeDefined();
    expect(timestampLine!.type).toBe("timestamp");
    expect(timestampLine!.content).toContain("claude-3-opus");
  });

  test("uses modelId from options when message has no modelId", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Response",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({
      messages: [msg],
      isStreaming: false,
      modelId: "gpt-4",
    });

    const timestampLine = findFirstLineByType(lines, "timestamp");
    expect(timestampLine).toBeDefined();
    expect(timestampLine!.type).toBe("timestamp");
    expect(timestampLine!.content).toContain("gpt-4");
  });

  test("does not render timestamp when no modelId is available", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Response",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const timestampLine = findFirstLineByType(lines, "timestamp");
    expect(timestampLine).toBeUndefined();
  });
});

describe("formatTranscript - Parallel Agents", () => {
  test("does not render agent tree lines from parallelAgents", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parallelAgents: [
        { id: "a1", name: "Explore", task: "Search", status: "running", startedAt: new Date().toISOString() },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    expect(findFirstLineByType(lines, "agent-header")).toBeUndefined();
    expect(findFirstLineByType(lines, "agent-row")).toBeUndefined();
    expect(findFirstLineByType(lines, "agent-substatus")).toBeUndefined();
  });

  test("does not render live agent trees without baked message parallelAgents", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true,
    };

    const lines = formatTranscript({
      messages: [msg],
      isStreaming: true,
    });

    const headerLine = findFirstLineByType(lines, "agent-header");
    expect(headerLine).toBeUndefined();
  });
});

describe("formatTranscript - Streaming Indicators", () => {
  test("renders streaming separator with thinking and token info", () => {
    const streamingMeta: StreamingMeta = {
      outputTokens: 100,
      thinkingMs: 500,
      thinkingText: "",
    };

    const lines = formatTranscript({
      messages: [],
      isStreaming: true,
      streamingMeta,
    });

    const separators = findLinesByType(lines, "separator");
    const streamingLine = separators.find((l) => l.content.includes("Streaming"));
    expect(streamingLine).toBeDefined();
    expect(streamingLine!.type).toBe("separator");
    expect(streamingLine!.content).toContain("100 tokens");
    expect(streamingLine!.content).toContain("thinking 1s");
  });

  test("renders streaming separator without thinking label when thinkingMs is 0", () => {
    const streamingMeta: StreamingMeta = {
      outputTokens: 50,
      thinkingMs: 0,
      thinkingText: "",
    };

    const lines = formatTranscript({
      messages: [],
      isStreaming: true,
      streamingMeta,
    });

    const separators = findLinesByType(lines, "separator");
    const streamingLine = separators.find((l) => l.content.includes("Streaming"));
    expect(streamingLine).toBeDefined();
    expect(streamingLine!.content).not.toContain("thinking");
    expect(streamingLine!.content).toContain("50 tokens");
  });

  test("renders streaming separator without token label when outputTokens is 0", () => {
    const streamingMeta: StreamingMeta = {
      outputTokens: 0,
      thinkingMs: 1000,
      thinkingText: "",
    };

    const lines = formatTranscript({
      messages: [],
      isStreaming: true,
      streamingMeta,
    });

    const separators = findLinesByType(lines, "separator");
    const streamingLine = separators.find((l) => l.content.includes("Streaming"));
    expect(streamingLine).toBeDefined();
    expect(streamingLine!.content).not.toContain("tokens");
    expect(streamingLine!.content).toContain("thinking");
  });

  test("does not render streaming indicator when isStreaming is false", () => {
    const streamingMeta: StreamingMeta = {
      outputTokens: 100,
      thinkingMs: 500,
      thinkingText: "",
    };

    const lines = formatTranscript({
      messages: [],
      isStreaming: false,
      streamingMeta,
    });

    const separators = findLinesByType(lines, "separator");
    const streamingLine = separators.find((l) => l.content.includes("Streaming"));
    expect(streamingLine).toBeUndefined();
  });
});

describe("formatTranscript - Completion Summaries", () => {
  test("renders completion summary with duration and tokens for messages >= 1s", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Done",
      timestamp: new Date().toISOString(),
      streaming: false,
      durationMs: 5000,
      outputTokens: 500,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const separators = findLinesByType(lines, "separator");
    const summaryLine = separators.find((l) => l.content.includes("Worked for"));
    expect(summaryLine).toBeDefined();
    expect(summaryLine!.type).toBe("separator");
    expect(summaryLine!.content).toContain("5s");
    expect(summaryLine!.content).toContain("500 tokens");
  });

  test("renders completion summary without tokens when outputTokens is absent", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Done",
      timestamp: new Date().toISOString(),
      streaming: false,
      durationMs: 3000,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const separators = findLinesByType(lines, "separator");
    const summaryLine = separators.find((l) => l.content.includes("Worked for"));
    expect(summaryLine).toBeDefined();
    expect(summaryLine!.content).toContain("3s");
    expect(summaryLine!.content).not.toContain("tokens");
  });

  test("does not render completion summary for short messages (<1s)", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Quick",
      timestamp: new Date().toISOString(),
      streaming: false,
      durationMs: 500,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const separators = findLinesByType(lines, "separator");
    const summaryLine = separators.find((l) => l.content.includes("Worked for"));
    expect(summaryLine).toBeUndefined();
  });

  test("does not render completion summary while message is still streaming", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Streaming...",
      timestamp: new Date().toISOString(),
      streaming: true,
      durationMs: 5000,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: true });

    const separators = findLinesByType(lines, "separator");
    const summaryLine = separators.find((l) => l.content.includes("Worked for"));
    expect(summaryLine).toBeUndefined();
  });
});

describe("formatTranscript - Footer", () => {
  test("always renders separator and footer at the end of output", () => {
    const lines = formatTranscript({ messages: [], isStreaming: false });

    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBeDefined();
    expect(lastLine!.type).toBe("footer");
    expect(lastLine!.content).toContain("Showing detailed transcript");
    expect(lastLine!.content).toContain("ctrl+o");

    const separatorLine = lines[lines.length - 2];
    expect(separatorLine).toBeDefined();
    expect(separatorLine!.type).toBe("separator");
  });
});
