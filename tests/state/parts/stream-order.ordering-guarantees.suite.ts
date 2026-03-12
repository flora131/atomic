import { beforeEach, describe, expect, test } from "bun:test";
import {
  addHitlQuestion,
  createMockMessage,
  createReasoningPart,
  createTextPart,
  createToolPart,
  resetStreamOrderState,
  resolveHitlQuestion,
  type ReasoningPart,
  type ToolPart,
  upsertPart,
  verifyMonotonicIds,
} from "./stream-order.test-support.ts";

describe("Stream render order guarantees", () => {
  beforeEach(() => {
    resetStreamOrderState();
  });

  test("parts maintain chronological order via IDs", () => {
    let msg = createMockMessage();

    msg.parts = upsertPart(msg.parts!, createTextPart("First", false));
    msg.parts = upsertPart(msg.parts!, createReasoningPart("Second", false));
    msg.parts = upsertPart(msg.parts!, createToolPart("tool_1", "bash", "running"));
    msg.parts = upsertPart(msg.parts!, createTextPart("Fourth", false));
    msg.parts = upsertPart(msg.parts!, createToolPart("tool_2", "view", "completed"));

    expect(msg.parts).toHaveLength(5);
    verifyMonotonicIds(msg.parts!);

    for (let index = 1; index < msg.parts!.length; index += 1) {
      const prevPart = msg.parts![index - 1]!;
      const currPart = msg.parts![index]!;

      expect(currPart.id > prevPart.id).toBe(true);
      expect(prevPart.id).toMatch(/^part_[0-9a-f]{12}_[0-9a-f]{4}$/);
      expect(currPart.id).toMatch(/^part_[0-9a-f]{12}_[0-9a-f]{4}$/);
    }
  });

  test("empty stream produces no parts", () => {
    expect(createMockMessage().parts).toHaveLength(0);
  });

  test("consecutive reasoning parts maintain order", () => {
    let msg = createMockMessage();

    msg.parts = upsertPart(msg.parts!, createReasoningPart("First thought", false));
    msg.parts = upsertPart(msg.parts!, createReasoningPart("Second thought", false));
    msg.parts = upsertPart(msg.parts!, createReasoningPart("Third thought", false));

    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![0]!.type).toBe("reasoning");
    expect(msg.parts![1]!.type).toBe("reasoning");
    expect(msg.parts![2]!.type).toBe("reasoning");
    expect((msg.parts![0] as ReasoningPart).content).toBe("First thought");
    expect((msg.parts![1] as ReasoningPart).content).toBe("Second thought");
    expect((msg.parts![2] as ReasoningPart).content).toBe("Third thought");
    verifyMonotonicIds(msg.parts!);
  });

  test("HITL updates preserve tool order", () => {
    let msg = createMockMessage();
    let toolPart = createToolPart("tool_1", "read_file", "running");
    msg.parts = upsertPart(msg.parts!, toolPart);

    const originalId = toolPart.id;

    toolPart = addHitlQuestion(toolPart, "req_1");
    msg.parts = upsertPart(msg.parts!, toolPart);

    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.id).toBe(originalId);
    expect((msg.parts![0] as ToolPart).pendingQuestion).toBeDefined();

    toolPart = resolveHitlQuestion(toolPart, "allow");
    msg.parts = upsertPart(msg.parts!, toolPart);

    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.id).toBe(originalId);
    expect((msg.parts![0] as ToolPart).pendingQuestion).toBeUndefined();
    expect((msg.parts![0] as ToolPart).hitlResponse).toBeDefined();
  });
});
