/**
 * Conversation History Buffer
 *
 * Persists the full conversation history to a tmp file so that ctrl+o
 * can display it even after /compact clears visible messages.
 *
 * Messages are stored as NDJSON (newline-delimited JSON) in a
 * session-specific temp file for append-only writes.
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChatMessage } from "../chat.tsx";

const BUFFER_DIR = join(tmpdir(), "atomic-cli");
const BUFFER_FILE = join(BUFFER_DIR, `history-${process.pid}.json`);

/** File permission: owner read/write only */
const FILE_MODE = 0o600;

/**
 * In-memory dedup Set of message IDs already written to disk.
 * Populated on first read, cleared on clearHistoryBuffer().
 */
let writtenIds: Set<string> | null = null;

/**
 * Ensure the buffer directory exists.
 */
function ensureBufferDir(): void {
  mkdirSync(BUFFER_DIR, { recursive: true });
}

/**
 * Lazily initialise the dedup Set by reading existing IDs from disk.
 */
function ensureDedup(): Set<string> {
  if (writtenIds === null) {
    const existing = readHistoryBuffer();
    writtenIds = new Set(existing.map((m) => m.id));
  }
  return writtenIds;
}

/**
 * Append messages to the persistent history buffer on disk.
 * Uses append-only NDJSON writes and an in-memory dedup Set
 * to avoid re-reading the file on every append.
 */
export function appendToHistoryBuffer(messages: ChatMessage[]): number {
  if (messages.length === 0) return 0;
  try {
    ensureBufferDir();
    const ids = ensureDedup();
    const newMessages = messages.filter((m) => !ids.has(m.id));
    if (newMessages.length === 0) return 0;

    const ndjson = newMessages
      .map((m) => JSON.stringify(m) + "\n")
      .join("");
    appendFileSync(BUFFER_FILE, ndjson, { encoding: "utf-8", mode: FILE_MODE });

    for (const m of newMessages) {
      ids.add(m.id);
    }
    return newMessages.length;
  } catch {
    // Silently ignore write failures -- history is best-effort
    return 0;
  }
}

/**
 * Replace the full history buffer with the provided messages.
 * Writes all messages as NDJSON lines.
 */
export function replaceHistoryBuffer(messages: ChatMessage[]): void {
  try {
    ensureBufferDir();
    const ndjson = messages
      .map((m) => JSON.stringify(m) + "\n")
      .join("");
    writeFileSync(BUFFER_FILE, ndjson, { encoding: "utf-8", mode: FILE_MODE });

    // Rebuild the dedup Set to match the new file contents
    writtenIds = new Set(messages.map((m) => m.id));
  } catch {
    // Silently ignore write failures -- history is best-effort
  }
}

/**
 * Append a compaction summary marker into history.
 * Used when /compact resets prior raw messages but keeps a summary record.
 * Clears existing history first, then writes a single summary line.
 */
export function appendCompactionSummary(summary: string): void {
  const message: ChatMessage = {
    id: `compact_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    role: "assistant",
    content: summary,
    timestamp: new Date().toISOString(),
  };
  clearHistoryBuffer();
  appendToHistoryBuffer([message]);
}

/**
 * Read the full conversation history from the buffer file.
 * Supports both legacy JSON array format and NDJSON format
 * for backward compatibility (migration detection).
 */
export function readHistoryBuffer(): ChatMessage[] {
  try {
    if (!existsSync(BUFFER_FILE)) return [];
    const raw = readFileSync(BUFFER_FILE, "utf-8");
    if (!raw.trim()) return [];

    let messages: ChatMessage[];

    // Migration detection: legacy JSON array starts with '['
    if (raw.trimStart().startsWith("[")) {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      messages = parsed as ChatMessage[];
    } else {
      // NDJSON: one JSON object per line
      messages = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ChatMessage);
    }

    // Populate the dedup Set if this is the first read
    if (writtenIds === null) {
      writtenIds = new Set(messages.map((m) => m.id));
    }

    console.debug(`[history-buffer] read ${messages.length} messages (${raw.length} bytes)`);
    return messages;
  } catch {
    return [];
  }
}

/**
 * Clear the history buffer file (e.g. on /clear).
 * Truncates the file to empty and resets the in-memory dedup Set.
 */
export function clearHistoryBuffer(): void {
  try {
    ensureBufferDir();
    writeFileSync(BUFFER_FILE, "", { encoding: "utf-8", mode: FILE_MODE });
    writtenIds = new Set();
  } catch {
    // Silently ignore
  }
}
