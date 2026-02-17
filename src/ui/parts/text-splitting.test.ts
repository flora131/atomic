/**
 * Integration tests for tool-boundary text splitting
 *
 * These tests verify that text is correctly split at tool boundaries.
 * When a tool call interrupts text streaming, the pre-tool text and
 * post-tool text become separate TextParts.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { handleTextDelta } from "./handlers.ts";
import { upsertPart, findLastPartIndex } from "./store.ts";
import { createPartId, _resetPartCounter } from "./id.ts";
import type { Part, TextPart, ToolPart } from "./types.ts";
import type { ChatMessage } from "../chat.tsx";

/**
 * Create a minimal ChatMessage mock for testing.
 */
function createMockMessage(): ChatMessage {
  return {
    id: "test-msg",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parts: [],
    streaming: true,
  } as ChatMessage;
}

/**
 * Helper to finalize the last streaming TextPart.
 * Mimics what happens in chat.tsx when a tool starts.
 */
function finalizeLastTextPart(msg: ChatMessage): ChatMessage {
  const parts = [...(msg.parts ?? [])];
  const lastTextIdx = findLastPartIndex(parts, p => p.type === "text" && (p as TextPart).isStreaming);
  if (lastTextIdx >= 0) {
    parts[lastTextIdx] = { ...parts[lastTextIdx], isStreaming: false } as TextPart;
  }
  return { ...msg, parts };
}

/**
 * Helper to create a ToolPart.
 */
