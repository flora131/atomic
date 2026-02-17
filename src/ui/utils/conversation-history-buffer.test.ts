import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync, statSync } from "node:fs";
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
    // Reset both disk file and in-memory dedup Set before each test
    clearHistoryBuffer();
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

    test("parses non-array JSON as single NDJSON line", () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, JSON.stringify({ not: "array" }) + "\n", "utf-8");
      const result = readHistoryBuffer();
      // NDJSON parser treats single-line JSON objects as valid entries
      expect(result).toHaveLength(1);
    });

    test("reads legacy JSON array format via migration detection", () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      const messages = makeChatMessages(3);
      writeFileSync(BUFFER_FILE, JSON.stringify(messages), "utf-8");
      const result = readHistoryBuffer();
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe("m1");
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

    test("clears existing messages then appends summary only", () => {
      appendToHistoryBuffer(makeChatMessages(3));
      appendCompactionSummary("Summary of previous context");

      const stored = readHistoryBuffer();
      // appendCompactionSummary clears first, then appends the summary marker
      expect(stored).toHaveLength(1);
      expect(stored[0]?.content).toBe("Summary of previous context");
      expect(stored[0]?.role).toBe("assistant");
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

    test("truncation indicator appears after 51st message", async () => {
      const { computeMessageWindow, applyMessageWindow } = await import("./message-window.ts");

      let inMemory: ChatMessage[] = [];
      let trimmedCount = 0;

      // Simulate exactly 51 messages arriving
      for (let i = 1; i <= 51; i++) {
        inMemory = [...inMemory, makeChatMessage(`m${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
          trimmedCount += applied.evictedCount;
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      const { visibleMessages, hiddenMessageCount } = computeMessageWindow(
        inMemory,
        trimmedCount,
        50,
      );

      // Exactly 1 message should be hidden (the truncation indicator shows)
      expect(hiddenMessageCount).toBe(1);
      expect(visibleMessages).toHaveLength(50);
      expect(visibleMessages[0]?.id).toBe("m2");
      expect(visibleMessages[49]?.id).toBe("m51");

      // History buffer should have the evicted message
      const history = readHistoryBuffer();
      expect(history).toHaveLength(1);
      expect(history[0]?.id).toBe("m1");
    });

    test("Ctrl+O merged transcript combines NDJSON buffer with in-memory messages", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      let inMemory: ChatMessage[] = [];

      // Simulate 120 messages
      for (let i = 1; i <= 120; i++) {
        inMemory = [...inMemory, makeChatMessage(`m${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      // Simulate Ctrl+O: merge buffer + in-memory
      const transcript = [...readHistoryBuffer(), ...inMemory];

      // Full transcript should have all 120 messages in order
      expect(transcript).toHaveLength(120);
      for (let i = 0; i < 120; i++) {
        expect(transcript[i]?.id).toBe(`m${i + 1}`);
      }

      // Buffer should be in NDJSON format
      const { readFileSync } = await import("node:fs");
      const raw = readFileSync(
        require("node:path").join(require("node:os").tmpdir(), "atomic-cli", `history-${process.pid}.json`),
        "utf-8",
      );
      // Not a JSON array (no leading [)
      expect(raw.trimStart().startsWith("[")).toBe(false);
      // Each line is valid JSON
      const lines = raw.split("\n").filter(Boolean);
      expect(lines.length).toBe(70); // 120 - 50 = 70 evicted
    });

    test("/clear → new session lifecycle: populate, clear, repopulate, verify clean state", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      // Phase 1: Simulate 80 messages with windowing (50 in-memory, 30 evicted to buffer)
      let inMemory: ChatMessage[] = [];
      let trimmedCount = 0;

      for (let i = 1; i <= 80; i++) {
        inMemory = [...inMemory, makeChatMessage(`old${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
          trimmedCount += applied.evictedCount;
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      expect(inMemory).toHaveLength(50);
      expect(readHistoryBuffer()).toHaveLength(30);
      expect(trimmedCount).toBe(30);

      // Phase 2: Simulate /clear — wipe buffer, reset in-memory state
      clearHistoryBuffer();
      inMemory = [];
      trimmedCount = 0;

      // Verify buffer is empty, no ghost data
      expect(readHistoryBuffer()).toEqual([]);

      // Phase 3: Simulate new session — add 60 new messages with windowing
      for (let i = 1; i <= 60; i++) {
        inMemory = [...inMemory, makeChatMessage(`new${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
          trimmedCount += applied.evictedCount;
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      // Buffer has only new evictions (60 - 50 = 10 evicted)
      const history = readHistoryBuffer();
      expect(history).toHaveLength(10);
      expect(history[0]?.id).toBe("new1");
      expect(history[9]?.id).toBe("new10");

      // In-memory has the most recent 50
      expect(inMemory).toHaveLength(50);
      expect(inMemory[0]?.id).toBe("new11");
      expect(inMemory[49]?.id).toBe("new60");

      // Full transcript = buffer + inMemory has exactly 60 messages
      const fullTranscript = [...history, ...inMemory];
      expect(fullTranscript).toHaveLength(60);

      // Verify message IDs are from the new session only (no old IDs)
      for (let i = 0; i < 60; i++) {
        expect(fullTranscript[i]?.id).toBe(`new${i + 1}`);
      }
      // Double-check no old IDs leaked
      const allIds = fullTranscript.map((m) => m.id);
      expect(allIds.some((id) => id.startsWith("old"))).toBe(false);
    });

    test("/compact → continued session lifecycle: populate, compact, continue, verify", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      // Phase 1: Simulate 80 messages with windowing
      let inMemory: ChatMessage[] = [];
      let trimmedCount = 0;

      for (let i = 1; i <= 80; i++) {
        inMemory = [...inMemory, makeChatMessage(`m${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
          trimmedCount += applied.evictedCount;
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      expect(inMemory).toHaveLength(50);
      expect(readHistoryBuffer()).toHaveLength(30);

      // Phase 2: Simulate /compact — replace buffer with summary
      appendCompactionSummary("Summary of 80-message session");

      // Verify buffer has exactly 1 message (summary only)
      const afterCompact = readHistoryBuffer();
      expect(afterCompact).toHaveLength(1);
      expect(afterCompact[0]?.role).toBe("assistant");
      expect(afterCompact[0]?.content).toBe("Summary of 80-message session");
      expect(afterCompact[0]?.id).toMatch(/^compact_/);

      // Clear in-memory to simulate /compact resetting visible state
      inMemory = [];
      trimmedCount = 0;

      // Phase 3: Continue session — add 40 more messages (no eviction since < 50)
      for (let i = 1; i <= 40; i++) {
        inMemory = [...inMemory, makeChatMessage(`cont${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
          trimmedCount += applied.evictedCount;
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      // Buffer still has 1 message (summary) since 40 < 50, no eviction
      const bufferAfterContinue = readHistoryBuffer();
      expect(bufferAfterContinue).toHaveLength(1);
      expect(bufferAfterContinue[0]?.content).toBe("Summary of 80-message session");

      // inMemory has 40 new messages
      expect(inMemory).toHaveLength(40);
      expect(trimmedCount).toBe(0);

      // Full transcript: buffer + inMemory = 41 messages (1 summary + 40 new)
      const fullTranscript = [...bufferAfterContinue, ...inMemory];
      expect(fullTranscript).toHaveLength(41);
      expect(fullTranscript[0]?.id).toMatch(/^compact_/);
      expect(fullTranscript[1]?.id).toBe("cont1");
      expect(fullTranscript[40]?.id).toBe("cont40");
    });

    test("Ctrl+O → /compact → Ctrl+O shows only summary + new messages", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      // Phase 1: Simulate 120 messages with windowing (70 in buffer, 50 in memory)
      let inMemory: ChatMessage[] = [];
      let trimmedCount = 0;

      for (let i = 1; i <= 120; i++) {
        inMemory = [...inMemory, makeChatMessage(`m${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
          trimmedCount += applied.evictedCount;
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      // Phase 2: Simulate Ctrl+O — merge buffer + inMemory → verify 120 total
      const firstCtrlO = [...readHistoryBuffer(), ...inMemory];
      expect(firstCtrlO).toHaveLength(120);
      for (let i = 0; i < 120; i++) {
        expect(firstCtrlO[i]?.id).toBe(`m${i + 1}`);
      }

      // Phase 3: Simulate /compact
      appendCompactionSummary("Summary of long session");

      // Clear inMemory and reset trimmedCount (as /compact would)
      inMemory = [];
      trimmedCount = 0;

      // Phase 4: Add 20 new messages (no eviction since < 50)
      for (let i = 1; i <= 20; i++) {
        inMemory = [...inMemory, makeChatMessage(`post${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
          trimmedCount += applied.evictedCount;
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      expect(inMemory).toHaveLength(20);

      // Phase 5: Simulate Ctrl+O again — merge = buffer + inMemory → verify 21 (1 summary + 20 new)
      const secondCtrlO = [...readHistoryBuffer(), ...inMemory];
      expect(secondCtrlO).toHaveLength(21);

      // First message should be the summary marker
      expect(secondCtrlO[0]?.id).toMatch(/^compact_/);
      expect(secondCtrlO[0]?.role).toBe("assistant");
      expect(secondCtrlO[0]?.content).toBe("Summary of long session");

      // Remaining 20 messages are the new ones
      for (let i = 1; i <= 20; i++) {
        expect(secondCtrlO[i]?.id).toBe(`post${i}`);
      }
    });
  });

  describe("scale and performance", () => {
    test("500 messages: windowing pipeline produces correct buffer and in-memory split", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      let inMemory: ChatMessage[] = [];

      for (let i = 1; i <= 500; i++) {
        inMemory = [...inMemory, makeChatMessage(`m${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      // In-memory should have exactly 50 messages: m451-m500
      expect(inMemory).toHaveLength(50);
      expect(inMemory[0]?.id).toBe("m451");
      expect(inMemory[49]?.id).toBe("m500");

      // Buffer should have exactly 450 messages: m1-m450
      const history = readHistoryBuffer();
      expect(history).toHaveLength(450);
      expect(history[0]?.id).toBe("m1");
      expect(history[449]?.id).toBe("m450");

      // Full transcript is 500 messages in order
      const fullTranscript = [...history, ...inMemory];
      expect(fullTranscript).toHaveLength(500);
      for (let i = 0; i < 500; i++) {
        expect(fullTranscript[i]?.id).toBe(`m${i + 1}`);
      }
    });

    test("1000 messages: NDJSON buffer handles large files correctly", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      let inMemory: ChatMessage[] = [];

      for (let i = 1; i <= 1000; i++) {
        inMemory = [...inMemory, makeChatMessage(`m${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }

      // Buffer should have 950 messages, inMemory should have 50
      const history = readHistoryBuffer();
      expect(history).toHaveLength(950);
      expect(inMemory).toHaveLength(50);

      // Full transcript is 1000 messages in order
      const fullTranscript = [...history, ...inMemory];
      expect(fullTranscript).toHaveLength(1000);
      for (let i = 0; i < 1000; i++) {
        expect(fullTranscript[i]?.id).toBe(`m${i + 1}`);
      }

      // Read the raw file and verify it's valid NDJSON (each line parses as JSON)
      const raw = readFileSync(BUFFER_FILE, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      expect(lines).toHaveLength(950);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("id");
        expect(parsed).toHaveProperty("role");
        expect(parsed).toHaveProperty("content");
      }
    });

    test("500 messages: buffer operations complete within reasonable time", async () => {
      const { applyMessageWindow } = await import("./message-window.ts");

      // a. Time to simulate 500 messages through windowing + buffer writes
      const startWrite = performance.now();
      let inMemory: ChatMessage[] = [];
      for (let i = 1; i <= 500; i++) {
        inMemory = [...inMemory, makeChatMessage(`m${i}`)];
        const applied = applyMessageWindow(inMemory, 50);
        if (applied.evictedCount > 0) {
          appendToHistoryBuffer(applied.evictedMessages as ChatMessage[]);
        }
        inMemory = applied.inMemoryMessages as ChatMessage[];
      }
      const writeTime = performance.now() - startWrite;

      // b. Time to read the full buffer back
      const startRead = performance.now();
      const history = readHistoryBuffer();
      const readTime = performance.now() - startRead;

      // c. Time to reconstruct the full transcript
      const startReconstruct = performance.now();
      const fullTranscript = [...history, ...inMemory];
      // Verify ordering during reconstruction
      for (let i = 0; i < 500; i++) {
        expect(fullTranscript[i]?.id).toBe(`m${i + 1}`);
      }
      const reconstructTime = performance.now() - startReconstruct;

      console.debug(`[scale-perf] 500 messages - write: ${writeTime.toFixed(1)}ms, read: ${readTime.toFixed(1)}ms, reconstruct: ${reconstructTime.toFixed(1)}ms`);

      // All operations should complete within 5000ms (generous to avoid flaky tests)
      expect(writeTime).toBeLessThan(5000);
      expect(readTime).toBeLessThan(5000);
      expect(reconstructTime).toBeLessThan(5000);
    });
  });

  describe("/clear and /compact postcondition contracts", () => {
    // ── /clear postconditions ──

    test("after populating buffer + clearHistoryBuffer(), readHistoryBuffer() returns []", () => {
      appendToHistoryBuffer(makeChatMessages(10));
      expect(readHistoryBuffer()).toHaveLength(10);

      clearHistoryBuffer();

      expect(readHistoryBuffer()).toEqual([]);
    });

    test("after clear, new messages can be appended (dedup Set is reset)", () => {
      // Populate with m1..m5
      appendToHistoryBuffer(makeChatMessages(5));
      clearHistoryBuffer();

      // Re-append with the SAME ids — should succeed because dedup Set was reset
      const count = appendToHistoryBuffer(makeChatMessages(5));
      expect(count).toBe(5);
      expect(readHistoryBuffer()).toHaveLength(5);
    });

    test("after clear then re-populate, buffer only contains new messages (no ghost data)", () => {
      // Phase 1: old session data
      appendToHistoryBuffer(makeChatMessages(5, "old"));
      expect(readHistoryBuffer()).toHaveLength(5);

      // Phase 2: /clear
      clearHistoryBuffer();

      // Phase 3: new session data
      appendToHistoryBuffer(makeChatMessages(3, "new"));
      const stored = readHistoryBuffer();

      expect(stored).toHaveLength(3);
      expect(stored.map((m) => m.id)).toEqual(["new1", "new2", "new3"]);
      // Ensure none of the old messages leak through
      expect(stored.some((m) => m.id.startsWith("old"))).toBe(false);
    });

    // ── /compact postconditions ──

    test("after populating buffer + appendCompactionSummary(), buffer contains exactly 1 message", () => {
      appendToHistoryBuffer(makeChatMessages(20));
      expect(readHistoryBuffer()).toHaveLength(20);

      appendCompactionSummary("summary text");

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(1);
    });

    test("compaction summary has role 'assistant', id matching /^compact_/, and correct content", () => {
      appendToHistoryBuffer(makeChatMessages(5));
      appendCompactionSummary("The user discussed windowing and compaction");

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(1);

      const marker = stored[0]!;
      expect(marker.role).toBe("assistant");
      expect(marker.id).toMatch(/^compact_/);
      expect(marker.content).toBe("The user discussed windowing and compaction");
    });

    test("after compact, new evictions append correctly after the summary marker", () => {
      // Simulate /compact
      appendCompactionSummary("Previous context summary");
      expect(readHistoryBuffer()).toHaveLength(1);

      // Simulate new evictions arriving after compaction
      const evicted = makeChatMessages(5, "evict");
      const count = appendToHistoryBuffer(evicted);
      expect(count).toBe(5);

      const stored = readHistoryBuffer();
      expect(stored).toHaveLength(6);
      // First entry is the compaction summary
      expect(stored[0]!.id).toMatch(/^compact_/);
      expect(stored[0]!.content).toBe("Previous context summary");
      // Remaining entries are the new evictions in order
      expect(stored.slice(1).map((m) => m.id)).toEqual([
        "evict1",
        "evict2",
        "evict3",
        "evict4",
        "evict5",
      ]);
    });

    test("compaction summary marker survives a read-write-read cycle", () => {
      // Step 1: Write summary
      appendCompactionSummary("Survived summary");
      const afterSummary = readHistoryBuffer();
      expect(afterSummary).toHaveLength(1);
      expect(afterSummary[0]!.content).toBe("Survived summary");
      expect(afterSummary[0]!.id).toMatch(/^compact_/);

      // Step 2: Append new messages on top
      appendToHistoryBuffer(makeChatMessages(3, "post"));
      const afterAppend = readHistoryBuffer();
      expect(afterAppend).toHaveLength(4);

      // Summary is still the first entry
      expect(afterAppend[0]!.id).toMatch(/^compact_/);
      expect(afterAppend[0]!.content).toBe("Survived summary");
      // New messages follow
      expect(afterAppend.slice(1).map((m) => m.id)).toEqual(["post1", "post2", "post3"]);

      // Step 3: Read again to confirm persistence
      const finalRead = readHistoryBuffer();
      expect(finalRead).toHaveLength(4);
      expect(finalRead[0]!.id).toMatch(/^compact_/);
      expect(finalRead[0]!.content).toBe("Survived summary");
      expect(finalRead.slice(1).map((m) => m.id)).toEqual(["post1", "post2", "post3"]);
    });
  });

  describe("NDJSON format", () => {
    test("appendToHistoryBuffer writes NDJSON format (one JSON per line)", () => {
      appendToHistoryBuffer(makeChatMessages(3));

      const raw = readFileSync(BUFFER_FILE, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);
      // Each line is a valid JSON object
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("id");
        expect(parsed).toHaveProperty("role");
      }
    });

    test("replaceHistoryBuffer writes NDJSON format", () => {
      const messages = makeChatMessages(2, "r");
      replaceHistoryBuffer(messages);

      const raw = readFileSync(BUFFER_FILE, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).id).toBe("r1");
      expect(JSON.parse(lines[1]!).id).toBe("r2");
    });

    test("clearHistoryBuffer truncates file to empty", () => {
      appendToHistoryBuffer(makeChatMessages(5));
      clearHistoryBuffer();

      const raw = readFileSync(BUFFER_FILE, "utf-8");
      expect(raw).toBe("");
    });

    test("appendToHistoryBuffer uses append-only (does not rewrite entire file)", () => {
      appendToHistoryBuffer(makeChatMessages(2, "a"));
      const rawAfterFirst = readFileSync(BUFFER_FILE, "utf-8");

      appendToHistoryBuffer(makeChatMessages(2, "b"));
      const rawAfterSecond = readFileSync(BUFFER_FILE, "utf-8");

      // Second write should START with the first write's content
      expect(rawAfterSecond.startsWith(rawAfterFirst)).toBe(true);
      // And have additional lines appended
      const lines = rawAfterSecond.split("\n").filter(Boolean);
      expect(lines).toHaveLength(4);
    });

    test("readHistoryBuffer handles legacy JSON array format (migration)", () => {
      const messages = makeChatMessages(3);
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, JSON.stringify(messages), "utf-8");

      const result = readHistoryBuffer();
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe("m1");
      expect(result[2]?.id).toBe("m3");
    });

    test("file permissions are set to 0600", () => {
      // Windows does not support Unix file permissions the same way
      if (process.platform === "win32") return;

      appendToHistoryBuffer(makeChatMessages(1));

      const stats = statSync(BUFFER_FILE);
      // Check file mode lower 9 bits (rwxrwxrwx) = 0o600 (rw-------)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    test("dedup Set resets on clearHistoryBuffer", () => {
      // Write messages with IDs m1, m2, m3
      appendToHistoryBuffer(makeChatMessages(3));
      clearHistoryBuffer();

      // After clear, same IDs should be writable again
      const count = appendToHistoryBuffer(makeChatMessages(3));
      expect(count).toBe(3);
      expect(readHistoryBuffer()).toHaveLength(3);
    });
  });
});
