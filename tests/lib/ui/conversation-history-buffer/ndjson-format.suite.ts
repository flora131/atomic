import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import {
  appendCompactionSummary,
  appendToHistoryBuffer,
  clearHistoryBuffer,
  readHistoryBuffer,
  replaceHistoryBuffer,
} from "@/state/chat/shared/helpers/conversation-history-buffer.ts";
import {
  BUFFER_FILE,
  cleanupConversationHistoryBuffer,
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

  describe("NDJSON format", () => {
    test("appendToHistoryBuffer writes NDJSON format (one JSON per line)", async () => {
      appendToHistoryBuffer(makeChatMessages(3));

      const raw = readFileSync(BUFFER_FILE, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("id");
        expect(parsed).toHaveProperty("role");
      }
    });

    test("replaceHistoryBuffer writes NDJSON format", async () => {
      replaceHistoryBuffer(makeChatMessages(2, "r"));

      const raw = readFileSync(BUFFER_FILE, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).id).toBe("r1");
      expect(JSON.parse(lines[1]!).id).toBe("r2");
    });

    test("clearHistoryBuffer truncates file to empty", async () => {
      appendToHistoryBuffer(makeChatMessages(5));
      clearHistoryBuffer();
      expect(readFileSync(BUFFER_FILE, "utf-8")).toBe("");
    });

    test("appendToHistoryBuffer uses append-only (does not rewrite entire file)", async () => {
      appendToHistoryBuffer(makeChatMessages(2, "a"));
      const rawAfterFirst = readFileSync(BUFFER_FILE, "utf-8");

      appendToHistoryBuffer(makeChatMessages(2, "b"));
      const rawAfterSecond = readFileSync(BUFFER_FILE, "utf-8");

      expect(rawAfterSecond.startsWith(rawAfterFirst)).toBe(true);
      expect(rawAfterSecond.split("\n").filter(Boolean)).toHaveLength(4);
    });


    test("file permissions are set to 0600", async () => {
      if (process.platform === "win32") return;

      appendToHistoryBuffer(makeChatMessages(1));

      const mode = statSync(BUFFER_FILE).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    test("dedup Set resets on clearHistoryBuffer", async () => {
      appendToHistoryBuffer(makeChatMessages(3));
      clearHistoryBuffer();

      expect(appendToHistoryBuffer(makeChatMessages(3))).toBe(3);
      expect(await readHistoryBuffer()).toHaveLength(3);
    });

    test("compaction summary has expected marker shape", async () => {
      appendToHistoryBuffer(makeChatMessages(5));
      appendCompactionSummary("The user discussed windowing and compaction");

      const stored = await readHistoryBuffer();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.role).toBe("assistant");
      expect(stored[0]!.id).toMatch(/^compact_/);
      expect(stored[0]!.content).toBe("The user discussed windowing and compaction");
    });
  });
});
