/**
 * Helper utilities for working with Parts and ChatMessages
 */

import type { ChatMessage } from "../chat.tsx";
import type { TextPart } from "./types.ts";

/**
 * Extract all text content from a ChatMessage's parts array.
 * Filters for TextPart instances and joins their content strings.
 *
 * @param msg - ChatMessage with optional parts array
 * @returns Concatenated text content from all TextParts, or empty string if no parts
 */
export function getMessageText(msg: ChatMessage): string {
  return (msg.parts ?? [])
    .filter((p): p is TextPart => p.type === "text")
    .map(p => p.content)
    .join("");
}
