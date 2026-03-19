import type { ChatMessage } from "@/types/chat.ts";
import { type PartId, createPartId } from "@/state/parts/id.ts";
import type { Part, ReasoningPart } from "@/state/parts/types.ts";
import { findLastPartIndex, upsertPart } from "@/state/parts/store.ts";
import type { TextPart } from "@/state/parts/types.ts";
import type { ThinkingMetaEvent } from "@/state/streaming/pipeline-types.ts";

const reasoningPartIdBySourceRegistry = new WeakMap<
  ChatMessage,
  Map<string, PartId>
>();

function finalizeLastStreamingTextPart(parts: Part[]): Part[] {
  const updated = [...parts];
  const lastTextIdx = findLastPartIndex(
    updated,
    (part) => part.type === "text" && (part as TextPart).isStreaming,
  );
  if (lastTextIdx >= 0) {
    updated[lastTextIdx] = {
      ...(updated[lastTextIdx] as TextPart),
      isStreaming: false,
    };
  }
  return updated;
}

/**
 * Remove the last streaming TextPart from parts instead of finalizing it.
 *
 * This is used when a tool-start arrives while text is still streaming
 * (Copilot SDK flow). In the Copilot SDK, text deltas from
 * `assistant.message_delta` are published immediately, but the tool
 * requests only arrive when `assistant.message` completes. The
 * preceding text (e.g. "I'll create the file:") is redundant with the
 * tool indicator and should be removed rather than preserved.
 *
 * In the Claude SDK flow, TextParts are already finalized
 * (`isStreaming: false`) before tool_use blocks start, so this
 * function has no effect — the removal only targets streaming parts.
 */
function removeLastStreamingTextPart(parts: Part[]): Part[] {
  const lastTextIdx = findLastPartIndex(
    parts,
    (part) => part.type === "text" && (part as TextPart).isStreaming,
  );
  if (lastTextIdx < 0) {
    return parts;
  }
  const updated = [...parts];
  updated.splice(lastTextIdx, 1);
  return updated;
}

export { finalizeLastStreamingTextPart, removeLastStreamingTextPart };

/**
 * Clear `isStreaming` on ALL text parts in the array.
 *
 * Used during stream finalization (normal completion, interruption, error)
 * to ensure `StreamingBullet` stops animating once the stream is done.
 */
export function finalizeStreamingTextParts(parts: Part[]): Part[] {
  let changed = false;
  const updated = parts.map((part) => {
    if (part.type !== "text" || !(part as TextPart).isStreaming) {
      return part;
    }
    changed = true;
    return { ...part, isStreaming: false };
  });
  return changed ? updated : parts;
}

export function finalizeStreamingReasoningParts(
  parts: Part[],
  fallbackDurationMs?: number,
): Part[] {
  let changed = false;
  const updated = parts.map((part) => {
    if (part.type !== "reasoning" || !part.isStreaming) {
      return part;
    }
    changed = true;
    const reasoningPart = part as ReasoningPart;
    return {
      ...reasoningPart,
      isStreaming: false,
      durationMs: reasoningPart.durationMs || fallbackDurationMs || 0,
    };
  });

  return changed ? updated : parts;
}

export function finalizeStreamingReasoningInMessage<
  T extends { parts?: Part[]; thinkingMs?: number },
>(message: T): T {
  if (!message.parts || message.parts.length === 0) {
    return message;
  }

  const finalizedParts = finalizeStreamingReasoningParts(
    message.parts,
    message.thinkingMs,
  );
  if (finalizedParts === message.parts) {
    return message;
  }

  return {
    ...message,
    parts: finalizedParts,
  };
}

function cloneReasoningPartRegistry(message: ChatMessage): Map<string, PartId> {
  const existing = reasoningPartIdBySourceRegistry.get(message);
  if (existing) {
    return new Map(existing);
  }

  const rebuilt = new Map<string, PartId>();
  for (const part of message.parts ?? []) {
    if (part.type !== "reasoning") {
      continue;
    }
    const reasoningPart = part as ReasoningPart;
    if (!reasoningPart.isStreaming) {
      continue;
    }
    const sourceKey = reasoningPart.thinkingSourceKey;
    if (sourceKey && sourceKey.trim().length > 0) {
      rebuilt.set(sourceKey, part.id);
    }
  }
  return rebuilt;
}

export function carryReasoningPartRegistry(
  from: ChatMessage,
  to: ChatMessage,
): ChatMessage {
  const existing = reasoningPartIdBySourceRegistry.get(from);
  if (existing) {
    reasoningPartIdBySourceRegistry.set(to, new Map(existing));
  }
  return to;
}

