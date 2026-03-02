import { describe, expect, test } from "bun:test";
import {
  createMessage,
  reconcilePreviousStreamingPlaceholder,
  type ChatMessage,
} from "./chat.tsx";

function simulateSendSilentMessageStart(
  messages: ChatMessage[],
  previousStreamingId: string | null,
): ChatMessage[] {
  const reconciled = reconcilePreviousStreamingPlaceholder(messages, previousStreamingId);
  return [...reconciled, createMessage("assistant", "", true)];
}

describe("sendSilentMessage integration", () => {
  test("creates exactly one assistant message for a fresh silent stream", () => {
    const userMessage = createMessage("user", "@worker do the thing");

    const next = simulateSendSilentMessageStart([userMessage], null);
    const assistantMessages = next.filter((message) => message.role === "assistant");

    expect(next).toHaveLength(2);
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.streaming).toBe(true);
  });

  test("replaces an empty streaming placeholder instead of creating duplicates", () => {
    const userMessage = createMessage("user", "@worker do the thing");
    const stalePlaceholder = createMessage("assistant", "", true);

    const next = simulateSendSilentMessageStart(
      [userMessage, stalePlaceholder],
      stalePlaceholder.id,
    );
    const assistantMessages = next.filter((message) => message.role === "assistant");

    expect(next).toHaveLength(2);
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.id).not.toBe(stalePlaceholder.id);
    expect(assistantMessages[0]?.streaming).toBe(true);
  });
});
