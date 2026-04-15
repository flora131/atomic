import { test, expect, describe } from "bun:test";
import { _hasUnresolvedHILTool, _runHILWatcher } from "../../../src/sdk/providers/claude.ts";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Helpers to build minimal SessionMessage objects
// ---------------------------------------------------------------------------

function makeAssistantMsg(content: unknown[]): SessionMessage {
  return {
    type: "assistant",
    uuid: crypto.randomUUID(),
    session_id: "test-session",
    parent_tool_use_id: null,
    message: { role: "assistant", content },
  };
}

function makeUserMsg(content: unknown[]): SessionMessage {
  return {
    type: "user",
    uuid: crypto.randomUUID(),
    session_id: "test-session",
    parent_tool_use_id: null,
    message: { role: "user", content },
  };
}

function makeToolUse(id: string, name: string) {
  return { type: "tool_use", id, name, input: {} };
}

function makeToolResult(toolUseId: string) {
  return { type: "tool_result", tool_use_id: toolUseId, content: "done" };
}

// ---------------------------------------------------------------------------
// _hasUnresolvedHILTool
// ---------------------------------------------------------------------------

describe("_hasUnresolvedHILTool", () => {
  test("returns false for empty messages array", () => {
    expect(_hasUnresolvedHILTool([])).toBe(false);
  });

  test("returns false when no assistant messages exist", () => {
    const msgs: SessionMessage[] = [
      makeUserMsg([{ type: "text", text: "hello" }]),
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(false);
  });

  test("returns false when transcript has AskUserQuestion tool_use with matching tool_result (resolved)", () => {
    const id = "tool-1";
    const msgs: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "AskUserQuestion")]),
      makeUserMsg([makeToolResult(id)]),
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(false);
  });

  test("returns true when transcript has AskUserQuestion tool_use with NO matching tool_result (unresolved)", () => {
    const id = "tool-2";
    const msgs: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "AskUserQuestion")]),
      // No user message with a matching tool_result
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(true);
  });

  test("returns false when non-AskUserQuestion tool_use has no matching tool_result", () => {
    const id = "tool-3";
    const msgs: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "ReadFile")]),
      // No tool_result — but ReadFile is not AskUserQuestion
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(false);
  });

  test("returns true when multiple tool_uses exist and only AskUserQuestion is unresolved", () => {
    const readFileId = "tool-read";
    const askId = "tool-ask";
    const msgs: SessionMessage[] = [
      // ReadFile resolved
      makeAssistantMsg([makeToolUse(readFileId, "ReadFile")]),
      makeUserMsg([makeToolResult(readFileId)]),
      // AskUserQuestion NOT resolved
      makeAssistantMsg([makeToolUse(askId, "AskUserQuestion")]),
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(true);
  });

  test("returns false when later assistant message has no AskUserQuestion (earlier unresolved is ignored)", () => {
    const askId = "tool-ask-old";
    const readFileId = "tool-read-new";
    const msgs: SessionMessage[] = [
      // Old unresolved AskUserQuestion in first assistant message
      makeAssistantMsg([makeToolUse(askId, "AskUserQuestion")]),
      // Most recent assistant message has only ReadFile (no AskUserQuestion)
      makeAssistantMsg([makeToolUse(readFileId, "ReadFile")]),
    ];
    // Function checks only the LAST assistant message — should return false
    expect(_hasUnresolvedHILTool(msgs)).toBe(false);
  });

  test("returns false when assistant message content is not an array", () => {
    const msgs: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "u1",
        session_id: "s1",
        parent_tool_use_id: null,
        message: { role: "assistant", content: "plain string" },
      },
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(false);
  });

  test("returns false when assistant message has AskUserQuestion without an id field", () => {
    const msgs: SessionMessage[] = [
      makeAssistantMsg([{ type: "tool_use", name: "AskUserQuestion", input: {} }]),
    ];
    // No id on the block — resolvedIds can't match it
    expect(_hasUnresolvedHILTool(msgs)).toBe(false);
  });

  test("returns false when assistant message has no content at all", () => {
    const msgs: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "u2",
        session_id: "s2",
        parent_tool_use_id: null,
        message: {},
      },
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(false);
  });

  test("handles multiple AskUserQuestion tool_uses in last assistant message — unresolved if any lacks tool_result", () => {
    const id1 = "ask-1";
    const id2 = "ask-2";
    const msgs: SessionMessage[] = [
      makeAssistantMsg([
        makeToolUse(id1, "AskUserQuestion"),
        makeToolUse(id2, "AskUserQuestion"),
      ]),
      makeUserMsg([makeToolResult(id1)]),
      // id2 not resolved
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(true);
  });

  test("returns false when both AskUserQuestion tool_uses in last assistant message are resolved", () => {
    const id1 = "ask-a";
    const id2 = "ask-b";
    const msgs: SessionMessage[] = [
      makeAssistantMsg([
        makeToolUse(id1, "AskUserQuestion"),
        makeToolUse(id2, "AskUserQuestion"),
      ]),
      makeUserMsg([makeToolResult(id1), makeToolResult(id2)]),
    ];
    expect(_hasUnresolvedHILTool(msgs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// _runHILWatcher — tests wasHIL guard and onHIL(true/false) state transitions
// ---------------------------------------------------------------------------

/**
 * Build a minimal async iterable from an array of snapshot arrays.
 * Each element of `snapshots` is one "file-change event", and the corresponding
 * `readMessages` call returns the messages at that index.
 */
async function* makeEventStream(count: number): AsyncGenerator<unknown> {
  for (let i = 0; i < count; i++) {
    yield { filename: "session.jsonl" };
  }
}

describe("_runHILWatcher", () => {
  test("fires onHIL(true) when readMessages returns unresolved AskUserQuestion", async () => {
    const id = "ask-1";
    const msgs: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "AskUserQuestion")]),
      // No tool_result — unresolved
    ];
    const hilCalls: boolean[] = [];

    await _runHILWatcher(
      makeEventStream(1),
      async () => msgs,
      (w) => hilCalls.push(w),
    );

    expect(hilCalls).toEqual([true]);
  });

  test("fires onHIL(false) when readMessages returns resolved transcript after unresolved", async () => {
    const id = "ask-2";

    // First event: unresolved
    const unresolvedMsgs: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "AskUserQuestion")]),
    ];
    // Second event: resolved
    const resolvedMsgs: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "AskUserQuestion")]),
      makeUserMsg([makeToolResult(id)]),
    ];

    let callCount = 0;
    const snapshots = [unresolvedMsgs, resolvedMsgs];
    const hilCalls: boolean[] = [];

    await _runHILWatcher(
      makeEventStream(2),
      async () => snapshots[callCount++]!,
      (w) => hilCalls.push(w),
    );

    expect(hilCalls).toEqual([true, false]);
  });

  test("wasHIL guard prevents redundant onHIL calls when state does not change", async () => {
    const id = "ask-3";

    // All three events return the same unresolved transcript
    const unresolvedMsgs: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "AskUserQuestion")]),
    ];
    const hilCalls: boolean[] = [];

    await _runHILWatcher(
      makeEventStream(3),
      async () => unresolvedMsgs,
      (w) => hilCalls.push(w),
    );

    // onHIL(true) fires only once despite three events
    expect(hilCalls).toEqual([true]);
  });

  test("does not fire onHIL at all when transcript never has AskUserQuestion", async () => {
    const hilCalls: boolean[] = [];

    await _runHILWatcher(
      makeEventStream(2),
      async () => [makeUserMsg([{ type: "text", text: "hello" }])],
      (w) => hilCalls.push(w),
    );

    expect(hilCalls).toEqual([]);
  });

  test("swallows readMessages errors and continues watching", async () => {
    const id = "ask-4";
    const resolvedMsgs: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "AskUserQuestion")]),
      makeUserMsg([makeToolResult(id)]),
    ];

    let callCount = 0;
    const hilCalls: boolean[] = [];

    // First event throws, second event returns resolved transcript (no HIL)
    await _runHILWatcher(
      makeEventStream(2),
      async () => {
        callCount++;
        if (callCount === 1) throw new Error("read failed");
        return resolvedMsgs;
      },
      (w) => hilCalls.push(w),
    );

    // Error was swallowed; second event returns resolved — wasHIL was false, still false: no callback
    expect(hilCalls).toEqual([]);
  });

  test("fires onHIL(true) then onHIL(false) across three state changes correctly", async () => {
    const id = "ask-5";

    const unresolved: SessionMessage[] = [makeAssistantMsg([makeToolUse(id, "AskUserQuestion")])];
    const resolved: SessionMessage[] = [
      makeAssistantMsg([makeToolUse(id, "AskUserQuestion")]),
      makeUserMsg([makeToolResult(id)]),
    ];

    const snapshots = [unresolved, resolved, unresolved];
    let callCount = 0;
    const hilCalls: boolean[] = [];

    await _runHILWatcher(
      makeEventStream(3),
      async () => snapshots[callCount++]!,
      (w) => hilCalls.push(w),
    );

    expect(hilCalls).toEqual([true, false, true]);
  });
});
