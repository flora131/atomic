/**
 * Handler descriptors for stream.text.delta and stream.text.complete events.
 *
 * Registers coalescing keys, stream-part mappers, and stale predicates
 * for text-related bus events into the global EventHandlerRegistry.
 */

import type { BusEventDataMap } from "@/services/events/bus-events/index.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { EventHandlerDescriptor } from "@/services/events/registry/types.ts";

const textDeltaDescriptor: EventHandlerDescriptor<"stream.text.delta"> = {
  // Text deltas are additive — never coalesced
  coalescingKey: () => undefined,
  staleKey: (event) => `text.delta:${event.sessionId}:${event.data.messageId}`,

  toStreamPart: (event, context) => {
    const data = event.data as BusEventDataMap["stream.text.delta"];

    // Agent-scoped deltas bypass echo suppression
    if (data.agentId) {
      return { type: "text-delta", runId: event.runId, delta: data.delta, agentId: data.agentId };
    }

    // Filter through echo suppression
    const filtered = context.filterDelta(data.delta);
    if (!filtered) return null;
    return { type: "text-delta", runId: event.runId, delta: filtered };
  },
};

const textCompleteDescriptor: EventHandlerDescriptor<"stream.text.complete"> = {
  coalescingKey: (event) => {
    const data = event.data as BusEventDataMap["stream.text.complete"];
    return `text.complete:${data.messageId}`;
  },
  supersedesStaleKey: (event) => `text.delta:${event.sessionId}:${event.data.messageId}`,

  toStreamPart: (event) => {
    const data = event.data as BusEventDataMap["stream.text.complete"];
    if (!data.fullText) return null;
    return { type: "text-complete", runId: event.runId, fullText: data.fullText, messageId: data.messageId };
  },

  isStale: (event, latest) => event.timestamp < latest.timestamp,
};

// ── Registration ────────────────────────────────────────────────────────────

const registry = getEventHandlerRegistry();
registry.register("stream.text.delta", textDeltaDescriptor);
registry.register("stream.text.complete", textCompleteDescriptor);
