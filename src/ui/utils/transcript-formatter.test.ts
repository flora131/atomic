/**
 * Comprehensive tests for transcript-formatter.ts
 *
 * Tests all transcript line types:
 * 1. user-prompt - User message content
 * 2. file-read - Files read via @mention
 * 3. thinking-header - Header for thinking traces
 * 4. thinking-content - Content of thinking traces
 * 5. timestamp - Timestamp with model ID
 * 6. assistant-bullet - First line of assistant text
 * 7. assistant-text - Subsequent assistant text lines
 * 8. tool-header - Tool call header (HITL and non-HITL)
 * 9. tool-content - Tool input/output details
 * 10. agent-header - Parallel agents header
 * 11. agent-row - Individual agent row
 * 12. agent-substatus - Agent substatus line
 * 13. separator - Separator lines (completion, streaming)
 * 14. footer - Footer text
 * 15. blank - Blank spacer lines
 */

import { describe, expect, test } from "bun:test";
import { formatTranscript, type TranscriptLine, type TranscriptLineType } from "./transcript-formatter.ts";
import type { ChatMessage, StreamingMeta } from "../chat.tsx";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

// Helper to find lines by type
function findLinesByType(lines: TranscriptLine[], type: TranscriptLineType): TranscriptLine[] {
  return lines.filter((line) => line.type === type);
}

function findFirstLineByType(lines: TranscriptLine[], type: TranscriptLineType): TranscriptLine | undefined {
  return lines.find((line) => line.type === type);
}

// ============================================================================
// USER MESSAGE TESTS
// ============================================================================

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

  test("renders file-read lines for @mentioned files with size info", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: "Read this file",
      timestamp: new Date().toISOString(),
      filesRead: [
        { path: "src/index.ts", sizeBytes: 1024, lineCount: 50, isImage: false, isDirectory: false },
        { path: "src/utils.ts", sizeBytes: 2048, lineCount: 100, isImage: false, isDirectory: false },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const fileReadLines = findLinesByType(lines, "file-read");
    expect(fileReadLines.length).toBe(2);
    expect(fileReadLines[0]!.type).toBe("file-read");
    expect(fileReadLines[0]!.content).toContain("src/index.ts");
    expect(fileReadLines[0]!.content).toContain("1.0KB");
    expect(fileReadLines[0]!.indent).toBe(1);
    expect(fileReadLines[1]!.content).toContain("src/utils.ts");
    expect(fileReadLines[1]!.content).toContain("2.0KB");
  });

  test("renders file-read lines with size info when sizeBytes is provided", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: "Read this",
      timestamp: new Date().toISOString(),
      filesRead: [
        { path: "README.md", lineCount: 10, isImage: false, isDirectory: false, sizeBytes: 256 },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const fileReadLines = findLinesByType(lines, "file-read");
    expect(fileReadLines.length).toBe(1);
    expect(fileReadLines[0]!.type).toBe("file-read");
    expect(fileReadLines[0]!.content).toContain("README.md");
  });

  test("renders blank line after each user message", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: "Test",
      timestamp: new Date().toISOString(),
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    // User prompt should be followed by a blank line before footer
    const promptIdx = lines.findIndex((l) => l.type === "user-prompt");
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    const nextLine = lines[promptIdx + 1];
    expect(nextLine).toBeDefined();
    expect(nextLine!.type).toBe("blank");
    expect(nextLine!.content).toBe("");
  });
});

// ============================================================================
// ASSISTANT TEXT TESTS
// ============================================================================

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
    expect(textLines.length).toBe(2); // Second and third lines
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

    // Whitespace-only content should not produce assistant-bullet
    const bulletLine = findFirstLineByType(lines, "assistant-bullet");
    expect(bulletLine).toBeUndefined();
  });
});

// ============================================================================
// THINKING TRACE TESTS
// ============================================================================

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

    // Empty lines should be filtered out (only non-empty trimmed lines)
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
});

