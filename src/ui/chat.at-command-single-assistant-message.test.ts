import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { globalRegistry } from "./commands/index.ts";
import { createMessage, type ChatMessage } from "./chat.tsx";
import { parseAtMentions } from "./utils/mention-parsing.ts";

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
