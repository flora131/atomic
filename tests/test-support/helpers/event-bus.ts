/**
 * EventBus test helpers.
 *
 * Provides utilities for creating isolated EventBus instances,
 * collecting events, awaiting specific events, and flushing
 * batched dispatches in tests.
 */

import {
  EventBus,
  type InternalBusError,
} from "@/services/events/event-bus.ts";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import type {
  BusEvent,
  BusEventType,
} from "@/services/events/bus-events/types.ts";

// ---------------------------------------------------------------------------
// Tracked bus — wraps EventBus with observability for tests
// ---------------------------------------------------------------------------

export interface TrackedEventBus extends EventBus {
  /** All events published through the bus, in order. */
  readonly publishedEvents: ReadonlyArray<BusEvent>;
  /** All internal errors emitted by the bus. */
  readonly internalErrors: ReadonlyArray<InternalBusError>;
  /** Clear the tracked events and errors without clearing handlers. */
  resetTracking(): void;
  /** Tear down all handlers and tracking state. */
  destroy(): void;
}

/**
 * Creates an isolated EventBus suitable for testing.
 *
 * The returned bus tracks every published event and every internal error
 * so tests can assert on the full event history. Schema validation is
 * enabled by default to catch contract violations early.
 *
 * @param options.validatePayloads - Whether to enable Zod schema validation (default: true)
 * @returns A TrackedEventBus with observability extensions
 *
 * @example
 * ```ts
 * const bus = createTestEventBus();
 * bus.publish(createTextDeltaEvent());
 * expect(bus.publishedEvents).toHaveLength(1);
 * bus.destroy();
 * ```
 */
export function createTestEventBus(options?: {
  validatePayloads?: boolean;
}): TrackedEventBus {
  const bus = new EventBus({
    validatePayloads: options?.validatePayloads ?? true,
  });

  const publishedEvents: BusEvent[] = [];
  const internalErrors: InternalBusError[] = [];

  // Track all events via wildcard handler
  const unsubAll = bus.onAll((event) => {
    publishedEvents.push(event);
  });

  // Track internal errors
  const unsubErrors = bus.onInternalError((error) => {
    internalErrors.push(error);
  });

  // Extend the bus with tracking capabilities
  const tracked = bus as TrackedEventBus;
  Object.defineProperty(tracked, "publishedEvents", {
    get: () => publishedEvents as ReadonlyArray<BusEvent>,
    configurable: true,
  });
  Object.defineProperty(tracked, "internalErrors", {
    get: () => internalErrors as ReadonlyArray<InternalBusError>,
    configurable: true,
  });

  tracked.resetTracking = () => {
    publishedEvents.length = 0;
    internalErrors.length = 0;
  };

  tracked.destroy = () => {
    unsubAll();
    unsubErrors();
    bus.clear();
    publishedEvents.length = 0;
    internalErrors.length = 0;
  };

  return tracked;
}

// ---------------------------------------------------------------------------
// Event collector
// ---------------------------------------------------------------------------

export interface EventCollector<T extends BusEventType> {
  /** All collected events, in order. */
  readonly events: ReadonlyArray<BusEvent<T>>;
  /** Unsubscribe the collector from the bus. */
  unsubscribe(): void;
  /** Clear collected events without unsubscribing. */
  clear(): void;
}

/**
 * Subscribes to the bus and collects dispatched events into an array.
 *
 * If `eventType` is provided, only events of that type are collected.
 * Otherwise a wildcard subscription collects all events.
 *
 * @param bus - The EventBus to subscribe to
 * @param eventType - Optional event type filter
 * @returns A collector with .events array, .unsubscribe(), and .clear()
 *
 * @example
 * ```ts
 * // Collect specific type
 * const collector = collectEvents(bus, "stream.text.delta");
 * bus.publish(createTextDeltaEvent());
 * expect(collector.events).toHaveLength(1);
 * collector.unsubscribe();
 *
 * // Collect all events
 * const all = collectEvents(bus);
 * ```
 */
export function collectEvents<T extends BusEventType>(
  bus: EventBus,
  eventType: T,
): EventCollector<T>;
export function collectEvents(
  bus: EventBus,
): EventCollector<BusEventType>;
export function collectEvents<T extends BusEventType>(
  bus: EventBus,
  eventType?: T,
): EventCollector<T> {
  const events: BusEvent<T>[] = [];
  const unsubscribe = eventType
    ? bus.on(eventType, (event) => {
        events.push(event as BusEvent<T>);
      })
    : bus.onAll((event) => {
        events.push(event as BusEvent<T>);
      });

  return {
    get events() {
      return events as ReadonlyArray<BusEvent<T>>;
    },
    unsubscribe,
    clear() {
      events.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Wait for event
// ---------------------------------------------------------------------------

/**
 * Returns a promise that resolves when the next event of the specified type
 * is published on the bus.
 *
 * If no event fires within the timeout, the promise rejects with an error.
 *
 * @param bus - The EventBus to listen on
 * @param eventType - The event type to wait for
 * @param timeoutMs - Maximum wait time in milliseconds (default: 5000)
 * @returns Promise resolving to the matching BusEvent
 *
 * @example
 * ```ts
 * const promise = waitForEvent(bus, "stream.session.idle");
 * bus.publish(createSessionIdleEvent());
 * const event = await promise;
 * ```
 */
export function waitForEvent<T extends BusEventType>(
  bus: EventBus,
  eventType: T,
  timeoutMs = 5000,
): Promise<BusEvent<T>> {
  return new Promise<BusEvent<T>>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`waitForEvent("${eventType}") timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = bus.on(eventType, (event) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

// ---------------------------------------------------------------------------
// Flush helpers
// ---------------------------------------------------------------------------

/**
 * Creates a BatchDispatcher for the given bus with a very short flush
 * interval (0ms) and immediately flushes any pending events.
 *
 * If you are using a BatchDispatcher in your test, pass it directly
 * and call this to trigger a synchronous flush.
 *
 * @param busOrDispatcher - An EventBus (creates a temporary dispatcher) or an existing BatchDispatcher
 * @returns The dispatcher that was flushed (useful if a new one was created)
 *
 * @example
 * ```ts
 * const dispatcher = new BatchDispatcher(bus, 0);
 * dispatcher.enqueue(createTextDeltaEvent());
 * flushEvents(dispatcher);
 * ```
 */
export function flushEvents(busOrDispatcher: EventBus | BatchDispatcher): void {
  if (busOrDispatcher instanceof BatchDispatcher) {
    busOrDispatcher.flush();
  } else {
    // EventBus publishes synchronously, nothing to flush.
    // This is a no-op for plain EventBus — useful as a semantic signal
    // that the caller expected batched dispatch but is using the bus directly.
  }
}

/**
 * Alias for `flushEvents` — flush any pending batched dispatches.
 *
 * When given a BatchDispatcher, calls `.flush()` synchronously.
 * When given a plain EventBus, this is a no-op since `publish()` is synchronous.
 *
 * @param busOrDispatcher - An EventBus or BatchDispatcher to drain
 */
export const drainEvents = flushEvents;
