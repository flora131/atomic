import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { globalRegistry } from "@/commands/tui/index.ts";
import { createMessage, shouldHideStaleSubagentToolPlaceholder, type ChatMessage } from "@/state/chat/exports.ts";
import { parseAtMentions } from "@/lib/ui/mention-parsing.ts";

type SetMessagesWindowed = (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;

function submitAtCommandInvocation(
  message: string,
  deps: {
    setMessagesWindowed: SetMessagesWindowed;
    executeCommand: (commandName: string, args: string, trigger: "mention") => void;
  },
): void {
  const atMentions = parseAtMentions(message);
  if (atMentions.length === 0) return;

  deps.setMessagesWindowed((prev) => [...prev, createMessage("user", message)]);
  for (const mention of atMentions) {
    deps.executeCommand(mention.agentName, mention.args, "mention");
  }
}

describe("@ command assistant message contract", () => {
  let agentName = "";

  beforeEach(() => {
    agentName = `single-assistant-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    globalRegistry.register({
      name: agentName,
      description: "test agent",
      category: "agent",
      execute: () => ({ success: true }),
    });
  });

  afterEach(() => {
    globalRegistry.unregister(agentName);
  });

  test("creates exactly one assistant message per @ command invocation", () => {
    let messages: ChatMessage[] = [];
    const setMessagesWindowed = mock((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      messages = updater(messages);
      return messages;
    });

    const sendSilentMessage = () => {
      const assistantMessage = createMessage("assistant", "", true);
      setMessagesWindowed((prev) => [...prev, assistantMessage]);
    };

    const executeCommand = mock((_commandName: string, _args: string, _trigger: "mention") => {
      sendSilentMessage();
    });

    submitAtCommandInvocation(`@${agentName} summarize the latest changes`, {
      setMessagesWindowed,
      executeCommand,
    });

    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);

    const assistantMessageAppenderCalls = setMessagesWindowed.mock.calls.filter(([updater]) => {
      const candidate = updater([]);
      return candidate.length === 1 && candidate[0]?.role === "assistant";
    });
    expect(assistantMessageAppenderCalls).toHaveLength(1);
  });
});

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
