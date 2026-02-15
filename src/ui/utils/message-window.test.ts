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
});
