import { test, expect, describe, beforeEach } from "bun:test";
import { handleTextDelta } from "./handlers.ts";
import { _resetPartCounter } from "./id.ts";
import type { ChatMessage } from "../chat.tsx";
import type { TextPart } from "./types.ts";

beforeEach(() => _resetPartCounter());

describe("handleTextDelta", () => {
  test("creates new TextPart on empty parts array", () => {
    const msg = { parts: [] } as unknown as ChatMessage;
    const result = handleTextDelta(msg, "Hello");
    expect(result.parts).toHaveLength(1);
    expect(result.parts![0]!.type).toBe("text");
    expect((result.parts![0] as TextPart).content).toBe("Hello");
    expect((result.parts![0] as TextPart).isStreaming).toBe(true);
  });

  test("appends to existing streaming TextPart", () => {
    // Create a message with an existing streaming TextPart
    const msg = { parts: [] } as unknown as ChatMessage;
    const msg2 = handleTextDelta(msg, "Hello ");
    const result = handleTextDelta(msg2, "World");
    expect(result.parts).toHaveLength(1);
    expect((result.parts![0] as TextPart).content).toBe("Hello World");
  });

  test("creates new TextPart when last TextPart is not streaming", () => {
    // Simulate finalized TextPart (after tool boundary)
    const msg = {
      parts: [{
        id: "part_000000000001_0001" as any,
        type: "text",
        content: "Before tool",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      }],
    } as unknown as ChatMessage;
    const result = handleTextDelta(msg, "After tool");
    expect(result.parts).toHaveLength(2);
    expect((result.parts![1] as TextPart).content).toBe("After tool");
    expect((result.parts![1] as TextPart).isStreaming).toBe(true);
  });

  test("handles undefined parts (initializes to empty)", () => {
    const msg = {} as unknown as ChatMessage;
    const result = handleTextDelta(msg, "Hello");
    expect(result.parts).toHaveLength(1);
  });
});
