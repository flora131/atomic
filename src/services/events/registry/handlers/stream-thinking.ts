/**
 * Handler descriptors for stream.thinking.delta and stream.thinking.complete.
 *
 * Registers coalescing keys, stream-part mappers, and stale-delta predicates
 * for the thinking event category into the global EventHandlerRegistry.
 */

import type { BusEventDataMap } from "@/services/events/bus-events/index.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { EventHandlerDescriptor } from "@/services/events/registry/types.ts";

// ── stream.thinking.delta ────────────────────────────────────────────────────

const thinkingDelta: EventHandlerDescriptor<"stream.thinking.delta"> = {
  // Thinking deltas are additive — never coalesced
  coalescingKey: () => undefined,
  staleKey: (event) => `thinking.delta:${event.sessionId}:${event.data.sourceKey}`,

  toStreamPart: (event) => {
    const data = event.data as BusEventDataMap["stream.thinking.delta"];
    return [{
      type: "thinking-meta",
      runId: event.runId,
      thinkingSourceKey: data.sourceKey,
      targetMessageId: data.messageId,
      streamGeneration: 0,
      thinkingText: data.delta,
      thinkingMs: 0,
      ...(data.agentId ? { agentId: data.agentId } : {}),
    }];
  },
};

// ── stream.thinking.complete ─────────────────────────────────────────────────

const thinkingComplete: EventHandlerDescriptor<"stream.thinking.complete"> = {
  // No coalescing — each completion is unique per sourceKey
  coalescingKey: () => undefined,
  supersedesStaleKey: (event) => `thinking.delta:${event.sessionId}:${event.data.sourceKey}`,

  toStreamPart: (event) => {
    const data = event.data as BusEventDataMap["stream.thinking.complete"];
    return [{
      type: "thinking-complete",
      runId: event.runId,
      sourceKey: data.sourceKey,
      durationMs: data.durationMs,
      ...(data.agentId ? { agentId: data.agentId } : {}),
    }];
  },
};

// ── Registration ─────────────────────────────────────────────────────────────

const registry = getEventHandlerRegistry();
registry.register("stream.thinking.delta", thinkingDelta);
registry.register("stream.thinking.complete", thinkingComplete);
