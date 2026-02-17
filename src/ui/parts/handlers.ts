/**
 * Part Handler Functions
 *
 * Functions for handling streaming events and updating message parts.
 * These handlers manage the creation and updates of parts during streaming.
 */

import type { ChatMessage } from "../chat.tsx";
import type { TextPart } from "./types.ts";
import { createPartId } from "./id.ts";
import { findLastPartIndex } from "./store.ts";

/**
 * Handle text streaming delta with natural tool boundary splitting.
 *
 * - If the last TextPart is still streaming (isStreaming: true), append delta to it
 * - If the last TextPart is NOT streaming (finalized at tool boundary) or no TextPart exists,
 *   create a new TextPart
 *
 * This naturally handles tool-boundary text splitting where text before a tool
 * is in one TextPart and text after is in a new TextPart.
 */
export function handleTextDelta(msg: ChatMessage, delta: string): ChatMessage {
  const parts = [...(msg.parts ?? [])];
  const lastTextIdx = findLastPartIndex(parts, (p) => p.type === "text");

  if (lastTextIdx >= 0 && (parts[lastTextIdx] as TextPart).isStreaming) {
    // Append to existing streaming TextPart
    const textPart = parts[lastTextIdx] as TextPart;
    parts[lastTextIdx] = { ...textPart, content: textPart.content + delta };
  } else {
    // Create new TextPart (text after tool completes)
    parts.push({
      id: createPartId(),
      type: "text" as const,
      content: delta,
      isStreaming: true,
      createdAt: new Date().toISOString(),
    });
  }

  return { ...msg, parts };
}
