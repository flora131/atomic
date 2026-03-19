import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChatMessage } from "@/types/chat.ts";
import { clearHistoryBuffer } from "@/state/chat/shared/helpers/conversation-history-buffer.ts";

export const BUFFER_DIR = join(tmpdir(), "atomic-cli");
export const BUFFER_FILE = join(BUFFER_DIR, `history-${process.pid}.json`);

export function resetConversationHistoryBuffer(): void {
  clearHistoryBuffer();
}

export function cleanupConversationHistoryBuffer(): void {
  try {
    if (existsSync(BUFFER_FILE)) unlinkSync(BUFFER_FILE);
  } catch {
    // ignore
  }
}

export function writeBufferContents(raw: string): void {
  mkdirSync(BUFFER_DIR, { recursive: true });
  writeFileSync(BUFFER_FILE, raw, "utf-8");
}

export function makeChatMessage(
  id: string,
  role: "user" | "assistant" = "user",
  content = `msg ${id}`,
): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

export function makeChatMessages(count: number, prefix = "m"): ChatMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeChatMessage(`${prefix}${i + 1}`),
  );
}