// ============================================================================
// TOOL USE TESTS (NON-HITL)
// ============================================================================

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
          input: { command: "npm test" },
        },
      ],
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const contentLines = findLinesByType(lines, "tool-content");
    expect(contentLines.length).toBeGreaterThan(0);
    const inputLine = contentLines.find((l) => l.content.includes("$ npm test"));
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
    // Should include 8 preview lines + 1 input summary + 1 "more lines" indicator
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
    // Should not have a "more lines" indicator
    const moreLine = contentLines.find((l) => l.content.includes("more lines"));
    expect(moreLine).toBeUndefined();
    // Both output lines should be present
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
    // Error status should use the error icon (STATUS.error = "✗")
    expect(headerLine!.content).toContain("✗");
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

    // Default formatter should list input keys
    const contentLines = findLinesByType(lines, "tool-content");
    const inputLine = contentLines.find((l) => l.content.includes("query:"));
    expect(inputLine).toBeDefined();
    expect(inputLine!.type).toBe("tool-content");
  });
});

// ============================================================================
// HITL (HUMAN-IN-THE-LOOP) TESTS
// ============================================================================

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
    // Should contain the formatted display text from getHitlResponseRecord
    const responseLine = contentLines.find((l) => l.content.includes('User answered: "Option A"'));
    expect(responseLine).toBeDefined();
    expect(responseLine!.type).toBe("tool-content");

    // Assert raw JSON is NOT present in any line
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

// ============================================================================
// TIMESTAMP TESTS
// ============================================================================

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

// ============================================================================
// PARALLEL AGENT TESTS
// ============================================================================

describe("formatTranscript - Parallel Agents", () => {
  test("renders agent-header with running count for mixed status agents", () => {
    const agents: ParallelAgent[] = [
      { id: "a1", name: "Explore", task: "Search files", status: "running", startedAt: new Date().toISOString() },
      { id: "a2", name: "Plan", task: "Make plan", status: "pending", startedAt: new Date().toISOString() },
    ];
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parallelAgents: agents,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "agent-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.type).toBe("agent-header");
    expect(headerLine!.content).toContain("Running 2 agents");
  });

  test("renders agent-header with completed count when all agents finished", () => {
    const agents: ParallelAgent[] = [
      { id: "a1", name: "Explore", task: "Search", status: "completed", startedAt: new Date().toISOString() },
      { id: "a2", name: "Plan", task: "Plan", status: "completed", startedAt: new Date().toISOString() },
      { id: "a3", name: "Code", task: "Code", status: "completed", startedAt: new Date().toISOString() },
    ];
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parallelAgents: agents,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const headerLine = findFirstLineByType(lines, "agent-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.type).toBe("agent-header");
    expect(headerLine!.content).toContain("3 agents finished");
  });

  test("renders agent-row with task and metrics", () => {
    const agents: ParallelAgent[] = [
      {
        id: "a1",
        name: "Explore",
        task: "Searching for files",
        status: "completed",
        startedAt: new Date().toISOString(),
        durationMs: 5000,
        toolUses: 10,
      },
    ];
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parallelAgents: agents,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const rowLine = findFirstLineByType(lines, "agent-row");
    expect(rowLine).toBeDefined();
    expect(rowLine!.type).toBe("agent-row");
    expect(rowLine!.content).toContain("Searching for files");
    expect(rowLine!.content).toContain("10 tool uses");
    expect(rowLine!.content).toContain("5s");
  });

  test("renders agent-substatus with result text for completed agents", () => {
    const agents: ParallelAgent[] = [
      {
        id: "a1",
        name: "Explore",
        task: "Search",
        status: "completed",
        startedAt: new Date().toISOString(),
        result: "Found 5 files",
      },
    ];
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parallelAgents: agents,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const substatusLine = findFirstLineByType(lines, "agent-substatus");
    expect(substatusLine).toBeDefined();
    expect(substatusLine!.type).toBe("agent-substatus");
    expect(substatusLine!.content).toContain("Found 5 files");
  });

  test("renders agent-substatus for running agents with currentTool", () => {
    const agents: ParallelAgent[] = [
      {
        id: "a1",
        name: "Explore",
        task: "Search",
        status: "running",
        startedAt: new Date().toISOString(),
        currentTool: "Bash: Finding files...",
      },
    ];
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parallelAgents: agents,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const substatusLine = findFirstLineByType(lines, "agent-substatus");
    expect(substatusLine).toBeDefined();
    expect(substatusLine!.type).toBe("agent-substatus");
    expect(substatusLine!.content).toContain("Bash: Finding files...");
  });

  test("renders agent-substatus with error message for errored agents", () => {
    const agents: ParallelAgent[] = [
      {
        id: "a1",
        name: "Explore",
        task: "Search",
        status: "error",
        startedAt: new Date().toISOString(),
        error: "File not found",
      },
    ];
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parallelAgents: agents,
    };

    const lines = formatTranscript({ messages: [msg], isStreaming: false });

    const substatusLine = findFirstLineByType(lines, "agent-substatus");
    expect(substatusLine).toBeDefined();
    expect(substatusLine!.type).toBe("agent-substatus");
    expect(substatusLine!.content).toContain("File not found");
  });

  test("uses liveParallelAgents during streaming when message has no baked agents", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true,
    };

    const liveAgents: ParallelAgent[] = [
      { id: "a1", name: "Live", task: "Live task", status: "running", startedAt: new Date().toISOString() },
    ];

    const lines = formatTranscript({
      messages: [msg],
      isStreaming: true,
      liveParallelAgents: liveAgents,
    });

    const headerLine = findFirstLineByType(lines, "agent-header");
    expect(headerLine).toBeDefined();
    expect(headerLine!.type).toBe("agent-header");
    expect(headerLine!.content).toContain("Running 1 agent");
  });
});

