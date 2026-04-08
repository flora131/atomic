import { test, expect, describe } from "bun:test";
import {
  renderMessagesToText,
  hasContent,
  isTextBlockArray,
} from "./executor.ts";
import type { SavedMessage } from "../types.ts";
import type { SessionEvent } from "@github/copilot-sdk";
import type { SessionPromptResponse } from "@opencode-ai/sdk/v2";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Test helpers — minimal cast factories
// ---------------------------------------------------------------------------

function makeCopilotAssistantEvent(content: string): SavedMessage {
  return {
    provider: "copilot",
    data: {
      id: "evt-001",
      timestamp: "2024-01-01T00:00:00Z",
      parentId: null,
      type: "assistant.message",
      data: {
        messageId: "msg-001",
        content,
        toolCalls: [],
      },
    } as unknown as SessionEvent,
  };
}

function makeCopilotSessionStartEvent(): SavedMessage {
  return {
    provider: "copilot",
    data: {
      id: "evt-000",
      timestamp: "2024-01-01T00:00:00Z",
      parentId: null,
      type: "session.start",
      data: {
        sessionId: "sess-001",
        version: 1,
        producer: "copilot-agent",
        copilotVersion: "1.0.0",
        startTime: "2024-01-01T00:00:00Z",
      },
    } as unknown as SessionEvent,
  };
}

function makeOpenCodeMessage(parts: Array<{ type: string; text?: string; id?: string }>): SavedMessage {
  return {
    provider: "opencode",
    data: {
      info: {
        id: "msg-oc-001",
        sessionID: "sess-oc-001",
        role: "assistant",
        time: { created: 1000 },
        parentID: "parent-001",
        modelID: "gpt-4",
        providerID: "openai",
        mode: "auto",
        agent: "agent",
        path: { cwd: "/tmp" },
        tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      },
      parts: parts.map((p, i) =>
        p.type === "text"
          ? { id: p.id ?? `part-${i}`, sessionID: "sess-oc-001", messageID: "msg-oc-001", type: "text" as const, text: p.text ?? "" }
          : { id: `part-${i}`, sessionID: "sess-oc-001", messageID: "msg-oc-001", type: p.type as "reasoning", text: "" },
      ),
    } as unknown as SessionPromptResponse,
  };
}

function makeClaudeMessage(
  type: "user" | "assistant" | "system",
  message: unknown,
): SavedMessage {
  return {
    provider: "claude",
    data: {
      type,
      uuid: "uuid-001",
      session_id: "sess-cl-001",
      message,
      parent_tool_use_id: null,
    } as SessionMessage,
  };
}

// ---------------------------------------------------------------------------
// renderMessagesToText
// ---------------------------------------------------------------------------

