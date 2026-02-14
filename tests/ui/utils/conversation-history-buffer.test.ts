/**
 * Tests for conversation-history-buffer utility.
 *
 * Verifies that messages are persisted to a tmp file, survive clears,
 * and can be read back after /compact clears visible messages.
 */

import { test, expect, beforeEach } from "bun:test";
import {
  appendToHistoryBuffer,
  appendCompactionSummary,
  readHistoryBuffer,
  replaceHistoryBuffer,
  clearHistoryBuffer,
} from "../../../src/ui/utils/conversation-history-buffer.ts";
import type { ChatMessage } from "../../../src/ui/chat.tsx";

function makeMessage(id: string, role: "user" | "assistant" | "system", content: string): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

beforeEach(() => {
  clearHistoryBuffer();
});

test("readHistoryBuffer returns empty array when no history exists", () => {
  const result = readHistoryBuffer();
  expect(result).toEqual([]);
});

test("appendToHistoryBuffer persists messages that can be read back", () => {
  const msgs: ChatMessage[] = [
    makeMessage("1", "user", "Hello"),
    makeMessage("2", "assistant", "Hi there"),
  ];
  const appended = appendToHistoryBuffer(msgs);

  const result = readHistoryBuffer();
  expect(appended).toBe(2);
  expect(result).toHaveLength(2);
  expect(result[0]?.id).toBe("1");
  expect(result[0]?.content).toBe("Hello");
  expect(result[1]?.id).toBe("2");
  expect(result[1]?.content).toBe("Hi there");
});

test("appendToHistoryBuffer deduplicates by message id", () => {
  const msgs: ChatMessage[] = [makeMessage("1", "user", "Hello")];
  const first = appendToHistoryBuffer(msgs);
  const second = appendToHistoryBuffer(msgs); // duplicate

  const result = readHistoryBuffer();
  expect(first).toBe(1);
  expect(second).toBe(0);
  expect(result).toHaveLength(1);
});

test("appendToHistoryBuffer merges new messages with existing", () => {
  appendToHistoryBuffer([makeMessage("1", "user", "First")]);
  appendToHistoryBuffer([makeMessage("2", "assistant", "Second")]);

  const result = readHistoryBuffer();
  expect(result).toHaveLength(2);
  expect(result[0]?.id).toBe("1");
  expect(result[1]?.id).toBe("2");
});

test("clearHistoryBuffer empties the history", () => {
  appendToHistoryBuffer([makeMessage("1", "user", "Hello")]);
  expect(readHistoryBuffer()).toHaveLength(1);

  clearHistoryBuffer();
  expect(readHistoryBuffer()).toHaveLength(0);
});

test("appendToHistoryBuffer ignores empty array", () => {
  const appended = appendToHistoryBuffer([]);
  const result = readHistoryBuffer();
  expect(appended).toBe(0);
  expect(result).toEqual([]);
});

test("history survives simulated compact: append then clear visible, history remains", () => {
  const preCompactMessages: ChatMessage[] = [
    makeMessage("m1", "user", "Build a snake game"),
    makeMessage("m2", "assistant", "Sure, I'll create a snake game in Rust."),
    makeMessage("m3", "user", "Add colors"),
    makeMessage("m4", "assistant", "I've added color support."),
  ];

  // Simulate: before compact, persist messages to history
  appendToHistoryBuffer(preCompactMessages);

  // Simulate: compact clears visible messages (setMessages([]))
  const visibleMessages: ChatMessage[] = [];

  // Transcript should show full history + current visible
  const transcriptMessages = [...readHistoryBuffer(), ...visibleMessages];
  expect(transcriptMessages).toHaveLength(4);
  expect(transcriptMessages[0]?.content).toBe("Build a snake game");
  expect(transcriptMessages[3]?.content).toBe("I've added color support.");
});

test("history accumulates across multiple compactions", () => {
  // First round of conversation
  appendToHistoryBuffer([
    makeMessage("r1-1", "user", "Round 1 message"),
    makeMessage("r1-2", "assistant", "Round 1 response"),
  ]);

  // Second round (after first compact, new conversation)
  appendToHistoryBuffer([
    makeMessage("r2-1", "user", "Round 2 message"),
    makeMessage("r2-2", "assistant", "Round 2 response"),
  ]);

  const result = readHistoryBuffer();
  expect(result).toHaveLength(4);
  expect(result[0]?.id).toBe("r1-1");
  expect(result[3]?.id).toBe("r2-2");
});

test("replaceHistoryBuffer overwrites existing history", () => {
  appendToHistoryBuffer([
    makeMessage("old-1", "user", "Old message"),
    makeMessage("old-2", "assistant", "Old response"),
  ]);
  expect(readHistoryBuffer()).toHaveLength(2);

  const replacement: ChatMessage[] = [
    makeMessage("new-1", "assistant", "Fresh start"),
  ];
  replaceHistoryBuffer(replacement);

  const result = readHistoryBuffer();
  expect(result).toHaveLength(1);
  expect(result[0]?.id).toBe("new-1");
  expect(result[0]?.content).toBe("Fresh start");
});

test("appendCompactionSummary adds a transcript summary message", () => {
  appendCompactionSummary("Conversation compacted summary");
  const result = readHistoryBuffer();

  expect(result).toHaveLength(1);
  expect(result[0]?.role).toBe("assistant");
  expect(result[0]?.content).toBe("Conversation compacted summary");
  expect(result[0]?.id).toMatch(/^compact_/);
});

test("compact reset policy: clear then append summary keeps only summary", () => {
  appendToHistoryBuffer([
    makeMessage("before-1", "user", "Before compact"),
    makeMessage("before-2", "assistant", "Working..."),
  ]);
  expect(readHistoryBuffer()).toHaveLength(2);

  clearHistoryBuffer();
  appendCompactionSummary("Context compacted");

  const result = readHistoryBuffer();
  expect(result).toHaveLength(1);
  expect(result[0]?.content).toBe("Context compacted");
});

test("preserves all ChatMessage fields", () => {
  const msg: ChatMessage = {
    id: "full",
    role: "assistant",
    content: "Rich message",
    timestamp: "2026-01-01T00:00:00.000Z",
    durationMs: 1500,
    modelId: "claude-sonnet-4",
    toolCalls: [
      {
        id: "tc1",
        toolName: "Bash",
        input: { command: "ls" },
        status: "completed",
        output: "file1.ts\nfile2.ts",
      },
    ],
  };

  appendToHistoryBuffer([msg]);
  const result = readHistoryBuffer();
  expect(result).toHaveLength(1);
  expect(result[0]?.durationMs).toBe(1500);
  expect(result[0]?.modelId).toBe("claude-sonnet-4");
  expect(result[0]?.toolCalls).toHaveLength(1);
  expect(result[0]?.toolCalls?.[0]?.toolName).toBe("Bash");
});