// ============================================================================
// STREAMING INDICATOR TESTS
// ============================================================================

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
    expect(streamingLine!.content).toContain("thinking 500ms");
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

// ============================================================================
// COMPLETION SUMMARY TESTS
// ============================================================================

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

// ============================================================================
// SYSTEM MESSAGE TESTS
// ============================================================================

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
    expect(textLine!.content).toContain("\u26A0"); // warning sign
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

// ============================================================================
// FOOTER & SEPARATOR TESTS
// ============================================================================

describe("formatTranscript - Footer", () => {
  test("always renders separator and footer at the end of output", () => {
    const lines = formatTranscript({ messages: [], isStreaming: false });

    // Last line should be footer
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBeDefined();
    expect(lastLine!.type).toBe("footer");
    expect(lastLine!.content).toContain("Showing detailed transcript");
    expect(lastLine!.content).toContain("ctrl+o");

    // Second-to-last should be separator
    const separatorLine = lines[lines.length - 2];
    expect(separatorLine).toBeDefined();
    expect(separatorLine!.type).toBe("separator");
  });
});

// ============================================================================
// TOOL TITLE/INPUT FORMATTING TESTS
// ============================================================================

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

// ============================================================================
// MULTIPLE MESSAGES / INTEGRATION TEST
// ============================================================================

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
        toolCalls: [
          { id: "t1", toolName: "Read", status: "completed", input: { file_path: "test.ts" } },
        ],
      },
      { id: "m3", role: "system", content: "Info", timestamp: new Date().toISOString() },
    ];

    const lines = formatTranscript({ messages, isStreaming: false });

    // Every line should have the three required properties with correct types
    for (const line of lines) {
      expect(typeof line.type).toBe("string");
      expect(typeof line.content).toBe("string");
      expect(typeof line.indent).toBe("number");
      expect(line.indent).toBeGreaterThanOrEqual(0);
    }
  });
});
