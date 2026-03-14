import { test, expect, describe } from "bun:test";
import { reorderStreamingMessageToEnd } from "@/state/chat/shell/use-render-model.tsx";
import type { ChatMessage } from "@/types/chat.ts";

function createMsg(id: string, role: "user" | "assistant" | "system", streaming?: boolean): ChatMessage {
  return {
    id,
    role,
    content: `content-${id}`,
    timestamp: new Date().toISOString(),
    streaming,
  } as ChatMessage;
}

describe("reorderStreamingMessageToEnd", () => {
  test("returns messages unchanged when streamingMessageId is null", () => {
    const msgs = [createMsg("1", "user"), createMsg("2", "assistant")];
    const result = reorderStreamingMessageToEnd(msgs, null);
    expect(result).toBe(msgs);
  });

  test("returns messages unchanged when streaming message is already last", () => {
    const msgs = [
      createMsg("1", "user"),
      createMsg("2", "assistant", true),
    ];
    const result = reorderStreamingMessageToEnd(msgs, "2");
    expect(result).toBe(msgs);
  });

  test("returns messages unchanged when streaming message id is not found", () => {
    const msgs = [createMsg("1", "user"), createMsg("2", "system")];
    const result = reorderStreamingMessageToEnd(msgs, "nonexistent");
    expect(result).toBe(msgs);
  });

  test("moves streaming message to end when system messages follow it", () => {
    const user = createMsg("1", "user");
    const streaming = createMsg("2", "assistant", true);
    const system1 = createMsg("3", "system");
    const system2 = createMsg("4", "system");
    const msgs = [user, streaming, system1, system2];

    const result = reorderStreamingMessageToEnd(msgs, "2");

    expect(result.map((m) => m.id)).toEqual(["1", "3", "4", "2"]);
    expect(result[result.length - 1]).toBe(streaming);
  });

  test("moves streaming message to end with single trailing system message", () => {
    const user = createMsg("1", "user");
    const streaming = createMsg("2", "assistant", true);
    const system1 = createMsg("3", "system");
    const msgs = [user, streaming, system1];

    const result = reorderStreamingMessageToEnd(msgs, "2");

    expect(result.map((m) => m.id)).toEqual(["1", "3", "2"]);
  });

  test("preserves relative order of non-streaming messages", () => {
    const user = createMsg("1", "user");
    const streaming = createMsg("2", "assistant", true);
    const sys1 = createMsg("3", "system");
    const sys2 = createMsg("4", "system");
    const sys3 = createMsg("5", "system");
    const msgs = [user, streaming, sys1, sys2, sys3];

    const result = reorderStreamingMessageToEnd(msgs, "2");

    const nonStreamingOrder = result.slice(0, -1).map((m) => m.id);
    expect(nonStreamingOrder).toEqual(["1", "3", "4", "5"]);
  });

  test("handles streaming message as the only message", () => {
    const streaming = createMsg("1", "assistant", true);
    const msgs = [streaming];
    const result = reorderStreamingMessageToEnd(msgs, "1");
    expect(result).toBe(msgs);
  });

  test("does not mutate the original array", () => {
    const user = createMsg("1", "user");
    const streaming = createMsg("2", "assistant", true);
    const system1 = createMsg("3", "system");
    const msgs = [user, streaming, system1];
    const original = [...msgs];

    reorderStreamingMessageToEnd(msgs, "2");

    expect(msgs.map((m) => m.id)).toEqual(original.map((m) => m.id));
  });
});
