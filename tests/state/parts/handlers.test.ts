/**
 * Tests for handleTextDelta() — the core text streaming handler.
 *
 * Validates three code paths:
 *   1. Append delta to an existing streaming TextPart
 *   2. Merge back into a finalized TextPart (mid-sentence continuation)
 *   3. Create a new TextPart (paragraph break after tool completes)
 *
 * Uses reusable fixtures from test-support/fixtures and assertion helpers
 * from test-support/helpers.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { handleTextDelta } from "@/state/parts/handlers.ts";
import { _resetPartCounter, createPartId } from "@/state/parts/id.ts";
import type { ChatMessage } from "@/types/chat.ts";
import type { Part, TextPart, ToolPart } from "@/state/parts/types.ts";
import {
  createTextPart,
  createToolPart,
  createReasoningPart,
  createCompletedToolState,
  resetPartIdCounter,
} from "../../test-support/fixtures/parts.ts";
import {
  assertPartType,
  findPartByType,
  expectTextContent,
} from "../../test-support/helpers/parts.ts";

beforeEach(() => {
  _resetPartCounter();
  resetPartIdCounter();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal ChatMessage from a parts array. */
function msgFrom(parts: Part[]): ChatMessage {
  return { parts } as unknown as ChatMessage;
}

/** Shortcut: create a finalized text part (not streaming). */
function finalizedText(content: string, id?: string): TextPart {
  return createTextPart({
    content,
    isStreaming: false,
    ...(id ? { id: id as any } : { id: createPartId() as any }),
  });
}

/** Shortcut: create a streaming text part. */
function streamingText(content: string): TextPart {
  return createTextPart({
    content,
    isStreaming: true,
    id: createPartId() as any,
  });
}

// ---------------------------------------------------------------------------
// Path 1: Create new TextPart on empty / undefined parts
// ---------------------------------------------------------------------------

