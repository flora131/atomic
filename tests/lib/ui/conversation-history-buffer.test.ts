import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChatMessage } from "@/screens/chat-screen.tsx";

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
} from "@/lib/ui/conversation-history-buffer.ts";

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
    test("returns empty array when no buffer file exists", async () => {
      const result = await readHistoryBuffer();
      expect(result).toEqual([]);
    });

    test("returns empty array when buffer file is empty", async () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, "", "utf-8");
      const result = await readHistoryBuffer();
      expect(result).toEqual([]);
    });

    test("returns empty array when buffer file contains invalid JSON", async () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, "not json", "utf-8");
      const result = await readHistoryBuffer();
      expect(result).toEqual([]);
    });

    test("parses non-array JSON as single NDJSON line", async () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, JSON.stringify({ not: "array" }) + "\n", "utf-8");
      const result = await readHistoryBuffer();
      // NDJSON parser treats single-line JSON objects as valid entries
      expect(result).toHaveLength(1);
    });

    test("reads legacy JSON array format via migration detection", async () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      const messages = makeChatMessages(3);
      writeFileSync(BUFFER_FILE, JSON.stringify(messages), "utf-8");
      const result = await readHistoryBuffer();
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe("m1");
    });
  });

  describe("appendToHistoryBuffer", () => {
    test("appends messages to empty buffer", async () => {
      const messages = makeChatMessages(3);
      const count = appendToHistoryBuffer(messages);

      expect(count).toBe(3);
      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(3);
      expect(stored[0]?.id).toBe("m1");
      expect(stored[2]?.id).toBe("m3");
    });

    test("returns 0 for empty input array", async () => {
      const count = appendToHistoryBuffer([]);
      expect(count).toBe(0);
      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("deduplicates messages by id", async () => {
      const batch1 = makeChatMessages(3);
      appendToHistoryBuffer(batch1);

      // Append again with same ids
      const count = appendToHistoryBuffer(batch1);
      expect(count).toBe(0);

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(3);
    });

    test("deduplicates against pre-existing on-disk messages before first append", async () => {
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, JSON.stringify(makeChatMessage("m1")) + "\n", "utf-8");

      const count = appendToHistoryBuffer([makeChatMessage("m1"), makeChatMessage("m2")]);
      expect(count).toBe(1);

      const stored = await readHistoryBuffer();
      expect(stored.map((m) => m.id)).toEqual(["m1", "m2"]);
    });

    test("appends only new messages when mixed with existing ids", async () => {
      appendToHistoryBuffer(makeChatMessages(3));

      const mixed = [makeChatMessage("m2"), makeChatMessage("m4"), makeChatMessage("m5")];
      const count = appendToHistoryBuffer(mixed);

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
      expect(stored.map((m) => m.id)).toEqual(["a1", "a2", "b1", "b2", "c1", "c2"]);
    });
  });

  describe("replaceHistoryBuffer", () => {
    test("replaces buffer with new messages", async () => {
      appendToHistoryBuffer(makeChatMessages(5));
      const replacement = makeChatMessages(2, "r");
      replaceHistoryBuffer(replacement);

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(2);
      expect(stored[0]?.id).toBe("r1");
      expect(stored[1]?.id).toBe("r2");
    });

    test("replaces buffer with empty array", async () => {
      appendToHistoryBuffer(makeChatMessages(5));
      replaceHistoryBuffer([]);

      const stored = await readHistoryBuffer();
      expect(stored).toEqual([]);
    });
  });

  describe("clearHistoryBuffer", () => {
    test("clears all messages from buffer", async () => {
      appendToHistoryBuffer(makeChatMessages(10));
      clearHistoryBuffer();

      const stored = await readHistoryBuffer();
      expect(stored).toEqual([]);
    });

    test("no-op when buffer is already empty", async () => {
      clearHistoryBuffer();
      const stored = await readHistoryBuffer();
      expect(stored).toEqual([]);
    });
  });

  describe("appendCompactionSummary", () => {
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
      // appendCompactionSummary clears first, then appends the summary marker
      expect(stored).toHaveLength(1);
      expect(stored[0]?.content).toBe("Summary of previous context");
      expect(stored[0]?.role).toBe("assistant");
    });
  });

  describe("buffer lifecycle contracts", () => {

    test("/clear resets buffer state", async () => {
      // Setup: populate buffer
      appendToHistoryBuffer(makeChatMessages(30));

      // Simulate /clear: wipe everything
      clearHistoryBuffer();

      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("/compact replaces buffer with compaction summary only", async () => {
      // Setup: populate buffer with prior messages
      appendToHistoryBuffer(makeChatMessages(30));

      // Simulate /compact: replace buffer with summary
      appendCompactionSummary("Previous context: user discussed testing strategies");

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.role).toBe("assistant");
      expect(stored[0]?.content).toBe("Previous context: user discussed testing strategies");
    });

    test("/clear → new session lifecycle: populate, clear, repopulate, verify clean state", async () => {
      // Phase 1: Simulate initial session with messages in buffer
      appendToHistoryBuffer(makeChatMessages(30, "old"));
      expect(await readHistoryBuffer()).toHaveLength(30);

      // Phase 2: Simulate /clear — wipe buffer
      clearHistoryBuffer();

      // Verify buffer is empty, no ghost data
      expect(await readHistoryBuffer()).toEqual([]);

      // Phase 3: Simulate new session — add new messages to buffer
      appendToHistoryBuffer(makeChatMessages(20, "new"));

      // Buffer has only new messages (no old messages)
      const history = await readHistoryBuffer();
      expect(history).toHaveLength(20);
      expect(history[0]?.id).toBe("new1");
      expect(history[19]?.id).toBe("new20");

      // Verify message IDs are from the new session only (no old IDs)
      const allIds = history.map((m) => m.id);
      expect(allIds.some((id) => id.startsWith("old"))).toBe(false);
    });

    test("/compact → continued session lifecycle: populate, compact, continue, verify", async () => {
      // Phase 1: Simulate session with messages in buffer
      appendToHistoryBuffer(makeChatMessages(30));
      expect(await readHistoryBuffer()).toHaveLength(30);

      // Phase 2: Simulate /compact — replace buffer with summary
      appendCompactionSummary("Summary of 30-message session");

      // Verify buffer has exactly 1 message (summary only)
      const afterCompact = await readHistoryBuffer();
      expect(afterCompact).toHaveLength(1);
      expect(afterCompact[0]?.role).toBe("assistant");
      expect(afterCompact[0]?.content).toBe("Summary of 30-message session");
      expect(afterCompact[0]?.id).toMatch(/^compact_/);

      // Phase 3: Continue session — add more messages to buffer
      appendToHistoryBuffer(makeChatMessages(15, "cont"));

      // Buffer now has summary + new messages
      const bufferAfterContinue = await readHistoryBuffer();
      expect(bufferAfterContinue).toHaveLength(16); // 1 summary + 15 new
      expect(bufferAfterContinue[0]?.content).toBe("Summary of 30-message session");
      expect(bufferAfterContinue[1]?.id).toBe("cont1");
      expect(bufferAfterContinue[15]?.id).toBe("cont15");
    });

    test("/compact → more messages → verify buffer integrity", async () => {
      // Phase 1: Simulate session with messages
      appendToHistoryBuffer(makeChatMessages(50, "m"));

      // Phase 2: Simulate /compact
      appendCompactionSummary("Summary of long session");

      const afterCompact = await readHistoryBuffer();
      expect(afterCompact).toHaveLength(1);
      expect(afterCompact[0]?.id).toMatch(/^compact_/);
      expect(afterCompact[0]?.role).toBe("assistant");
      expect(afterCompact[0]?.content).toBe("Summary of long session");

      // Phase 3: Add more messages
      appendToHistoryBuffer(makeChatMessages(10, "post"));

      // Phase 4: Verify buffer = summary + new messages
      const finalBuffer = await readHistoryBuffer();
      expect(finalBuffer).toHaveLength(11); // 1 summary + 10 new

      // First message should be the summary
      expect(finalBuffer[0]?.id).toMatch(/^compact_/);
      expect(finalBuffer[0]?.content).toBe("Summary of long session");

      // Remaining messages are the new ones
      for (let i = 1; i <= 10; i++) {
        expect(finalBuffer[i]?.id).toBe(`post${i}`);
      }
    });
  });

  describe("/clear and /compact postcondition contracts", () => {
    // ── /clear postconditions ──

    test("after populating buffer + clearHistoryBuffer(), readHistoryBuffer() returns []", async () => {
      appendToHistoryBuffer(makeChatMessages(10));
      expect(await readHistoryBuffer()).toHaveLength(10);

      clearHistoryBuffer();

      expect(await readHistoryBuffer()).toEqual([]);
    });

    test("after clear, new messages can be appended (dedup Set is reset)", async () => {
      // Populate with m1..m5
      appendToHistoryBuffer(makeChatMessages(5));
      clearHistoryBuffer();

      // Re-append with the SAME ids — should succeed because dedup Set was reset
      const count = appendToHistoryBuffer(makeChatMessages(5));
      expect(count).toBe(5);
      expect(await readHistoryBuffer()).toHaveLength(5);
    });

    test("after clear then re-populate, buffer only contains new messages (no ghost data)", async () => {
      // Phase 1: old session data
      appendToHistoryBuffer(makeChatMessages(5, "old"));
      expect(await readHistoryBuffer()).toHaveLength(5);

      // Phase 2: /clear
      clearHistoryBuffer();

      // Phase 3: new session data
      appendToHistoryBuffer(makeChatMessages(3, "new"));
      const stored = await readHistoryBuffer();

      expect(stored).toHaveLength(3);
      expect(stored.map((m) => m.id)).toEqual(["new1", "new2", "new3"]);
      // Ensure none of the old messages leak through
      expect(stored.some((m) => m.id.startsWith("old"))).toBe(false);
    });

    // ── /compact postconditions ──

    test("after populating buffer + appendCompactionSummary(), buffer contains exactly 1 message", async () => {
      appendToHistoryBuffer(makeChatMessages(20));
      expect(await readHistoryBuffer()).toHaveLength(20);

      appendCompactionSummary("summary text");

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(1);
    });

    test("compaction summary has role 'assistant', id matching /^compact_/, and correct content", async () => {
      appendToHistoryBuffer(makeChatMessages(5));
      appendCompactionSummary("The user discussed windowing and compaction");

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(1);

      const marker = stored[0]!;
      expect(marker.role).toBe("assistant");
      expect(marker.id).toMatch(/^compact_/);
      expect(marker.content).toBe("The user discussed windowing and compaction");
    });

    test("after compact, new evictions append correctly after the summary marker", async () => {
      // Simulate /compact
      appendCompactionSummary("Previous context summary");
      expect(await readHistoryBuffer()).toHaveLength(1);

      // Simulate new evictions arriving after compaction
      const evicted = makeChatMessages(5, "evict");
      const count = appendToHistoryBuffer(evicted);
      expect(count).toBe(5);

      const stored = await readHistoryBuffer();
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

    test("compaction summary marker survives a read-write-read cycle", async () => {
      // Step 1: Write summary
      appendCompactionSummary("Survived summary");
      const afterSummary = await readHistoryBuffer();
      expect(afterSummary).toHaveLength(1);
      expect(afterSummary[0]!.content).toBe("Survived summary");
      expect(afterSummary[0]!.id).toMatch(/^compact_/);

      // Step 2: Append new messages on top
      appendToHistoryBuffer(makeChatMessages(3, "post"));
      const afterAppend = await readHistoryBuffer();
      expect(afterAppend).toHaveLength(4);

      // Summary is still the first entry
      expect(afterAppend[0]!.id).toMatch(/^compact_/);
      expect(afterAppend[0]!.content).toBe("Survived summary");
      // New messages follow
      expect(afterAppend.slice(1).map((m) => m.id)).toEqual(["post1", "post2", "post3"]);

      // Step 3: Read again to confirm persistence
      const finalRead = await readHistoryBuffer();
      expect(finalRead).toHaveLength(4);
      expect(finalRead[0]!.id).toMatch(/^compact_/);
      expect(finalRead[0]!.content).toBe("Survived summary");
      expect(finalRead.slice(1).map((m) => m.id)).toEqual(["post1", "post2", "post3"]);
    });
  });

  describe("NDJSON format", () => {
    test("appendToHistoryBuffer writes NDJSON format (one JSON per line)", async () => {
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

    test("replaceHistoryBuffer writes NDJSON format", async () => {
      const messages = makeChatMessages(2, "r");
      replaceHistoryBuffer(messages);

      const raw = readFileSync(BUFFER_FILE, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).id).toBe("r1");
      expect(JSON.parse(lines[1]!).id).toBe("r2");
    });

    test("clearHistoryBuffer truncates file to empty", async () => {
      appendToHistoryBuffer(makeChatMessages(5));
      clearHistoryBuffer();

      const raw = readFileSync(BUFFER_FILE, "utf-8");
      expect(raw).toBe("");
    });

    test("appendToHistoryBuffer uses append-only (does not rewrite entire file)", async () => {
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

    test("readHistoryBuffer handles legacy JSON array format (migration)", async () => {
      const messages = makeChatMessages(3);
      mkdirSync(BUFFER_DIR, { recursive: true });
      writeFileSync(BUFFER_FILE, JSON.stringify(messages), "utf-8");

      const result = await readHistoryBuffer();
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe("m1");
      expect(result[2]?.id).toBe("m3");
    });

    test("file permissions are set to 0600", async () => {
      // Windows does not support Unix file permissions the same way
      if (process.platform === "win32") return;

      appendToHistoryBuffer(makeChatMessages(1));

      const stats = statSync(BUFFER_FILE);
      // Check file mode lower 9 bits (rwxrwxrwx) = 0o600 (rw-------)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    test("dedup Set resets on clearHistoryBuffer", async () => {
      // Write messages with IDs m1, m2, m3
      appendToHistoryBuffer(makeChatMessages(3));
      clearHistoryBuffer();

      // After clear, same IDs should be writable again
      const count = appendToHistoryBuffer(makeChatMessages(3));
      expect(count).toBe(3);
      expect(await readHistoryBuffer()).toHaveLength(3);
    });
  });
});
