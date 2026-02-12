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
export function appendToHistoryBuffer(messages: ChatMessage[]): void {
  if (messages.length === 0) return;
  try {
    mkdirSync(BUFFER_DIR, { recursive: true });
    const existing = readHistoryBuffer();
    const existingIds = new Set(existing.map((m) => m.id));
    const newMessages = messages.filter((m) => !existingIds.has(m.id));
    if (newMessages.length === 0) return;
    const merged = [...existing, ...newMessages];
    writeFileSync(BUFFER_FILE, JSON.stringify(merged), "utf-8");
  } catch {
    // Silently ignore write failures — history is best-effort
  }
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
    if (existsSync(BUFFER_FILE)) {
      writeFileSync(BUFFER_FILE, "[]", "utf-8");
    }
  } catch {
    // Silently ignore
  }
}
