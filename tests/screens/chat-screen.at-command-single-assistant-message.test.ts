import { describe, expect, test } from "bun:test";
import { createMessage, shouldHideStaleSubagentToolPlaceholder } from "@/state/chat/exports.ts";

describe("stale task placeholder filtering", () => {
  test("keeps stale assistant message that only contains sub-agent task tool parts", () => {
    const message = createMessage("assistant", "", false);
    message.parts = [
      {
        id: "tool-part-1",
        type: "tool",
        toolCallId: "tool-1",
        toolName: "task",
        input: {},
        state: { status: "running", startedAt: "2026-03-02T00:00:00.000Z" },
        createdAt: "2026-03-02T00:00:00.000Z",
      },
    ];

    expect(shouldHideStaleSubagentToolPlaceholder(message, new Set())).toBe(false);
  });

  test("keeps active message ids visible", () => {
    const message = createMessage("assistant", "", false);
    message.parts = [
      {
        id: "tool-part-1",
        type: "tool",
        toolCallId: "tool-1",
        toolName: "task",
        input: {},
        state: { status: "running", startedAt: "2026-03-02T00:00:00.000Z" },
        createdAt: "2026-03-02T00:00:00.000Z",
      },
    ];

    expect(shouldHideStaleSubagentToolPlaceholder(message, new Set([message.id]))).toBe(false);
  });

  test("keeps messages that already have parallel agents", () => {
    const message = createMessage("assistant", "", false);
    message.parts = [
      {
        id: "tool-part-1",
        type: "tool",
        toolCallId: "tool-1",
        toolName: "task",
        input: {},
        state: { status: "running", startedAt: "2026-03-02T00:00:00.000Z" },
        createdAt: "2026-03-02T00:00:00.000Z",
      },
    ];
    message.parallelAgents = [
      {
        id: "agent-1",
        taskToolCallId: "tool-1",
        name: "codebase-online-researcher",
        task: "TUI UX best practices",
        status: "pending",
        startedAt: "2026-03-02T00:00:00.000Z",
      },
    ];

    expect(shouldHideStaleSubagentToolPlaceholder(message, new Set())).toBe(false);
  });
});
