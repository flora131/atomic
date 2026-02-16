import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChatMessage } from "../chat.tsx";

/**
 * The history buffer module derives its file path from process.pid, so we
 * can safely re-import between tests. We dynamically import to ensure each
 * test suite gets fresh module state.
 */
import {
  appendToHistoryBuffer,
  replaceHistoryBuffer,
  appendCompactionSummary,
  readHistoryBuffer,
  clearHistoryBuffer,
} from "./conversation-history-buffer.ts";

const BUFFER_DIR = join(tmpdir(), "atomic-cli");
const BUFFER_FILE = join(BUFFER_DIR, `history-${process.pid}.json`);

function makeChatMessage(id: string, role: "user" | "assistant" = "user", content = `msg ${id}`): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

function makeChatMessages(count: number, prefix = "m"): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => makeChatMessage(`${prefix}${i + 1}`));
}

describe("conversation-history-buffer", () => {
  beforeEach(() => {
    // Ensure clean state before each test
    try {
      if (existsSync(BUFFER_FILE)) unlinkSync(BUFFER_FILE);
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    // Clean up after each test
    try {
      if (existsSync(BUFFER_FILE)) unlinkSync(BUFFER_FILE);
    } catch {
      // ignore
    }
  });

  describe("readHistoryBuffer", () => {
    test("returns empty array when no buffer file exists", () => {
      const result = readHistoryBuffer();
      expect(result).toEqual([]);
    });

    test("returns empty array when buffer file is empty", () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, "", "utf-8");
      const result = readHistoryBuffer();
      expect(result).toEqual([]);
    });

    test("returns empty array when buffer file contains invalid JSON", () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, "not json", "utf-8");
      const result = readHistoryBuffer();
      expect(result).toEqual([]);
    });

    test("returns empty array when buffer file contains non-array JSON", () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, JSON.stringify({ not: "array" }), "utf-8");
      const result = readHistoryBuffer();
      expect(result).toEqual([]);
    });
  });

  describe("appendToHistoryBuffer", () => {
    test("appends messages to empty buffer", () => {
      const messages = makeChatMessages(3);
      const count = appendToHistoryBuffer(messages);

      expect(count).toBe(3);
      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(3);
      expect(stored[0]?.id).toBe("m1");
      expect(stored[2]?.id).toBe("m3");
    });

    test("returns 0 for empty input array", () => {
      const count = appendToHistoryBuffer([]);
      expect(count).toBe(0);
      expect(readHistoryBuffer()).toEqual([]);
    });

    test("deduplicates messages by id", () => {
      const batch1 = makeChatMessages(3);
      appendToHistoryBuffer(batch1);

      // Append again with same ids
      const count = appendToHistoryBuffer(batch1);
      expect(count).toBe(0);

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(3);
    });

    test("appends only new messages when mixed with existing ids", () => {
      appendToHistoryBuffer(makeChatMessages(3));

      const mixed = [makeChatMessage("m2"), makeChatMessage("m4"), makeChatMessage("m5")];
      const count = appendToHistoryBuffer(mixed);

      expect(count).toBe(2);
      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(5);
      expect(stored.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    });

    test("preserves message order across multiple appends", () => {
      appendToHistoryBuffer(makeChatMessages(2, "a"));
      appendToHistoryBuffer(makeChatMessages(2, "b"));
      appendToHistoryBuffer(makeChatMessages(2, "c"));

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(6);
      expect(stored.map((m) => m.id)).toEqual(["a1", "a2", "b1", "b2", "c1", "c2"]);
    });
  });

  describe("replaceHistoryBuffer", () => {
    test("replaces buffer with new messages", () => {
      appendToHistoryBuffer(makeChatMessages(5));
      const replacement = makeChatMessages(2, "r");
      replaceHistoryBuffer(replacement);

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(2);
      expect(stored[0]?.id).toBe("r1");
      expect(stored[1]?.id).toBe("r2");
    });

    test("replaces buffer with empty array", () => {
      appendToHistoryBuffer(makeChatMessages(5));
      replaceHistoryBuffer([]);

      const stored = readHistoryBuffer();
      expect(stored).toEqual([]);
    });
  });

  describe("clearHistoryBuffer", () => {
    test("clears all messages from buffer", () => {
      appendToHistoryBuffer(makeChatMessages(10));
      clearHistoryBuffer();

      const stored = readHistoryBuffer();
      expect(stored).toEqual([]);
    });

    test("no-op when buffer is already empty", () => {
      clearHistoryBuffer();
      const stored = readHistoryBuffer();
      expect(stored).toEqual([]);
    });
  });

  describe("appendCompactionSummary", () => {
    test("adds a compaction summary marker to buffer", () => {
      appendCompactionSummary("Compacted: user asked about windowing");

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.role).toBe("assistant");
      expect(stored[0]?.content).toBe("Compacted: user asked about windowing");
      expect(stored[0]?.id).toMatch(/^compact_/);
    });

    test("appends summary after existing messages", () => {
      appendToHistoryBuffer(makeChatMessages(3));
      appendCompactionSummary("Summary of previous context");

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(4);
      expect(stored[3]?.content).toBe("Summary of previous context");
    });
  });

  describe("windowing + history buffer parity contract", () => {
    /**
     * Simulates the full lifecycle: messages arrive, windowing caps in-memory,
     * evicted messages go to history buffer, and full transcript is recoverable.
     */
    test("evicted messages persist to buffer and full transcript is recoverable", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      let inMemory: ChatMessage[] = [];
      let trimmedCount = 0;

      // Simulate 80 messages arriving
      for (let i = 1; i <= 80; i++) {
        inMemory = [...inMemory, makeChatMessage(`m${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
          trimmedCount += applied.evictedCount;
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      // In-memory should be bounded
      expect(inMemory).toHaveLength(50);
      expect(inMemory[0]?.id).toBe("m31");
      expect(inMemory[49]?.id).toBe("m80");

      // History buffer has evicted messages
      const history = readHistoryBuffer();
      expect(history).toHaveLength(30);
      expect(history[0]?.id).toBe("m1");
      expect(history[29]?.id).toBe("m30");

      // Full transcript: history + in-memory = complete ordered conversation
      const fullTranscript = [...history, ...inMemory];
      expect(fullTranscript).toHaveLength(80);
      for (let i = 0; i < 80; i++) {
        expect(fullTranscript[i]?.id).toBe(`m${i + 1}`);
      }
      expect(trimmedCount).toBe(30);
    });

    test("/clear resets both in-memory and buffer state", () => {
      // Setup: populate buffer and in-memory
      appendToHistoryBuffer(makeChatMessages(30));

      // Simulate /clear: wipe everything
      clearHistoryBuffer();
      const inMemory: ChatMessage[] = [];
      const trimmedCount = 0;

      expect(readHistoryBuffer()).toEqual([]);
      expect(inMemory).toHaveLength(0);
      expect(trimmedCount).toBe(0);
    });

    test("/compact replaces buffer with compaction summary only", () => {
      // Setup: populate buffer with prior messages
      appendToHistoryBuffer(makeChatMessages(30));

      // Simulate /compact: clear buffer, add compaction summary
      replaceHistoryBuffer([]);
      appendCompactionSummary("Previous context: user discussed testing strategies");

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.role).toBe("assistant");
      expect(stored[0]?.content).toBe("Previous context: user discussed testing strategies");
    });

    test("buffer survives clear-then-repopulate cycle", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      // Phase 1: populate
      appendToHistoryBuffer(makeChatMessages(10));
      expect(readHistoryBuffer()).toHaveLength(10);

      // Phase 2: clear (simulating /clear)
      clearHistoryBuffer();
      expect(readHistoryBuffer()).toEqual([]);

      // Phase 3: new session messages with windowing
      let inMemory: ChatMessage[] = [];
      for (let i = 1; i <= 60; i++) {
        inMemory = [...inMemory, makeChatMessage(`new${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      expect(inMemory).toHaveLength(50);
      const history = readHistoryBuffer();
      expect(history).toHaveLength(10);
      expect(history[0]?.id).toBe("new1");

      const fullTranscript = [...history, ...inMemory];
      expect(fullTranscript).toHaveLength(60);
    });
  });
});
