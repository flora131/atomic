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

  test("merges continuation into finalized TextPart when no paragraph break", () => {
    // Simulate finalized TextPart (after tool boundary) with mid-sentence continuation
    const msg = {
      parts: [{
        id: "part_000000000001_0001" as any,
        type: "text",
        content: "Before tool",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      }],
    } as unknown as ChatMessage;
    const result = handleTextDelta(msg, " continuation");
    expect(result.parts).toHaveLength(1);
    expect((result.parts![0] as TextPart).content).toBe("Before tool continuation");
    expect((result.parts![0] as TextPart).isStreaming).toBe(false);
  });

  test("creates new TextPart when delta starts with paragraph break", () => {
    const msg = {
      parts: [{
        id: "part_000000000001_0001" as any,
        type: "text",
        content: "Before tool",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      }],
    } as unknown as ChatMessage;
    const result = handleTextDelta(msg, "\n\nAfter tool");
    expect(result.parts).toHaveLength(2);
    expect((result.parts![1] as TextPart).content).toBe("\n\nAfter tool");
    expect((result.parts![1] as TextPart).isStreaming).toBe(true);
  });

  test("creates new TextPart when previous ends with paragraph break", () => {
    const msg = {
      parts: [{
        id: "part_000000000001_0001" as any,
        type: "text",
        content: "Before tool\n\n",
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
