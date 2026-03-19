/**
 * Type definitions for the Event Handler Registry.
 *
 * These types define the per-event-type handler metadata that replaces
 * imperative switch statements in the consumer pipeline (coalescing,
 * stream-part mapping, stale-delta filtering) with a declarative
 * registry pattern.
 */

import type { BusEvent, BusEventType, EnrichedBusEvent } from "@/services/events/bus-events/index.ts";
import type { StreamPartEvent } from "@/state/streaming/pipeline-types.ts";

/**
 * Context provided to StreamPartMapper functions.
 *
 * Encapsulates services that mappers may need (e.g., echo suppression)
 * without coupling individual mappers to concrete service classes.
 */
export interface StreamPartContext {
  /** Filter text deltas through echo suppression. Returns filtered text or null if suppressed. */
  filterDelta: (delta: string) => string | null;
}

/**
 * Type-safe coalescing key function for a specific BusEventType.
 *
 * Events with the same coalescing key within a batching window are
 * coalesced (only the latest is retained). Returns undefined for
 * events that must never be coalesced (e.g., additive text deltas).
 */
export type CoalescingKeyFn<T extends BusEventType> = (
  event: BusEvent<T>,
) => string | undefined;

/**
 * Type-safe BusEvent-to-StreamPartEvent mapper for a specific BusEventType.
 *
 * Returns a single event, multiple events (e.g., workflow.task.update
 * emits both task-list-update and task-result-upsert), or null when
 * the event is consumed by hooks and should not reach the UI reducer.
 */
export type StreamPartMapper<T extends BusEventType> = (
  event: EnrichedBusEvent & { type: T },
  context: StreamPartContext,
) => StreamPartEvent | StreamPartEvent[] | null;

/**
 * Type-safe stale-delta predicate for a specific BusEventType.
 *
 * Determines whether an older event should be discarded in favor of a
 * newer event of the same type within the batching window. Used by
 * BatchDispatcher for stale-delta filtering.
 */
export type StalePredicate<T extends BusEventType> = (
  event: BusEvent<T>,
  latest: BusEvent<T>,
) => boolean;

/**
 * Type-safe stale key function for a specific BusEventType.
 *
 * Returns a stable identifier for events that may be filtered when a newer
 * snapshot in the same batch supersedes them.
 */
export type StaleKeyFn<T extends BusEventType> = (
  event: BusEvent<T>,
) => string | undefined;

/**
 * Handler metadata for a single BusEventType.
 *
 * All fields are optional — events that don't need coalescing,
 * stream-part mapping, or stale-delta filtering simply omit
 * those handlers. This keeps registration lightweight for simple
 * event types (e.g., session info, warnings).
 */
export interface EventHandlerDescriptor<T extends BusEventType> {
  /** Coalescing key function — replaces a coalescingKey() switch case */
  coalescingKey?: CoalescingKeyFn<T>;
  /** StreamPart mapper — replaces a mapToStreamPart() switch case */
  toStreamPart?: StreamPartMapper<T>;
  /** Same-type stale predicate — used before replacing a coalesced event */
  isStale?: StalePredicate<T>;
  /** Key for events that may be filtered when superseded in the same batch */
  staleKey?: StaleKeyFn<T>;
  /** Key emitted by snapshot events that supersede earlier buffered events */
  supersedesStaleKey?: StaleKeyFn<T>;
}

/**
 * Type-safe registration entry pairing an event type with its descriptor.
 *
 * Used by category modules to declare handler metadata for a batch of
 * related event types in a single call.
 */
export type EventRegistration<T extends BusEventType> = {
  eventType: T;
  descriptor: EventHandlerDescriptor<T>;
};