/**
 * Finalize the reasoning part for a completed thinking block.
 *
 * Sets `isStreaming: false` and removes the sourceKey from the registry
 * so that subsequent thinking deltas with the same sourceKey create a
 * new reasoning part in chronological order.
 */
export function finalizeThinkingSource(
  message: ChatMessage,
  sourceKey: string,
  durationMs: number,
): ChatMessage {
  const parts = message.parts ?? [];
  const registry = cloneReasoningPartRegistry(message);

  let idx = -1;
  const partId = registry.get(sourceKey);
  if (partId) {
    idx = parts.findIndex((p) => p.id === partId && p.type === "reasoning");
  }
  if (idx < 0) {
    idx = parts.findIndex(
      (p) => p.type === "reasoning" && (p as ReasoningPart).thinkingSourceKey === sourceKey && p.isStreaming,
    );
  }
  if (idx < 0) {
    return message;
  }

  const updated = [...parts];
  updated[idx] = {
    ...(updated[idx] as ReasoningPart),
    isStreaming: false,
    durationMs,
  };
  registry.delete(sourceKey);

  const nextMessage: ChatMessage = { ...message, parts: updated };
  reasoningPartIdBySourceRegistry.set(nextMessage, registry);
  return nextMessage;
}

export function upsertThinkingMeta(
  message: ChatMessage,
  event: ThinkingMetaEvent,
): ChatMessage {
  if (!event.includeReasoningPart) {
    return carryReasoningPartRegistry(message, {
      ...message,
      thinkingMs: event.thinkingMs,
      thinkingText: event.thinkingText || undefined,
    });
  }

  let parts = [...(message.parts ?? [])];
  const registry = cloneReasoningPartRegistry(message);

  let existingIdx = -1;
  const existingPartId = registry.get(event.thinkingSourceKey);
  if (existingPartId) {
    existingIdx = parts.findIndex(
      (part) => part.id === existingPartId && part.type === "reasoning" && part.isStreaming,
    );
    if (existingIdx < 0) {
      registry.delete(event.thinkingSourceKey);
    }
  }

  if (existingIdx < 0) {
    existingIdx = parts.findIndex(
      (part) =>
        part.type === "reasoning" &&
        (part as ReasoningPart).thinkingSourceKey === event.thinkingSourceKey &&
        (part as ReasoningPart).isStreaming,
    );
    if (existingIdx >= 0) {
      registry.set(event.thinkingSourceKey, parts[existingIdx]!.id);
    }
  }

  if (existingIdx >= 0) {
    const existing = parts[existingIdx] as ReasoningPart;
    parts[existingIdx] = {
      ...existing,
      thinkingSourceKey: event.thinkingSourceKey,
      content: event.thinkingText,
      durationMs: event.thinkingMs,
      isStreaming: true,
    };
  } else if (event.thinkingText.trim().length > 0) {
    const reasoningPart: ReasoningPart = {
      id: createPartId(),
      type: "reasoning",
      thinkingSourceKey: event.thinkingSourceKey,
      content: event.thinkingText,
      durationMs: event.thinkingMs,
      isStreaming: true,
      createdAt: new Date().toISOString(),
    };
    parts = upsertPart(parts, reasoningPart);
    registry.set(event.thinkingSourceKey, reasoningPart.id);
  }

  const nextMessage: ChatMessage = {
    ...message,
    parts,
    thinkingMs: event.thinkingMs,
    thinkingText: event.thinkingText || undefined,
  };
  reasoningPartIdBySourceRegistry.set(nextMessage, registry);
  return nextMessage;
}

export function upsertThinkingMetaPart(
  parts: Part[],
  event: ThinkingMetaEvent,
): Part[] {
  if (!event.includeReasoningPart) {
    return parts;
  }

  const existingIdx = parts.findIndex(
    (part) =>
      part.type === "reasoning" &&
      (part as ReasoningPart).thinkingSourceKey === event.thinkingSourceKey,
  );

  if (existingIdx >= 0) {
    const existing = parts[existingIdx] as ReasoningPart;
    const updated = [...parts];
    updated[existingIdx] = {
      ...existing,
      thinkingSourceKey: event.thinkingSourceKey,
      content: event.thinkingText,
      durationMs: event.thinkingMs,
      isStreaming: true,
    };
    return updated;
  }

  if (event.thinkingText.trim().length === 0) {
    return parts;
  }

  const reasoningPart: ReasoningPart = {
    id: createPartId(),
    type: "reasoning",
    thinkingSourceKey: event.thinkingSourceKey,
    content: event.thinkingText,
    durationMs: event.thinkingMs,
    isStreaming: true,
    createdAt: new Date().toISOString(),
  };
  return upsertPart(parts, reasoningPart);
}
