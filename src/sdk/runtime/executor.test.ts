import { test, expect, describe } from "bun:test";
import {
  renderMessagesToText,
  hasContent,
  escBash,
  escPwsh,
  watchCopilotSessionForHIL,
  type CopilotHILSessionSurface,
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

  test("returns empty string for claude assistant with unknown message shape", () => {
    const unknownMsg = { weird: "shape", count: 99 };
    const messages: SavedMessage[] = [makeClaudeMessage("assistant", unknownMsg)];
    expect(renderMessagesToText(messages)).toBe("");
  });

  test("extracts text blocks from mixed claude content array (text + tool_use)", () => {
    const messages: SavedMessage[] = [
      makeClaudeMessage("assistant", {
        content: [
          { type: "text", text: "I'll read the file" },
          { type: "tool_use", id: "tu-1", name: "Read", input: { path: "/tmp/foo" } },
          { type: "text", text: "Here's what I found" },
        ],
      }),
    ];
    expect(renderMessagesToText(messages)).toBe("I'll read the file\nHere's what I found");
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
// escBash — shell escaping for bash double-quoted strings
// ---------------------------------------------------------------------------

describe("escBash", () => {
  test("returns empty string unchanged", () => {
    expect(escBash("")).toBe("");
  });

  test("passes through plain alphanumeric text", () => {
    expect(escBash("hello world 123")).toBe("hello world 123");
  });

  test("escapes double quotes", () => {
    expect(escBash('say "hello"')).toBe('say \\"hello\\"');
  });

  test("escapes backslashes", () => {
    expect(escBash("a\\b")).toBe("a\\\\b");
  });

  test("escapes dollar signs", () => {
    expect(escBash("$HOME")).toBe("\\$HOME");
  });

  test("escapes backticks", () => {
    expect(escBash("`whoami`")).toBe("\\`whoami\\`");
  });

  test("escapes exclamation marks (history expansion)", () => {
    expect(escBash("hello!")).toBe("hello\\!");
  });

  test("replaces newlines with spaces", () => {
    expect(escBash("line1\nline2\nline3")).toBe("line1 line2 line3");
  });

  test("replaces carriage returns with spaces", () => {
    expect(escBash("line1\r\nline2")).toBe("line1 line2");
  });

  test("collapses consecutive newlines into a single space", () => {
    expect(escBash("a\n\n\nb")).toBe("a b");
  });

  test("strips null bytes", () => {
    expect(escBash("ab\0cd")).toBe("abcd");
  });

  test("preserves single quotes (literal in double-quoted bash strings)", () => {
    expect(escBash("it's fine")).toBe("it's fine");
  });

  test("preserves parentheses, braces, and brackets (safe in double quotes)", () => {
    expect(escBash("(a) {b} [c]")).toBe("(a) {b} [c]");
  });

  test("preserves pipe, ampersand, and semicolon (safe in double quotes)", () => {
    expect(escBash("a | b & c ; d")).toBe("a | b & c ; d");
  });

  test("handles a string with all special characters combined", () => {
    expect(escBash('$`"\\!\0')).toBe('\\$\\`\\"\\\\\\!');
  });

  test("handles unicode characters", () => {
    expect(escBash("héllo wörld 日本語")).toBe("héllo wörld 日本語");
  });

  test("handles very long strings without error", () => {
    const long = "a".repeat(10_000);
    expect(escBash(long)).toBe(long);
  });
});

// ---------------------------------------------------------------------------
// escPwsh — shell escaping for PowerShell double-quoted strings
// ---------------------------------------------------------------------------

describe("escPwsh", () => {
  test("returns empty string unchanged", () => {
    expect(escPwsh("")).toBe("");
  });

  test("passes through plain text", () => {
    expect(escPwsh("hello world")).toBe("hello world");
  });

  test("escapes backticks (PowerShell escape character)", () => {
    expect(escPwsh("a`b")).toBe("a``b");
  });

  test("escapes double quotes", () => {
    expect(escPwsh('say "hi"')).toBe('say `"hi`"');
  });

  test("escapes dollar signs", () => {
    expect(escPwsh("$env:HOME")).toBe("`$env:HOME");
  });

  test("converts newlines to backtick-n", () => {
    expect(escPwsh("line1\nline2")).toBe("line1`nline2");
  });

  test("converts carriage returns to backtick-r", () => {
    expect(escPwsh("line1\rline2")).toBe("line1`rline2");
  });

  test("strips null bytes", () => {
    expect(escPwsh("ab\0cd")).toBe("abcd");
  });

  test("handles combined special characters", () => {
    expect(escPwsh('$`"\0')).toBe('`$```"');
  });
});

// ---------------------------------------------------------------------------
// watchCopilotSessionForHIL — event-driven HIL detection via tool.execution_*
// ---------------------------------------------------------------------------

/**
 * Minimal mock of the Copilot session surface that records handlers by event
 * type and lets tests dispatch synthetic events.  Mirrors the structural
 * `on()` contract of `CopilotHILSessionSurface`.
 */
function makeMockCopilotSession(): CopilotHILSessionSurface & {
  dispatch: (type: string, data: unknown) => void;
  handlerCount: (type: string) => number;
} {
  const handlers = new Map<string, Set<(event: { data?: unknown }) => void>>();
  return {
    on(eventType, handler) {
      let set = handlers.get(eventType);
      if (!set) {
        set = new Set();
        handlers.set(eventType, set);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
      };
    },
    dispatch(type, data) {
      const set = handlers.get(type);
      if (set) for (const h of set) h({ data });
    },
    handlerCount(type) {
      return handlers.get(type)?.size ?? 0;
    },
  };
}

describe("watchCopilotSessionForHIL", () => {
  test("fires onHIL(true) on ask_user start and onHIL(false) on matching complete", () => {
    const session = makeMockCopilotSession();
    const calls: boolean[] = [];
    const unsubscribe = watchCopilotSessionForHIL(session, (w) =>
      calls.push(w),
    );

    session.dispatch("tool.execution_start", {
      toolName: "ask_user",
      toolCallId: "tc-1",
    });
    expect(calls).toEqual([true]);

    session.dispatch("tool.execution_complete", { toolCallId: "tc-1" });
    expect(calls).toEqual([true, false]);

    unsubscribe();
  });

  test("ignores tool.execution_start for non-ask_user tools", () => {
    const session = makeMockCopilotSession();
    const calls: boolean[] = [];
    const unsubscribe = watchCopilotSessionForHIL(session, (w) =>
      calls.push(w),
    );

    session.dispatch("tool.execution_start", {
      toolName: "edit_file",
      toolCallId: "tc-2",
    });
    session.dispatch("tool.execution_complete", { toolCallId: "tc-2" });
    expect(calls).toEqual([]);

    unsubscribe();
  });

  test("ignores complete events for toolCallIds it did not mark active", () => {
    const session = makeMockCopilotSession();
    const calls: boolean[] = [];
    const unsubscribe = watchCopilotSessionForHIL(session, (w) =>
      calls.push(w),
    );

    // complete arrives for a tool we never started (e.g. another tool's id)
    session.dispatch("tool.execution_complete", { toolCallId: "tc-unknown" });
    expect(calls).toEqual([]);

    unsubscribe();
  });

  test("only fires onHIL(false) after the last overlapping ask_user completes", () => {
    const session = makeMockCopilotSession();
    const calls: boolean[] = [];
    const unsubscribe = watchCopilotSessionForHIL(session, (w) =>
      calls.push(w),
    );

    session.dispatch("tool.execution_start", {
      toolName: "ask_user",
      toolCallId: "tc-a",
    });
    session.dispatch("tool.execution_start", {
      toolName: "ask_user",
      toolCallId: "tc-b",
    });
    // onHIL(true) fires exactly once on the first start
    expect(calls).toEqual([true]);

    session.dispatch("tool.execution_complete", { toolCallId: "tc-a" });
    // still one active — must not fire onHIL(false) yet
    expect(calls).toEqual([true]);

    session.dispatch("tool.execution_complete", { toolCallId: "tc-b" });
    expect(calls).toEqual([true, false]);

    unsubscribe();
  });

  test("skips ask_user start events that are missing a toolCallId", () => {
    const session = makeMockCopilotSession();
    const calls: boolean[] = [];
    const unsubscribe = watchCopilotSessionForHIL(session, (w) =>
      calls.push(w),
    );

    session.dispatch("tool.execution_start", { toolName: "ask_user" });
    expect(calls).toEqual([]);

    unsubscribe();
  });

  test("unsubscribe removes both listeners", () => {
    const session = makeMockCopilotSession();
    const unsubscribe = watchCopilotSessionForHIL(session, () => {});

    expect(session.handlerCount("tool.execution_start")).toBe(1);
    expect(session.handlerCount("tool.execution_complete")).toBe(1);

    unsubscribe();

    expect(session.handlerCount("tool.execution_start")).toBe(0);
    expect(session.handlerCount("tool.execution_complete")).toBe(0);
  });
});
