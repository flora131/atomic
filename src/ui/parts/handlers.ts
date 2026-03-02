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
 * - If the last TextPart is finalized but the delta is a mid-sentence continuation
 *   (no \n\n paragraph break), merge back to avoid orphaned fragments
 * - Otherwise create a new TextPart for text after a tool completes
 */
export function handleTextDelta(msg: ChatMessage, delta: string): ChatMessage {
  const parts = [...(msg.parts ?? [])];
  const lastTextIdx = findLastPartIndex(parts, (p) => p.type === "text");

  if (lastTextIdx >= 0 && (parts[lastTextIdx] as TextPart).isStreaming) {
    // Append to existing streaming TextPart
    const textPart = parts[lastTextIdx] as TextPart;
    parts[lastTextIdx] = { ...textPart, content: textPart.content + delta };
  } else if (
    lastTextIdx >= 0 &&
    lastTextIdx === parts.length - 1 &&
    !delta.startsWith("\n\n") &&
    !(parts[lastTextIdx] as TextPart).content.endsWith("\n\n")
  ) {
    // The previous TextPart was finalized at a tool boundary but the new
    // delta continues the same paragraph (no \n\n separator). Merge back
    // to avoid orphaned text fragments (e.g., trailing ":" on its own line).
    const textPart = parts[lastTextIdx] as TextPart;
    parts[lastTextIdx] = { ...textPart, content: textPart.content + delta };
  } else {
    // Create new TextPart (new paragraph after tool completes)
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