function createToolPart(toolCallId: string, toolName: string): ToolPart {
  return {
    id: createPartId(),
    type: "tool",
    toolCallId,
    toolName,
    input: { command: "test" },
    state: { status: "running", startedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  _resetPartCounter();
});

describe("Tool-boundary text splitting", () => {
  test("text before tool becomes finalized TextPart", () => {
    // Simulate streaming text, then a tool start
    let msg = createMockMessage();
    
    // Stream "Hello "
    msg = handleTextDelta(msg, "Hello ");
    
    // Verify TextPart is streaming
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.type).toBe("text");
    expect((msg.parts![0] as TextPart).content).toBe("Hello ");
    expect((msg.parts![0] as TextPart).isStreaming).toBe(true);
    
    // Simulate tool.start which finalizes the TextPart
    msg = finalizeLastTextPart(msg);
    
    // Verify TextPart is now finalized
    expect(msg.parts).toHaveLength(1);
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    expect((msg.parts![0] as TextPart).content).toBe("Hello ");
  });

  test("text after tool becomes new TextPart", () => {
    // Simulate: text → tool.start → tool.complete → new text
    let msg = createMockMessage();
    
    // Stream "Hello "
    msg = handleTextDelta(msg, "Hello ");
    expect(msg.parts).toHaveLength(1);
    expect((msg.parts![0] as TextPart).isStreaming).toBe(true);
    
    // Tool starts - finalize text
    msg = finalizeLastTextPart(msg);
    const toolPart = createToolPart("tool_123", "bash");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    expect(msg.parts).toHaveLength(2);
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    
    // Tool completes - now stream new text
    msg = handleTextDelta(msg, " World");
    
    // Verify new TextPart was created
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![2]!.type).toBe("text");
    const newTextPart = msg.parts![2] as TextPart;
    expect(newTextPart.content).toBe(" World");
    expect(newTextPart.isStreaming).toBe(true);
    
    // Verify old TextPart is still finalized
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    expect((msg.parts![0] as TextPart).content).toBe("Hello ");
  });

  test("multiple tool interruptions create multiple TextParts", () => {
    // Simulate: text1 → tool1 → text2 → tool2 → text3
    let msg = createMockMessage();
    
    // Text 1
    msg = handleTextDelta(msg, "First");
    expect(msg.parts).toHaveLength(1);
    
    // Tool 1
    msg = finalizeLastTextPart(msg);
    const tool1 = createToolPart("tool_1", "bash");
    msg.parts = upsertPart(msg.parts!, tool1);
    expect(msg.parts).toHaveLength(2);
    
    // Text 2
    msg = handleTextDelta(msg, "Second");
    expect(msg.parts).toHaveLength(3);
    
    // Tool 2
    msg = finalizeLastTextPart(msg);
    const tool2 = createToolPart("tool_2", "view");
    msg.parts = upsertPart(msg.parts!, tool2);
    expect(msg.parts).toHaveLength(4);
    
    // Text 3
    msg = handleTextDelta(msg, "Third");
    expect(msg.parts).toHaveLength(5);
    
    // Verify 3 separate TextParts
    const textParts = msg.parts!.filter(p => p.type === "text") as TextPart[];
    expect(textParts).toHaveLength(3);
    expect(textParts[0]!.content).toBe("First");
    expect(textParts[0]!.isStreaming).toBe(false);
    expect(textParts[1]!.content).toBe("Second");
    expect(textParts[1]!.isStreaming).toBe(false);
    expect(textParts[2]!.content).toBe("Third");
    expect(textParts[2]!.isStreaming).toBe(true);
  });

  test("empty text before tool doesn't create empty TextPart", () => {
    // Simulate tool.start without prior text
    let msg = createMockMessage();
    
    // Tool starts immediately (no text before)
    const toolPart = createToolPart("tool_123", "bash");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // Verify no empty TextPart was created
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.type).toBe("tool");
    
    // Stream text after tool
    msg = handleTextDelta(msg, "After tool");
    
    // Verify only one TextPart exists (after tool)
    expect(msg.parts).toHaveLength(2);
    const textParts = msg.parts!.filter(p => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect((textParts[0] as TextPart).content).toBe("After tool");
  });

  test("tool part preserves order between text parts", () => {
    // Simulate: text1 → tool → text2
    let msg = createMockMessage();
    
    // Text 1
    msg = handleTextDelta(msg, "Before");
    
    // Tool
    msg = finalizeLastTextPart(msg);
    const toolPart = createToolPart("tool_123", "bash");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // Text 2
    msg = handleTextDelta(msg, "After");
    
    // Verify order: [TextPart, ToolPart, TextPart]
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");
    
    // Verify content
    expect((msg.parts![0] as TextPart).content).toBe("Before");
    expect((msg.parts![1] as ToolPart).toolCallId).toBe("tool_123");
    expect((msg.parts![2] as TextPart).content).toBe("After");
  });

  test("streaming text accumulates in same TextPart", () => {
    // Simulate multiple deltas without tool interruption
    let msg = createMockMessage();
    
    // Stream multiple chunks
    msg = handleTextDelta(msg, "Hello");
    msg = handleTextDelta(msg, " ");
    msg = handleTextDelta(msg, "world");
    msg = handleTextDelta(msg, "!");
    
    // Verify single TextPart with accumulated content
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.type).toBe("text");
    const textPart = msg.parts![0] as TextPart;
    expect(textPart.content).toBe("Hello world!");
    expect(textPart.isStreaming).toBe(true);
  });

  test("multiple consecutive tools without text between", () => {
    // Edge case: tool1 → tool2 → tool3 (no text between)
    let msg = createMockMessage();
    
    // Tool 1
    const tool1 = createToolPart("tool_1", "bash");
    msg.parts = upsertPart(msg.parts!, tool1);
    
    // Tool 2
    const tool2 = createToolPart("tool_2", "view");
    msg.parts = upsertPart(msg.parts!, tool2);
    
    // Tool 3
    const tool3 = createToolPart("tool_3", "edit");
    msg.parts = upsertPart(msg.parts!, tool3);
    
    // Verify 3 ToolParts, no TextParts
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts!.every(p => p.type === "tool")).toBe(true);
    const textParts = msg.parts!.filter(p => p.type === "text");
    expect(textParts).toHaveLength(0);
  });

  test("text finalization preserves content", () => {
    // Verify that finalizing a TextPart doesn't alter its content
    let msg = createMockMessage();
    
    // Stream some text
    msg = handleTextDelta(msg, "Test content 12345!@#$%");
    const originalContent = (msg.parts![0] as TextPart).content;
    
    // Finalize
    msg = finalizeLastTextPart(msg);
    const finalizedContent = (msg.parts![0] as TextPart).content;
    
    // Verify content is identical
    expect(finalizedContent).toBe(originalContent);
    expect(finalizedContent).toBe("Test content 12345!@#$%");
  });

  test("finalized TextPart cannot be streamed to", () => {
    // Verify that once finalized, new deltas create a new TextPart
    let msg = createMockMessage();
    
    // Stream and finalize
    msg = handleTextDelta(msg, "First part");
    msg = finalizeLastTextPart(msg);
    
    const firstPartId = msg.parts![0]!.id;
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    
    // Try to stream more text
    msg = handleTextDelta(msg, " Second part");
    
    // Verify a new TextPart was created
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts![0]!.id).toBe(firstPartId); // Original part unchanged
    expect((msg.parts![0] as TextPart).content).toBe("First part");
    expect((msg.parts![1] as TextPart).content).toBe(" Second part");
  });

  test("empty string delta adds to streaming TextPart", () => {
    // Edge case: empty delta should still append (even if no-op)
    let msg = createMockMessage();
    
    msg = handleTextDelta(msg, "Hello");
    msg = handleTextDelta(msg, "");
    msg = handleTextDelta(msg, " World");
    
    // Verify single TextPart (empty delta didn't split)
    expect(msg.parts).toHaveLength(1);
    expect((msg.parts![0] as TextPart).content).toBe("Hello World");
  });
});
