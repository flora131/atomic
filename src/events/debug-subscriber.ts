/**
 * Debug Event Subscriber
 *
 * This module provides debug logging functionality for the event bus.
 * When ATOMIC_DEBUG=1 environment variable is set, all events flowing through
 * the bus are logged to the console for debugging and troubleshooting.
 *
 * Usage:
 * ```typescript
 * const bus = new AtomicEventBus();
 * const cleanup = attachDebugSubscriber(bus);
 *
 * // Events will now be logged to console if ATOMIC_DEBUG=1
 *
 * // Later, cleanup
 * cleanup();
 * ```
 */

import type { AtomicEventBus } from "./event-bus.ts";
import type { BusEvent } from "./bus-events.ts";

/**
 * Attaches a debug subscriber to the event bus that logs all events
 * when ATOMIC_DEBUG=1 environment variable is set.
 *
 * The logger outputs:
 * - Event timestamp (ISO format)
 * - Event type
 * - Run ID for staleness tracking
 * - Preview of event data (first 100 characters)
 *
 * @param bus - The event bus to attach the debug subscriber to
 * @returns cleanup function to remove the subscriber
 *
 * @example
 * ```typescript
 * const bus = new AtomicEventBus();
 * const cleanup = attachDebugSubscriber(bus);
 *
 * bus.publish({
 *   type: "stream.text.delta",
 *   sessionId: "abc123",
 *   runId: 1,
 *   timestamp: Date.now(),
 *   data: { delta: "Hello", messageId: "msg1" }
 * });
 * // Output: [EventBus] 2024-01-15T10:30:45.123Z stream.text.delta runId=1 {"delta":"Hello","messageId":"msg1"}
 *
 * cleanup(); // Stop logging
 * ```
 */
export function attachDebugSubscriber(bus: AtomicEventBus): () => void {
  if (process.env.ATOMIC_DEBUG !== "1") {
    return () => {}; // no-op if debug not enabled
  }

  return bus.onAll((event: BusEvent) => {
    const timestamp = new Date(event.timestamp).toISOString();
    const preview = JSON.stringify(event.data).slice(0, 100);
    console.debug(
      `[EventBus] ${timestamp} ${event.type} runId=${event.runId} ${preview}`
    );
  });
}
