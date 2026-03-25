/**
 * Test fixture factories for ChatMessage and related types.
 *
 * Provides properly-typed mock builders that eliminate `as any` casts
 * across test files. Every factory returns a valid ChatMessage (or
 * sub-type) with sensible defaults, overridable via Partial<>.
 */

import type {
  ChatMessage,
  HitlContext,
  StreamingMeta,
} from "@/state/chat/shared/types/message.ts";
import type { Part } from "@/state/parts/types.ts";

// ---------------------------------------------------------------------------
// Message ID counter
// ---------------------------------------------------------------------------

let messageIdCounter = 0;

export function nextMessageId(): string {
  return `msg_${String(++messageIdCounter).padStart(6, "0")}`;
}

export function resetMessageIdCounter(): void {
  messageIdCounter = 0;
}

// ---------------------------------------------------------------------------
// ChatMessage factory
// ---------------------------------------------------------------------------

/**
 * Creates a properly-typed ChatMessage with sensible defaults.
 *
 * Use this instead of `{ parts: [], streaming: false } as any` in tests.
 *
 * @example
 * ```ts
 * const msg = createMockChatMessage({ streaming: true, parts: myParts });
 * ```
 */
export function createMockChatMessage(
  overrides?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: nextMessageId(),
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a minimal ChatMessage from a parts array.
 *
 * Convenience wrapper for the common pattern:
 *   `{ parts } as unknown as ChatMessage`
 *
 * @example
 * ```ts
 * const msg = createMessageFromParts([textPart, toolPart]);
 * ```
 */
export function createMessageFromParts(
  parts: Part[],
  overrides?: Partial<ChatMessage>,
): ChatMessage {
  return createMockChatMessage({
    parts,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// HitlContext factory
// ---------------------------------------------------------------------------

export function createHitlContext(
  overrides?: Partial<HitlContext>,
): HitlContext {
  return {
    question: "Allow this operation?",
    header: "Permission Request",
    answer: "Yes",
    cancelled: false,
    responseMode: "option",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// StreamingMeta factory
// ---------------------------------------------------------------------------

export function createStreamingMeta(
  overrides?: Partial<StreamingMeta>,
): StreamingMeta {
  return {
    outputTokens: 0,
    thinkingMs: 0,
    thinkingText: "",
    ...overrides,
  };
}
