import type { BusEvent, BusEventType } from "@/services/events/bus-events/index.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/index.ts";

/**
 * Generate a coalescing key for an event. Events with the same key
 * within a batching window will be coalesced (only latest retained).
 * Returns undefined for events that must never be coalesced (e.g., text deltas).
 */
export function coalescingKey<T extends BusEventType>(event: BusEvent<T>): string | undefined {
  const coalescingFn = getEventHandlerRegistry().getCoalescingKeyFn(event.type);
  return coalescingFn?.(event);
}
