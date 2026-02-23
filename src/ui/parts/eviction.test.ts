/**
 * Message Eviction with Parts Model Tests
 *
 * These tests verify that the parts model works correctly when messages
 * are cleared via compaction or clear.
 * Tests focus on data model resilience, not React component lifecycle.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createPartId, _resetPartCounter } from "./id.ts";
import type { Part, TextPart, ToolPart } from "./types.ts";

describe("Message eviction with parts model", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  test("parts survive message object identity change", () => {
    // Simulate message with parts
    const parts: Part[] = [
      {
        id: createPartId(),
        type: "text",
        content: "hello",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      } as TextPart,
    ];
    const msg = { parts };

    // Create shallow copy (simulating message eviction/remount)
    const copy = { ...msg, parts: [...msg.parts] };

    // Verify parts are accessible on copy
    expect(copy.parts).toHaveLength(1);
    expect(copy.parts[0]).toBeDefined();
    expect(copy.parts[0]!.type).toBe("text");
    expect((copy.parts[0] as TextPart).content).toBe("hello");
  });

  test("parts are serializable", () => {
    // Create message with various part types
    const parts: Part[] = [
      {
        id: createPartId(),
        type: "text",
        content: "hello world",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      } as TextPart,
      {
        id: createPartId(),
        type: "tool",
        toolCallId: "call_123",
        toolName: "bash",
        input: { command: "echo test" },
        output: "test",
        state: { status: "completed", output: "test", durationMs: 100 },
        createdAt: new Date().toISOString(),
      } as ToolPart,
    ];

    // Serialize and deserialize
    const serialized = JSON.stringify(parts);
    const deserialized = JSON.parse(serialized) as Part[];

    // Verify structure is preserved
    expect(deserialized).toHaveLength(2);
    expect(deserialized[0]).toBeDefined();
    expect(deserialized[0]!.type).toBe("text");
    expect((deserialized[0] as TextPart).content).toBe("hello world");
    expect(deserialized[1]).toBeDefined();
    expect(deserialized[1]!.type).toBe("tool");
    expect((deserialized[1] as ToolPart).toolName).toBe("bash");
    expect((deserialized[1] as ToolPart).state.status).toBe("completed");
  });

  test("large parts array handles eviction", () => {
    // Create message with 100+ parts
    const parts: Part[] = Array.from({ length: 150 }, (_, i) => ({
      id: createPartId(),
      type: "text",
      content: `part ${i}`,
      isStreaming: false,
      createdAt: new Date().toISOString(),
    } as TextPart));

    const msg = { parts };

    // Verify all parts are accessible
    expect(msg.parts).toHaveLength(150);

    // Verify each part has correct content
    msg.parts.forEach((part, index) => {
      expect(part.type).toBe("text");
      expect((part as TextPart).content).toBe(`part ${index}`);
    });

    // Simulate eviction by creating copy
    const copy = { ...msg, parts: [...msg.parts] };
    expect(copy.parts).toHaveLength(150);
    expect((copy.parts[149] as TextPart).content).toBe("part 149");
  });

  test("parts maintain order after message copy", () => {
    // Create message with parts in specific order
    const parts: Part[] = [
      {
        id: createPartId(),
        type: "text",
        content: "first",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      } as TextPart,
      {
        id: createPartId(),
        type: "tool",
        toolCallId: "call_1",
        toolName: "bash",
        input: {},
        state: { status: "pending" },
        createdAt: new Date().toISOString(),
      } as ToolPart,
      {
        id: createPartId(),
        type: "text",
        content: "second",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      } as TextPart,
      {
        id: createPartId(),
        type: "tool",
        toolCallId: "call_2",
        toolName: "edit",
        input: {},
        state: { status: "pending" },
        createdAt: new Date().toISOString(),
      } as ToolPart,
      {
        id: createPartId(),
        type: "text",
        content: "third",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      } as TextPart,
    ];

    const msg = { parts };

    // Copy message (simulating eviction)
    const copy = { ...msg, parts: [...msg.parts] };

    // Verify order is preserved
    expect(copy.parts).toHaveLength(5);
    expect((copy.parts[0] as TextPart).content).toBe("first");
    expect((copy.parts[1] as ToolPart).toolCallId).toBe("call_1");
    expect((copy.parts[2] as TextPart).content).toBe("second");
    expect((copy.parts[3] as ToolPart).toolCallId).toBe("call_2");
    expect((copy.parts[4] as TextPart).content).toBe("third");
  });

  test("empty parts array after eviction", () => {
    // Message with no parts (undefined)
    const msgUndefined = {} as { parts?: Part[] };
    expect(msgUndefined.parts).toBeUndefined();

    // Message with empty parts array
    const msgEmpty = { parts: [] as Part[] };
    expect(msgEmpty.parts).toHaveLength(0);

    // Copy both messages
    const copyUndefined = { ...msgUndefined };
    const copyEmpty = { ...msgEmpty, parts: [...msgEmpty.parts] };

    // Verify graceful handling
    expect(copyUndefined.parts).toBeUndefined();
    expect(copyEmpty.parts).toHaveLength(0);

    // Verify operations on empty arrays don't crash
    const filtered = copyEmpty.parts.filter((p) => p.type === "text");
    expect(filtered).toHaveLength(0);
  });

  test("parts array is not shared reference across messages", () => {
    // Create original message with parts
    const originalParts: Part[] = [
      {
        id: createPartId(),
        type: "text",
        content: "original",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      } as TextPart,
    ];
    const original = { parts: originalParts };

    // Create copy and modify its parts
    const copy = { ...original, parts: [...original.parts] };
    copy.parts.push({
      id: createPartId(),
      type: "text",
      content: "added to copy",
      isStreaming: false,
      createdAt: new Date().toISOString(),
    } as TextPart);

    // Verify original is unchanged
    expect(original.parts).toHaveLength(1);
    expect((original.parts[0] as TextPart).content).toBe("original");

    // Verify copy has the new part
    expect(copy.parts).toHaveLength(2);
    expect((copy.parts[1] as TextPart).content).toBe("added to copy");

    // Modify content of part in copy (note: this modifies the part object itself)
    const copyPart = copy.parts[0] as TextPart;
    const originalPart = original.parts[0] as TextPart;

    // Since we're spreading the array but not the objects inside,
    // both reference the same part objects
    expect(copyPart).toBe(originalPart);

    // To truly isolate, we need deep copy
    const deepCopy = {
      ...original,
      parts: original.parts.map((p) => ({ ...p })),
    };
    (deepCopy.parts[0] as TextPart).content = "modified";

    // Now original should be unchanged
    expect((original.parts[0] as TextPart).content).toBe("original");
    expect((deepCopy.parts[0] as TextPart).content).toBe("modified");
  });
});
