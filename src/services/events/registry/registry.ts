/**
 * Event Handler Registry
 *
 * A singleton registry holding per-BusEventType handler metadata (coalescing
 * key functions, stream-part mappers, stale-delta predicates). Consumers
 * look up handlers by event type instead of maintaining switch statements.
 *
 * Follows the existing ToolRegistry / ProviderRegistry singleton pattern.
 */

import type { BusEventType } from "@/services/events/bus-events/index.ts";
import type {
  CoalescingKeyFn,
  EventHandlerDescriptor,
  EventRegistration,
  StaleKeyFn,
  StalePredicate,
  StreamPartMapper,
} from "@/services/events/registry/types.ts";

export class EventHandlerRegistry {
  private handlers = new Map<BusEventType, EventHandlerDescriptor<BusEventType>>();

  /**
   * Register handler metadata for a single event type.
   *
   * @throws if a descriptor is already registered for the given event type
   */
  register<T extends BusEventType>(
    eventType: T,
    descriptor: EventHandlerDescriptor<T>,
  ): void {
    if (this.handlers.has(eventType)) {
      throw new Error(
        `EventHandlerRegistry: duplicate registration for "${eventType}"`,
      );
    }
    this.handlers.set(eventType, descriptor as EventHandlerDescriptor<BusEventType>);
  }

  /**
   * Register handler metadata for multiple event types at once.
   *
   * Useful for per-category handler modules that register a batch of
   * related event types in a single call.
   */
  registerBatch<T extends BusEventType>(registrations: EventRegistration<T>[]): void {
    const pendingTypes = new Set<BusEventType>();

    for (const { eventType } of registrations) {
      if (this.handlers.has(eventType) || pendingTypes.has(eventType)) {
        throw new Error(
          `EventHandlerRegistry: duplicate registration for "${eventType}"`,
        );
      }
      pendingTypes.add(eventType);
    }

    for (const { eventType, descriptor } of registrations) {
      this.handlers.set(eventType, descriptor as EventHandlerDescriptor<BusEventType>);
    }
  }

  /**
   * Look up the coalescing key function for a given event type.
   * Returns undefined if no coalescing key function is registered.
   */
  getCoalescingKeyFn<T extends BusEventType>(
    eventType: T,
  ): CoalescingKeyFn<T> | undefined {
    return this.handlers.get(eventType)?.coalescingKey as CoalescingKeyFn<T> | undefined;
  }

  /**
   * Look up the stream-part mapper for a given event type.
   * Returns undefined if no mapper is registered.
   */
  getStreamPartMapper<T extends BusEventType>(
    eventType: T,
  ): StreamPartMapper<T> | undefined {
    return this.handlers.get(eventType)?.toStreamPart as StreamPartMapper<T> | undefined;
  }

  /**
   * Look up the stale-delta predicate for a given event type.
   * Returns undefined if no predicate is registered.
   */
  getStalePredicate<T extends BusEventType>(
    eventType: T,
  ): StalePredicate<T> | undefined {
    return this.handlers.get(eventType)?.isStale as StalePredicate<T> | undefined;
  }

  /**
   * Look up the stale key function for a given event type.
   * Returns undefined if no stale key function is registered.
   */
  getStaleKeyFn<T extends BusEventType>(
    eventType: T,
  ): StaleKeyFn<T> | undefined {
    return this.handlers.get(eventType)?.staleKey as StaleKeyFn<T> | undefined;
  }

  /**
   * Look up the superseding stale key function for a given event type.
   * Returns undefined if no superseding stale key function is registered.
   */
  getSupersedingStaleKeyFn<T extends BusEventType>(
    eventType: T,
  ): StaleKeyFn<T> | undefined {
    return this.handlers.get(eventType)?.supersedesStaleKey as StaleKeyFn<T> | undefined;
  }

  /**
   * Check whether a descriptor is registered for a given event type.
   */
  has(eventType: BusEventType): boolean {
    return this.handlers.has(eventType);
  }

  /**
   * Return all event types that are NOT registered.
   *
   * Used by exhaustiveness tests to verify that every BusEventType
   * has a corresponding handler descriptor.
   */
  getUnregisteredTypes(allTypes: readonly BusEventType[]): BusEventType[] {
    return allTypes.filter((t) => !this.handlers.has(t));
  }

  /**
   * Return all registered event types.
   */
  getRegisteredTypes(): BusEventType[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clear all registered handlers.
   * Primarily used by tests to reset state between runs.
   */
  clear(): void {
    this.handlers.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalRegistry: EventHandlerRegistry | null = null;

export function getEventHandlerRegistry(): EventHandlerRegistry {
  if (!globalRegistry) {
    globalRegistry = new EventHandlerRegistry();
  }
  return globalRegistry;
}

export function setEventHandlerRegistry(registry: EventHandlerRegistry): void {
  globalRegistry = registry;
}