describe("handleTextDelta — create new TextPart", () => {
  test("creates new TextPart when parts is empty", () => {
    const msg = msgFrom([]);
    const result = handleTextDelta(msg, "Hello");

    expect(result.parts).toHaveLength(1);
    const part = assertPartType(result.parts![0]!, "text");
    expect(part.content).toBe("Hello");
    expect(part.isStreaming).toBe(true);
  });

  test("creates new TextPart when parts is undefined", () => {
    const msg = {} as unknown as ChatMessage;
    const result = handleTextDelta(msg, "Hello");

    expect(result.parts).toHaveLength(1);
    expect(result.parts![0]!.type).toBe("text");
  });

  test("new TextPart has valid PartId", () => {
    const result = handleTextDelta(msgFrom([]), "delta");
    expect(result.parts![0]!.id).toMatch(/^part_[0-9a-f]{12,}$/);
  });

  test("new TextPart has createdAt timestamp", () => {
    const result = handleTextDelta(msgFrom([]), "delta");
    const part = assertPartType(result.parts![0]!, "text");
    expect(new Date(part.createdAt).getTime()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Path 2: Append to existing streaming TextPart
// ---------------------------------------------------------------------------

describe("handleTextDelta — append to streaming TextPart", () => {
  test("appends delta to last streaming TextPart", () => {
    const msg = msgFrom([streamingText("Hello ")]);
    const result = handleTextDelta(msg, "World");

    expect(result.parts).toHaveLength(1);
    expectTextContent(result.parts!, "Hello World");
  });

  test("appends multiple deltas sequentially", () => {
    let msg = msgFrom([]);
    msg = handleTextDelta(msg, "A");
    msg = handleTextDelta(msg, "B");
    msg = handleTextDelta(msg, "C");

    expect(msg.parts).toHaveLength(1);
    expectTextContent(msg.parts!, "ABC");
  });

  test("appends to streaming part even when non-text parts precede it", () => {
    const tool = createToolPart({ state: createCompletedToolState(), id: createPartId() as any });
    const text = streamingText("before ");

    const msg = msgFrom([tool, text]);
    const result = handleTextDelta(msg, "after");

    expect(result.parts).toHaveLength(2);
    const textPart = assertPartType(result.parts![1]!, "text");
    expect(textPart.content).toBe("before after");
  });

  test("preserves isStreaming=true on append", () => {
    const msg = msgFrom([streamingText("Hi")]);
    const result = handleTextDelta(msg, " there");

    const part = assertPartType(result.parts![0]!, "text");
    expect(part.isStreaming).toBe(true);
  });

  test("preserves part id on append", () => {
    const original = streamingText("Hello");
    const originalId = original.id;
    const msg = msgFrom([original]);
    const result = handleTextDelta(msg, " World");

    expect(result.parts![0]!.id).toBe(originalId);
  });
});

// ---------------------------------------------------------------------------
// Path 3: Merge back into finalized TextPart (mid-sentence continuation)
// ---------------------------------------------------------------------------

describe("handleTextDelta — merge back into finalized TextPart", () => {
  test("merges when delta has no paragraph break", () => {
    const text = finalizedText("Before tool");
    const msg = msgFrom([text]);
    const result = handleTextDelta(msg, " continuation");

    expect(result.parts).toHaveLength(1);
    expectTextContent(result.parts!, "Before tool continuation");
  });

  test("does NOT merge when delta starts with paragraph break", () => {
    const text = finalizedText("Before tool");
    const msg = msgFrom([text]);
    const result = handleTextDelta(msg, "\n\nAfter tool");

    expect(result.parts).toHaveLength(2);
    const second = assertPartType(result.parts![1]!, "text");
    expect(second.content).toBe("\n\nAfter tool");
    expect(second.isStreaming).toBe(true);
  });

  test("does NOT merge when previous content ends with paragraph break", () => {
    const text = finalizedText("Before tool\n\n");
    const msg = msgFrom([text]);
    const result = handleTextDelta(msg, "After tool");

    expect(result.parts).toHaveLength(2);
    const second = assertPartType(result.parts![1]!, "text");
    expect(second.content).toBe("After tool");
    expect(second.isStreaming).toBe(true);
  });

  test("merge preserves isStreaming=false on the finalized part", () => {
    const text = finalizedText("Before");
    const msg = msgFrom([text]);
    const result = handleTextDelta(msg, " after");

    const part = assertPartType(result.parts![0]!, "text");
    expect(part.isStreaming).toBe(false);
  });

  test("only merges when finalized text is the last part", () => {
    // If finalized text is NOT the last part, it should create a new part
    const text = finalizedText("Before");
    const reasoning = createReasoningPart({ id: createPartId() as any });
    const msg = msgFrom([text, reasoning]);
    const result = handleTextDelta(msg, " continuation");

    // Should create a new text part since finalized text is not last
    expect(result.parts!.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Cross-path: tool boundary scenarios
// ---------------------------------------------------------------------------

describe("handleTextDelta — tool boundary scenarios", () => {
  test("text before tool, then text after tool with paragraph break", () => {
    // Simulate: text streaming -> tool completes -> finalized text -> new text
    let msg = msgFrom([]);
    msg = handleTextDelta(msg, "I will read the file.");

    // Finalize the text part (simulating what happens after tool completes)
    const finalized = { ...msg.parts![0]!, isStreaming: false } as TextPart;
    const tool = createToolPart({
      state: createCompletedToolState(),
      id: createPartId() as any,
    });
    msg = msgFrom([finalized, tool]);

    // New text after tool with paragraph break
    msg = handleTextDelta(msg, "\n\nThe file contains:");

    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");

    const lastText = assertPartType(msg.parts![2]!, "text");
    expect(lastText.content).toBe("\n\nThe file contains:");
    expect(lastText.isStreaming).toBe(true);
  });

  test("handles empty string delta gracefully", () => {
    const msg = msgFrom([streamingText("Hello")]);
    const result = handleTextDelta(msg, "");

    expect(result.parts).toHaveLength(1);
    expectTextContent(result.parts!, "Hello");
  });

  test("handles whitespace-only delta", () => {
    const msg = msgFrom([streamingText("Hello")]);
    const result = handleTextDelta(msg, "   ");

    expect(result.parts).toHaveLength(1);
    expectTextContent(result.parts!, "Hello   ");
  });

  test("handles newline (not paragraph break) in delta", () => {
    const text = finalizedText("Line one");
    const msg = msgFrom([text]);
    const result = handleTextDelta(msg, "\nLine two");

    // Single newline is NOT a paragraph break, so it should merge back
    expect(result.parts).toHaveLength(1);
    expectTextContent(result.parts!, "Line one\nLine two");
  });
});

// ---------------------------------------------------------------------------
// Immutability guarantees
// ---------------------------------------------------------------------------

describe("handleTextDelta — immutability", () => {
  test("returns a new message object (does not mutate input)", () => {
    const original = msgFrom([streamingText("Hi")]);
    const result = handleTextDelta(original, " there");

    expect(result).not.toBe(original);
  });

  test("returns a new parts array (does not mutate original parts)", () => {
    const originalParts = [streamingText("Hi")];
    const original = msgFrom(originalParts);
    const result = handleTextDelta(original, " there");

    // Original parts array should still have only "Hi"
    expect((originalParts[0] as TextPart).content).toBe("Hi");
    // Result should have appended content
    expectTextContent(result.parts!, "Hi there");
  });

  test("original text part object is not mutated on merge-back", () => {
    const text = finalizedText("Before");
    const original = msgFrom([text]);
    handleTextDelta(original, " after");

    // Original text part should still have original content
    expect(text.content).toBe("Before");
  });
});

// ---------------------------------------------------------------------------
// Multi-part message flows
// ---------------------------------------------------------------------------

describe("handleTextDelta — multi-part messages", () => {
  test("handles reasoning then text interleaving", () => {
    const reasoning = createReasoningPart({ id: createPartId() as any });
    let msg = msgFrom([reasoning]);
    msg = handleTextDelta(msg, "Hello from the model");

    expect(msg.parts).toHaveLength(2);
    expect(msg.parts![0]!.type).toBe("reasoning");
    expect(msg.parts![1]!.type).toBe("text");
    expectTextContent(msg.parts!, "Hello from the model");
  });

  test("handles multiple tool parts between text", () => {
    const text1 = finalizedText("Planning");
    const tool1 = createToolPart({ state: createCompletedToolState(), id: createPartId() as any });
    const tool2 = createToolPart({ state: createCompletedToolState(), id: createPartId() as any });

    let msg = msgFrom([text1, tool1, tool2]);
    msg = handleTextDelta(msg, "\n\nResults");

    expect(msg.parts).toHaveLength(4);
    const newText = findPartByType(
      msg.parts!.filter(p => p.type === "text" && (p as TextPart).isStreaming),
      "text",
    );
    expect(newText).toBeDefined();
    expect(newText!.content).toBe("\n\nResults");
  });
});
