/**
 * Conversation History Buffer
 *
 * Persists the full conversation history to a tmp file so that ctrl+o
 * can display it even after /compact clears visible messages.
 *
 * Messages are stored as a JSON array in a session-specific temp file.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChatMessage } from "../chat.tsx";

const BUFFER_DIR = join(tmpdir(), "atomic-cli");
const BUFFER_FILE = join(BUFFER_DIR, `history-${process.pid}.json`);

/**
 * Append messages to the persistent history buffer on disk.
 * Merges with any existing messages already in the file.
 */
export function appendToHistoryBuffer(messages: ChatMessage[]): number {
  if (messages.length === 0) return 0;
  try {
    mkdirSync(BUFFER_DIR, { recursive: true });
    const existing = readHistoryBuffer();
    const existingIds = new Set(existing.map((m) => m.id));
    const newMessages = messages.filter((m) => !existingIds.has(m.id));
    if (newMessages.length === 0) return 0;
    const merged = [...existing, ...newMessages];
    writeFileSync(BUFFER_FILE, JSON.stringify(merged), "utf-8");
    return newMessages.length;
  } catch {
    // Silently ignore write failures — history is best-effort
    return 0;
  }
}

/**
 * Replace the full history buffer with the provided messages.
 */
export function replaceHistoryBuffer(messages: ChatMessage[]): void {
  try {
    mkdirSync(BUFFER_DIR, { recursive: true });
    writeFileSync(BUFFER_FILE, JSON.stringify(messages), "utf-8");
  } catch {
    // Silently ignore write failures — history is best-effort
  }
}

/**
 * Append a compaction summary marker into history.
 * Used when /compact resets prior raw messages but keeps a summary record.
 */
export function appendCompactionSummary(summary: string): void {
  const message: ChatMessage = {
    id: `compact_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    role: "assistant",
    content: summary,
    timestamp: new Date().toISOString(),
  };
  appendToHistoryBuffer([message]);
}

/**
 * Read the full conversation history from the buffer file.
 */
export function readHistoryBuffer(): ChatMessage[] {
  try {
    if (!existsSync(BUFFER_FILE)) return [];
    const raw = readFileSync(BUFFER_FILE, "utf-8");
    if (!raw.trim()) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ChatMessage[];
  } catch {
    return [];
  }
}

/**
 * Clear the history buffer file (e.g. on /clear).
 */
export function clearHistoryBuffer(): void {
  try {
    replaceHistoryBuffer([]);
  } catch {
    // Silently ignore
  }
}
