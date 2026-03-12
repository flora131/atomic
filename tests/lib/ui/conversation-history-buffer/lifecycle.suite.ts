import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendCompactionSummary,
  appendToHistoryBuffer,
  clearHistoryBuffer,
  readHistoryBuffer,
  replaceHistoryBuffer,
} from "@/lib/ui/conversation-history-buffer.ts";
import {
  cleanupConversationHistoryBuffer,
  makeChatMessages,
  resetConversationHistoryBuffer,
} from "./support.ts";

describe("conversation-history-buffer", () => {
  beforeEach(() => {
    resetConversationHistoryBuffer();
  });

  afterEach(() => {
    cleanupConversationHistoryBuffer();
  });

  describe("replace, clear, and compaction", () => {
    test("replaces buffer with new messages", async () => {
      appendToHistoryBuffer(makeChatMessages(5));
      replaceHistoryBuffer(makeChatMessages(2, "r"));

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(2);
      expect(stored[0]?.id).toBe("r1");
      expect(stored[1]?.id).toBe("r2");
    });

    test("replaces buffer with empty array", async () => {
      appendToHistoryBuffer(makeChatMessages(5));
      replaceHistoryBuffer([]);
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("clears all messages from buffer", async () => {
      appendToHistoryBuffer(makeChatMessages(10));
      clearHistoryBuffer();
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("clear is a no-op when buffer is already empty", async () => {
      clearHistoryBuffer();
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("adds a compaction summary marker to buffer", async () => {
      appendCompactionSummary("Compacted: user asked about windowing");

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.role).toBe("assistant");
      expect(stored[0]?.content).toBe("Compacted: user asked about windowing");
      expect(stored[0]?.id).toMatch(/^compact_/);
    });

    test("clears existing messages then appends summary only", async () => {
      appendToHistoryBuffer(makeChatMessages(3));
      appendCompactionSummary("Summary of previous context");

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.content).toBe("Summary of previous context");
      expect(stored[0]?.role).toBe("assistant");
    });
  });

  describe("buffer lifecycle contracts", () => {
    test("/clear resets buffer state", async () => {
      appendToHistoryBuffer(makeChatMessages(30));
      clearHistoryBuffer();
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("/compact replaces buffer with compaction summary only", async () => {
      appendToHistoryBuffer(makeChatMessages(30));
      appendCompactionSummary("Previous context: user discussed testing strategies");

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.role).toBe("assistant");
      expect(stored[0]?.content).toBe(
        "Previous context: user discussed testing strategies",
      );
    });

    test("/clear → new session lifecycle: populate, clear, repopulate, verify clean state", async () => {
      appendToHistoryBuffer(makeChatMessages(30, "old"));
      expect(await readHistoryBuffer()).toHaveLength(30);

      clearHistoryBuffer();
      expect(await readHistoryBuffer()).toEqual([]);

      appendToHistoryBuffer(makeChatMessages(20, "new"));

      const history = await readHistoryBuffer();
      expect(history).toHaveLength(20);
      expect(history[0]?.id).toBe("new1");
      expect(history[19]?.id).toBe("new20");
      expect(history.map((m) => m.id).some((id) => id.startsWith("old"))).toBe(false);
    });

    test("/compact → continued session lifecycle: populate, compact, continue, verify", async () => {
      appendToHistoryBuffer(makeChatMessages(30));
      expect(await readHistoryBuffer()).toHaveLength(30);

      appendCompactionSummary("Summary of 30-message session");

      const afterCompact = await readHistoryBuffer();
      expect(afterCompact).toHaveLength(1);
      expect(afterCompact[0]?.role).toBe("assistant");
      expect(afterCompact[0]?.content).toBe("Summary of 30-message session");
      expect(afterCompact[0]?.id).toMatch(/^compact_/);

      appendToHistoryBuffer(makeChatMessages(15, "cont"));

      const bufferAfterContinue = await readHistoryBuffer();
      expect(bufferAfterContinue).toHaveLength(16);
      expect(bufferAfterContinue[0]?.content).toBe("Summary of 30-message session");
      expect(bufferAfterContinue[1]?.id).toBe("cont1");
      expect(bufferAfterContinue[15]?.id).toBe("cont15");
    });

    test("/compact → more messages → verify buffer integrity", async () => {
      appendToHistoryBuffer(makeChatMessages(50, "m"));
      appendCompactionSummary("Summary of long session");

      const afterCompact = await readHistoryBuffer();
      expect(afterCompact).toHaveLength(1);
      expect(afterCompact[0]?.id).toMatch(/^compact_/);
      expect(afterCompact[0]?.role).toBe("assistant");
      expect(afterCompact[0]?.content).toBe("Summary of long session");

      appendToHistoryBuffer(makeChatMessages(10, "post"));

      const finalBuffer = await readHistoryBuffer();
      expect(finalBuffer).toHaveLength(11);
      expect(finalBuffer[0]?.id).toMatch(/^compact_/);
      expect(finalBuffer[0]?.content).toBe("Summary of long session");

      for (let i = 1; i <= 10; i += 1) {
        expect(finalBuffer[i]?.id).toBe(`post${i}`);
      }
    });
  });

  describe("/clear and /compact postcondition contracts", () => {
    test("after clear, new messages can be appended and old data does not leak", async () => {
      appendToHistoryBuffer(makeChatMessages(5, "old"));
      clearHistoryBuffer();

      expect(appendToHistoryBuffer(makeChatMessages(3, "new"))).toBe(3);
      const stored = await readHistoryBuffer();

      expect(stored).toHaveLength(3);
      expect(stored.map((m) => m.id)).toEqual(["new1", "new2", "new3"]);
      expect(stored.some((m) => m.id.startsWith("old"))).toBe(false);
    });

    test("after compact, buffer contains summary marker and new evictions append after it", async () => {
      appendCompactionSummary("Previous context summary");
      expect(await readHistoryBuffer()).toHaveLength(1);

      expect(appendToHistoryBuffer(makeChatMessages(5, "evict"))).toBe(5);
      const stored = await readHistoryBuffer();

      expect(stored).toHaveLength(6);
      expect(stored[0]!.id).toMatch(/^compact_/);
      expect(stored[0]!.content).toBe("Previous context summary");
      expect(stored.slice(1).map((m) => m.id)).toEqual([
        "evict1",
        "evict2",
        "evict3",
        "evict4",
        "evict5",
      ]);
    });

    test("compaction summary marker survives a read-write-read cycle", async () => {
      appendCompactionSummary("Survived summary");
      const afterSummary = await readHistoryBuffer();
      expect(afterSummary).toHaveLength(1);
      expect(afterSummary[0]!.content).toBe("Survived summary");
      expect(afterSummary[0]!.id).toMatch(/^compact_/);

      appendToHistoryBuffer(makeChatMessages(3, "post"));
      const afterAppend = await readHistoryBuffer();
      expect(afterAppend).toHaveLength(4);
      expect(afterAppend[0]!.id).toMatch(/^compact_/);
      expect(afterAppend[0]!.content).toBe("Survived summary");
      expect(afterAppend.slice(1).map((m) => m.id)).toEqual(["post1", "post2", "post3"]);

      const finalRead = await readHistoryBuffer();
      expect(finalRead).toHaveLength(4);
      expect(finalRead[0]!.id).toMatch(/^compact_/);
      expect(finalRead[0]!.content).toBe("Survived summary");
      expect(finalRead.slice(1).map((m) => m.id)).toEqual(["post1", "post2", "post3"]);
    });
  });
});
