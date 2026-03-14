import { describe, expect, test } from "bun:test";
import {
  findFirstLineByType,
  findLinesByType,
  formatTranscript,
  type ChatMessage,
} from "./transcript-formatter.test-support.ts";

describe("formatTranscript - Thinking Traces", () => {
  test("renders thinking-header and thinking-content for thinking text", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      thinkingText: "Let me analyze this problem...",
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "thinking-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.type).toBe("thinking-header");
    expect(headerLine!.content).toContain("Thinking");

    const contentLines = findLinesByType(lines, "thinking-content");
    expect(contentLines.length).toBe(1);
    expect(contentLines[0]!.type).toBe("thinking-content");
    expect(contentLines[0]!.content).toBe("Let me analyze this problem...");
    expect(contentLines[0]!.indent).toBe(1);
  });

  test("handles multiline thinking content", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      thinkingText: "First thought\nSecond thought\nThird thought",
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const contentLines = findLinesByType(lines, "thinking-content");
    expect(contentLines.length).toBe(3);
    contentLines.forEach((line) => {
      expect(line.type).toBe("thinking-content");
      expect(line.indent).toBe(1);
    });
  });

  test("filters out blank lines in thinking content", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      thinkingText: "First thought\n\n\nSecond thought",
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const contentLines = findLinesByType(lines, "thinking-content");
    expect(contentLines.length).toBe(2);
    expect(contentLines[0]!.content).toBe("First thought");
    expect(contentLines[1]!.content).toBe("Second thought");
  });

  test("uses liveThinkingText during streaming when thinkingText is absent", () => {
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
      liveThinkingText: "Live thinking content",
    });

    const contentLines = findLinesByType(lines, "thinking-content");
    expect(contentLines.length).toBe(1);
    expect(contentLines[0]!.content).toBe("Live thinking content");
  });

  test("renders separate thinking headers for distinct reasoning parts", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      thinkingText: "**Exploring code review options**\nAlright, first pass.\n\n**Choosing the code-review agent**\nSecond pass.",
      parts: [
        {
          id: "reasoning-1",
          type: "reasoning",
          thinkingSourceKey: "source:1",
          content: "**Exploring code review options**\nAlright, first pass.",
          durationMs: 500,
          isStreaming: false,
          createdAt: new Date().toISOString(),
        },
        {
          id: "reasoning-2",
          type: "reasoning",
          thinkingSourceKey: "source:2",
          content: "**Choosing the code-review agent**\nSecond pass.",
          durationMs: 600,
          isStreaming: false,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLines = findLinesByType(lines, "thinking-header");
    expect(headerLines).toHaveLength(2);

    const contentLines = findLinesByType(lines, "thinking-content");
    expect(contentLines.map((line) => line.content)).toEqual([
      "**Exploring code review options**",
      "Alright, first pass.",
      "**Choosing the code-review agent**",
      "Second pass.",
    ]);
  });
});