describe("renderMessagesToText", () => {
  test("returns empty string for empty array", () => {
    expect(renderMessagesToText([])).toBe("");
  });

  // --- Copilot ---

  test("extracts content from a copilot assistant.message event", () => {
    const messages: SavedMessage[] = [makeCopilotAssistantEvent("Hello from Copilot")];
    expect(renderMessagesToText(messages)).toBe("Hello from Copilot");
  });

  test("skips copilot non-assistant events (session.start)", () => {
    const messages: SavedMessage[] = [makeCopilotSessionStartEvent()];
    expect(renderMessagesToText(messages)).toBe("");
  });

  test("only includes copilot assistant.message events when mixed with other event types", () => {
    const messages: SavedMessage[] = [
      makeCopilotSessionStartEvent(),
      makeCopilotAssistantEvent("First response"),
      makeCopilotSessionStartEvent(),
      makeCopilotAssistantEvent("Second response"),
    ];
    expect(renderMessagesToText(messages)).toBe("First response\n\nSecond response");
  });

  // --- OpenCode ---

  test("joins opencode text parts with newlines", () => {
    const messages: SavedMessage[] = [
      makeOpenCodeMessage([
        { type: "text", text: "Line one" },
        { type: "text", text: "Line two" },
      ]),
    ];
    expect(renderMessagesToText(messages)).toBe("Line one\nLine two");
  });

  test("filters out non-text parts from opencode messages", () => {
    const messages: SavedMessage[] = [
      makeOpenCodeMessage([
        { type: "reasoning", text: "thinking..." },
        { type: "subtask", text: "" },
      ]),
    ];
    expect(renderMessagesToText(messages)).toBe("");
  });

  test("includes only text parts when opencode message has mixed part types", () => {
    const messages: SavedMessage[] = [
      makeOpenCodeMessage([
        { type: "reasoning", text: "thinking..." },
        { type: "text", text: "The answer is 42" },
        { type: "subtask", text: "" },
      ]),
    ];
    expect(renderMessagesToText(messages)).toBe("The answer is 42");
  });

  // --- Claude ---

  test("returns string message from claude assistant with plain string message", () => {
    const messages: SavedMessage[] = [makeClaudeMessage("assistant", "Plain string output")];
    expect(renderMessagesToText(messages)).toBe("Plain string output");
  });

  test("returns content when claude assistant message is an object with content string", () => {
    const messages: SavedMessage[] = [
      makeClaudeMessage("assistant", { content: "Content field string" }),
    ];
    expect(renderMessagesToText(messages)).toBe("Content field string");
  });

  test("joins text blocks when claude assistant message has content as text block array", () => {
    const messages: SavedMessage[] = [
      makeClaudeMessage("assistant", {
        content: [
          { type: "text", text: "Block one" },
          { type: "text", text: "Block two" },
        ],
      }),
    ];
    expect(renderMessagesToText(messages)).toBe("Block one\nBlock two");
  });

  test("skips claude user messages", () => {
    const messages: SavedMessage[] = [makeClaudeMessage("user", "user prompt")];
    expect(renderMessagesToText(messages)).toBe("");
  });

  test("skips claude system messages", () => {
    const messages: SavedMessage[] = [makeClaudeMessage("system", "system instructions")];
    expect(renderMessagesToText(messages)).toBe("");
  });

  test("falls back to JSON.stringify for claude assistant with unknown message shape", () => {
    const unknownMsg = { weird: "shape", count: 99 };
    const messages: SavedMessage[] = [makeClaudeMessage("assistant", unknownMsg)];
    expect(renderMessagesToText(messages)).toBe(JSON.stringify(unknownMsg));
  });

  // --- Mixed providers ---

  test("joins messages from mixed providers with double newlines", () => {
    const messages: SavedMessage[] = [
      makeCopilotAssistantEvent("Copilot says hello"),
      makeOpenCodeMessage([{ type: "text", text: "OpenCode says hello" }]),
      makeClaudeMessage("assistant", "Claude says hello"),
    ];
    expect(renderMessagesToText(messages)).toBe(
      "Copilot says hello\n\nOpenCode says hello\n\nClaude says hello",
    );
  });

  test("skips blank entries when building joined output", () => {
    const messages: SavedMessage[] = [
      makeCopilotSessionStartEvent(),
      makeCopilotAssistantEvent("Only one has content"),
      makeOpenCodeMessage([{ type: "reasoning", text: "ignored" }]),
    ];
    expect(renderMessagesToText(messages)).toBe("Only one has content");
  });
});

// ---------------------------------------------------------------------------
// hasContent type guard
// ---------------------------------------------------------------------------

describe("hasContent", () => {
  test("returns true for object with string content property", () => {
    expect(hasContent({ content: "hello" })).toBe(true);
  });

  test("returns false for empty object", () => {
    expect(hasContent({})).toBe(false);
  });

  test("returns false for null", () => {
    expect(hasContent(null)).toBe(false);
  });

  test("returns false when content is a number instead of a string", () => {
    expect(hasContent({ content: 42 })).toBe(false);
  });

  test("returns false for a plain string value", () => {
    expect(hasContent("hello")).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(hasContent(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTextBlockArray type guard
// ---------------------------------------------------------------------------

describe("isTextBlockArray", () => {
  test("returns true for a valid array of text blocks", () => {
    expect(isTextBlockArray([{ type: "text", text: "hi" }])).toBe(true);
  });

  test("returns true for an array with multiple text blocks", () => {
    expect(
      isTextBlockArray([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
    ).toBe(true);
  });

  test("returns true for an empty array (vacuously satisfies every element check)", () => {
    // Array.prototype.every returns true on empty arrays — the empty array
    // satisfies the type guard because there are no elements that violate it.
    expect(isTextBlockArray([])).toBe(true);
  });

  test("returns false for array with wrong block shape (missing text)", () => {
    expect(isTextBlockArray([{ type: "text" }])).toBe(false);
  });

  test("returns false for array with wrong type value", () => {
    expect(isTextBlockArray([{ type: "tool_use", text: "hi" }])).toBe(false);
  });

  test("returns false for non-array value", () => {
    expect(isTextBlockArray("not an array")).toBe(false);
  });

  test("returns false for null", () => {
    expect(isTextBlockArray(null)).toBe(false);
  });

  test("returns false when array elements are not objects", () => {
    expect(isTextBlockArray(["text"])).toBe(false);
  });
});
