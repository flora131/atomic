/**
 * Handler descriptors for stream turn lifecycle events.
 *
 * Covers:
 * - stream.turn.start — marks the beginning of an assistant turn
 * - stream.turn.end   — marks the end of an assistant turn (with optional finish reason)
 *
 * Both events are consumed by direct bus subscriptions in the UI layer
 * (useStreamSessionSubscriptions) and are intentionally NOT mapped to
 * StreamPartEvents. No coalescing is needed since each turn boundary
 * is a unique, non-replaceable lifecycle signal.
 */

import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { EventRegistration } from "@/services/events/registry/types.ts";

export const turnLifecycleRegistrations: EventRegistration<
  "stream.turn.start" | "stream.turn.end"
>[] = [
  {
    eventType: "stream.turn.start",
    descriptor: {
      // No coalescing — each turn start is a unique lifecycle event
      // No stream-part mapper — consumed by direct bus subscriptions
    },
  },
  {
    eventType: "stream.turn.end",
    descriptor: {
      // No coalescing — each turn end is a unique lifecycle event
      // No stream-part mapper — consumed by direct bus subscriptions
    },
  },
];

getEventHandlerRegistry().registerBatch(turnLifecycleRegistrations);
