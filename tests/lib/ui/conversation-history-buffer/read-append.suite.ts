import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendToHistoryBuffer,
  readHistoryBuffer,
} from "@/lib/ui/conversation-history-buffer.ts";
import {
  cleanupConversationHistoryBuffer,
  makeChatMessage,
  makeChatMessages,
  resetConversationHistoryBuffer,
  writeBufferContents,
} from "./support.ts";

describe("conversation-history-buffer", () => {
  beforeEach(() => {
    resetConversationHistoryBuffer();
  });

  afterEach(() => {
    cleanupConversationHistoryBuffer();
  });

  describe("readHistoryBuffer", () => {
    test("returns empty array when no buffer file exists", async () => {
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("returns empty array when buffer file is empty", async () => {
      writeBufferContents("");
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("returns empty array when buffer file contains invalid JSON", async () => {
      writeBufferContents("not json");
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("parses non-array JSON as single NDJSON line", async () => {
      writeBufferContents(`${JSON.stringify({ not: "array" })}\n`);
      const result = await readHistoryBuffer();
      expect(result).toHaveLength(1);
    });

    test("reads legacy JSON array format via migration detection", async () => {
      writeBufferContents(JSON.stringify(makeChatMessages(3)));
      const result = await readHistoryBuffer();
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe("m1");
    });
  });

  describe("appendToHistoryBuffer", () => {
    test("appends messages to empty buffer", async () => {
      const count = appendToHistoryBuffer(makeChatMessages(3));

      expect(count).toBe(3);
      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(3);
      expect(stored[0]?.id).toBe("m1");
      expect(stored[2]?.id).toBe("m3");
    });

    test("returns 0 for empty input array", async () => {
      expect(appendToHistoryBuffer([])).toBe(0);
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("deduplicates messages by id", async () => {
      const batch = makeChatMessages(3);
      appendToHistoryBuffer(batch);

      expect(appendToHistoryBuffer(batch)).toBe(0);
      expect(await readHistoryBuffer()).toHaveLength(3);
    });

    test("deduplicates against pre-existing on-disk messages before first append", async () => {
      writeBufferContents(`${JSON.stringify(makeChatMessage("m1"))}\n`);

      const count = appendToHistoryBuffer([
        makeChatMessage("m1"),
        makeChatMessage("m2"),
      ]);

      expect(count).toBe(1);
      const stored = await readHistoryBuffer();
      expect(stored.map((m) => m.id)).toEqual(["m1", "m2"]);
    });

    test("appends only new messages when mixed with existing ids", async () => {
      appendToHistoryBuffer(makeChatMessages(3));

      const count = appendToHistoryBuffer([
        makeChatMessage("m2"),
        makeChatMessage("m4"),
        makeChatMessage("m5"),
      ]);

      expect(count).toBe(2);
      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(5);
      expect(stored.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    });

    test("preserves message order across multiple appends", async () => {
      appendToHistoryBuffer(makeChatMessages(2, "a"));
      appendToHistoryBuffer(makeChatMessages(2, "b"));
      appendToHistoryBuffer(makeChatMessages(2, "c"));

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(6);
      expect(stored.map((m) => m.id)).toEqual([
        "a1",
        "a2",
        "b1",
        "b2",
        "c1",
        "c2",
      ]);
    });
  });
});
