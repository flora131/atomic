import { describe, expect, test } from "bun:test";
import { applyMessageWindow, computeMessageWindow } from "./message-window.ts";

function makeMessages(count: number): Array<{ id: string }> {
  return Array.from({ length: count }, (_, i) => ({ id: `m${i + 1}` }));
}

describe("message-window", () => {
  test("computeMessageWindow returns only the last 50 visible messages with correct hidden count", () => {
    const messages = makeMessages(120);
    const result = computeMessageWindow(messages, 0, 50);

    expect(result.visibleMessages).toHaveLength(50);
    expect(result.visibleMessages[0]?.id).toBe("m71");
    expect(result.visibleMessages[49]?.id).toBe("m120");
    expect(result.hiddenMessageCount).toBe(70);
  });

  test("computeMessageWindow includes previously trimmed count even without in-memory overflow", () => {
    const messages = makeMessages(40);
    const result = computeMessageWindow(messages, 12, 50);

    expect(result.visibleMessages).toHaveLength(40);
    expect(result.hiddenMessageCount).toBe(12);
  });

  test("applyMessageWindow evicts oldest messages when above limit", () => {
    const messages = makeMessages(120);
    const result = applyMessageWindow(messages, 50);

    expect(result.evictedCount).toBe(70);
    expect(result.evictedMessages).toHaveLength(70);
    expect(result.evictedMessages[0]?.id).toBe("m1");
    expect(result.evictedMessages[69]?.id).toBe("m70");
    expect(result.inMemoryMessages).toHaveLength(50);
    expect(result.inMemoryMessages[0]?.id).toBe("m71");
    expect(result.inMemoryMessages[49]?.id).toBe("m120");
  });

  test("long append sequence stays bounded at 50 messages (ralph-like streaming)", () => {
    let inMemory: Array<{ id: string }> = [];
    let trimmedCount = 0;

    for (let i = 1; i <= 200; i++) {
      inMemory = [...inMemory, { id: `m${i}` }];
      const applied = applyMessageWindow(inMemory, 50);
      inMemory = applied.inMemoryMessages;
      trimmedCount += applied.evictedCount;
    }

    const computed = computeMessageWindow(inMemory, trimmedCount, 50);
    expect(inMemory).toHaveLength(50);
    expect(inMemory[0]?.id).toBe("m151");
    expect(inMemory[49]?.id).toBe("m200");
    expect(computed.visibleMessages).toHaveLength(50);
    expect(computed.hiddenMessageCount).toBe(150);
  });

  // --- Edge-case tests for computeMessageWindow ---

  test("computeMessageWindow with 0 messages and 0 trimmed returns empty", () => {
    const result = computeMessageWindow([], 0, 50);

    expect(result.visibleMessages).toHaveLength(0);
    expect(result.hiddenMessageCount).toBe(0);
  });

  test("computeMessageWindow with exactly 50 messages (at limit) returns all visible", () => {
    const messages = makeMessages(50);
    const result = computeMessageWindow(messages, 0, 50);

    expect(result.visibleMessages).toHaveLength(50);
    expect(result.visibleMessages[0]?.id).toBe("m1");
    expect(result.visibleMessages[49]?.id).toBe("m50");
    expect(result.hiddenMessageCount).toBe(0);
  });

  test("computeMessageWindow with 51 messages (1 over limit) hides 1", () => {
    const messages = makeMessages(51);
    const result = computeMessageWindow(messages, 0, 50);

    expect(result.visibleMessages).toHaveLength(50);
    expect(result.visibleMessages[0]?.id).toBe("m2");
    expect(result.visibleMessages[49]?.id).toBe("m51");
    expect(result.hiddenMessageCount).toBe(1);
  });

  test("computeMessageWindow with 0 messages but nonzero trimmedCount reports hidden count", () => {
    const result = computeMessageWindow([], 25, 50);

    expect(result.visibleMessages).toHaveLength(0);
    expect(result.hiddenMessageCount).toBe(25);
  });

  test("computeMessageWindow with maxVisible=1 returns only the last message", () => {
    const messages = makeMessages(10);
    const result = computeMessageWindow(messages, 0, 1);

    expect(result.visibleMessages).toHaveLength(1);
    expect(result.visibleMessages[0]?.id).toBe("m10");
    expect(result.hiddenMessageCount).toBe(9);
  });

  // --- Edge-case tests for applyMessageWindow ---

  test("applyMessageWindow with 0 messages returns empty arrays", () => {
    const result = applyMessageWindow([], 50);

    expect(result.inMemoryMessages).toHaveLength(0);
    expect(result.evictedMessages).toHaveLength(0);
    expect(result.evictedCount).toBe(0);
  });

  test("applyMessageWindow with exactly 50 messages (at limit) evicts nothing", () => {
    const messages = makeMessages(50);
    const result = applyMessageWindow(messages, 50);

    expect(result.inMemoryMessages).toHaveLength(50);
    expect(result.inMemoryMessages[0]?.id).toBe("m1");
    expect(result.inMemoryMessages[49]?.id).toBe("m50");
    expect(result.evictedMessages).toHaveLength(0);
    expect(result.evictedCount).toBe(0);
  });

  test("applyMessageWindow with 51 messages (1 over) evicts exactly 1", () => {
    const messages = makeMessages(51);
    const result = applyMessageWindow(messages, 50);

    expect(result.evictedCount).toBe(1);
    expect(result.evictedMessages).toHaveLength(1);
    expect(result.evictedMessages[0]?.id).toBe("m1");
    expect(result.inMemoryMessages).toHaveLength(50);
    expect(result.inMemoryMessages[0]?.id).toBe("m2");
    expect(result.inMemoryMessages[49]?.id).toBe("m51");
  });

  test("applyMessageWindow with maxVisible=0 evicts all messages", () => {
    const messages = makeMessages(5);
    const result = applyMessageWindow(messages, 0);

    expect(result.evictedCount).toBe(5);
    expect(result.evictedMessages).toHaveLength(5);
    expect(result.evictedMessages[0]?.id).toBe("m1");
    expect(result.evictedMessages[4]?.id).toBe("m5");
    expect(result.inMemoryMessages).toHaveLength(0);
  });

  test("applyMessageWindow with single message and maxVisible=1 evicts nothing", () => {
    const messages = makeMessages(1);
    const result = applyMessageWindow(messages, 1);

    expect(result.inMemoryMessages).toHaveLength(1);
    expect(result.inMemoryMessages[0]?.id).toBe("m1");
    expect(result.evictedMessages).toHaveLength(0);
    expect(result.evictedCount).toBe(0);
  });

  test("applyMessageWindow with 200 messages and maxVisible=50 evicts 150", () => {
    const messages = makeMessages(200);
    const result = applyMessageWindow(messages, 50);

    expect(result.evictedCount).toBe(150);
    expect(result.evictedMessages).toHaveLength(150);
    expect(result.evictedMessages[0]?.id).toBe("m1");
    expect(result.evictedMessages[149]?.id).toBe("m150");
    expect(result.inMemoryMessages).toHaveLength(50);
    expect(result.inMemoryMessages[0]?.id).toBe("m151");
    expect(result.inMemoryMessages[49]?.id).toBe("m200");
  });
});
