/**
 * Event handler descriptor for the `stream.usage` event.
 *
 * Usage stats are coalesced per session (only the latest usage snapshot
 * within a batching window is retained). They are NOT mapped to a
 * StreamPartEvent — usage is consumed by direct bus subscriptions in the
 * UI layer (useStreamSessionSubscriptions).
 */

import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { EventHandlerDescriptor } from "@/services/events/registry/types.ts";

const descriptor: EventHandlerDescriptor<"stream.usage"> = {
  coalescingKey: (event) => `usage:${event.sessionId}`,
  toStreamPart: () => null,
};

getEventHandlerRegistry().register("stream.usage", descriptor);