describe("formatTranscript - Non-HITL Tool Calls", () => {
  test("renders tool-header with status icon and tool name for completed tool", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Read",
          status: "completed",
          input: { file_path: "/src/test.ts" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.type).toBe("tool-header");
    expect(headerLine!.content).toContain("Read");
    expect(headerLine!.content).toContain("/src/test.ts");
  });

  test("renders tool-content with formatted input for Bash tool", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Bash",
          status: "running",
          input: { command: "bun test" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const contentLines = findLinesByType(lines, "tool-content");
    expect(contentLines.length).toBeGreaterThan(0);
    const inputLine = contentLines.find((l) => l.content.includes("$ bun test"));
    expect(inputLine).toBeDefined();
    expect(inputLine!.type).toBe("tool-content");
    expect(inputLine!.indent).toBe(1);
  });

  test("renders tool output with truncation for outputs exceeding 8 lines", () => {
    const outputLines = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}`);
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Bash",
          status: "completed",
          input: { command: "ls" },
          output: outputLines.join("\n"),
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const contentLines = findLinesByType(lines, "tool-content");
    const moreLine = contentLines.find((l) => l.content.includes("more lines"));
    expect(moreLine).toBeDefined();
    expect(moreLine!.content).toContain("7 more lines");
  });

  test("renders tool output without truncation for short outputs", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Bash",
          status: "completed",
          input: { command: "echo hello" },
          output: "hello\nworld",
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const contentLines = findLinesByType(lines, "tool-content");
    const moreLine = contentLines.find((l) => l.content.includes("more lines"));
    expect(moreLine).toBeUndefined();
    const helloLine = contentLines.find((l) => l.content.includes("hello"));
    const worldLine = contentLines.find((l) => l.content.includes("world"));
    expect(helloLine).toBeDefined();
    expect(worldLine).toBeDefined();
  });

  test("renders error status icon for failed tool calls", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Read",
          status: "error",
          input: { file_path: "/nonexistent.ts" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.content).toContain("●");
  });

  test("renders unknown tool with default input formatting", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "CustomMCPTool",
          status: "completed",
          input: { query: "find stuff", limit: 10 },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.content).toContain("CustomMCPTool");

    const contentLines = findLinesByType(lines, "tool-content");
    const inputLine = contentLines.find((l) => l.content.includes("query:"));
    expect(inputLine).toBeDefined();
    expect(inputLine!.type).toBe("tool-content");
  });
});

describe("formatTranscript - HITL Tool Calls", () => {
  test("renders AskUserQuestion with question text in tool-content", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "AskUserQuestion",
          status: "completed",
          input: { question: "Choose an option", options: ["A", "B"] },
          output: { answer: "A", cancelled: false },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.type).toBe("tool-header");
    expect(headerLine!.content).toContain("AskUserQuestion");

    const contentLines = findLinesByType(lines, "tool-content");
    const questionLine = contentLines.find((l) => l.content.includes("Choose an option"));
    expect(questionLine).toBeDefined();
    expect(questionLine!.type).toBe("tool-content");
  });

  test("renders canonical HITL response text (not raw JSON) for question tool", () => {
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
          input: { question: "Pick one" },
          output: { answer: "Option A", cancelled: false },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const contentLines = findLinesByType(lines, "tool-content");
    const responseLine = contentLines.find((l) => l.content.includes('User answered: "Option A"'));
    expect(responseLine).toBeDefined();
    expect(responseLine!.type).toBe("tool-content");

    const rawJsonLines = lines.filter((l) => l.content.includes('{"answer"'));
    expect(rawJsonLines.length).toBe(0);
  });

  test("handles ask_user tool name variant", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "ask_user",
          status: "completed",
          input: { question: "What do you think?" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.type).toBe("tool-header");
    expect(headerLine!.content).toContain("ask_user");
  });

  test("extracts question from questions array when question field is absent", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "AskUserQuestion",
          status: "running",
          input: {
            questions: [{ question: "Which framework?" }],
          },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const contentLines = findLinesByType(lines, "tool-content");
    const questionLine = contentLines.find((l) => l.content.includes("Which framework?"));
    expect(questionLine).toBeDefined();
    expect(questionLine!.type).toBe("tool-content");
  });
});

describe("formatTranscript - Tool Formatting Helpers", () => {
  test("formats Read tool with file path in header and input content", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Read",
          status: "completed",
          input: { file_path: "/path/to/file.ts" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine!.content).toContain("/path/to/file.ts");

    const contentLines = findLinesByType(lines, "tool-content");
    const fileLine = contentLines.find((l) => l.content.includes("file:"));
    expect(fileLine).toBeDefined();
    expect(fileLine!.content).toContain("/path/to/file.ts");
  });

  test("formats Glob tool with pattern in header", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Glob",
          status: "completed",
          input: { pattern: "**/*.ts" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine!.content).toContain("**/*.ts");
  });

  test("formats Grep tool with pattern in header", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Grep",
          status: "completed",
          input: { pattern: "TODO|FIXME" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine!.content).toContain("Grep");
    const contentLines = findLinesByType(lines, "tool-content");
    const patternLine = contentLines.find((l) => l.content.includes("pattern:"));
    expect(patternLine).toBeDefined();
    expect(patternLine!.content).toContain("TODO|FIXME");
  });

  test("formats Task tool with description in header", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "t1",
          toolName: "Task",
          status: "running",
          input: { description: "Debug the issue", prompt: "Help me debug" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "tool-header");
    expect(headerLine!.content).toContain("Debug the issue");
  });
});
