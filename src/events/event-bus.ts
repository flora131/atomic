/**
 * Event Bus Implementation
 *
 * This module provides the core event bus implementation for the streaming architecture.
 * The AtomicEventBus class manages type-safe pub/sub for all streaming events across
 * multiple SDK adapters and workflow nodes.
 *
 * Key features:
 * - Type-safe event publishing and subscription
 * - Support for wildcard subscriptions (subscribe to all events)
 * - Error isolation (handler errors don't break publishers)
 * - Efficient handler management with automatic cleanup
 */

import type {
  BusEvent,
  BusEventType,
  BusHandler,
  WildcardHandler,
} from "./bus-events.ts";
import { BusEventSchemas } from "./bus-events.ts";
import { pipelineLog } from "./pipeline-logger.ts";

/**
 * Core event bus for the streaming architecture.
 *
 * Manages typed pub/sub for all streaming events from SDK adapters and workflows.
 * Provides type safety, wildcard subscriptions, and error isolation between handlers.
 *
 * Usage:
 * ```typescript
 * const bus = new AtomicEventBus();
 *
 * // Subscribe to specific event type
 * const unsubscribe = bus.on("stream.text.delta", (event) => {
 *   console.log(event.data.delta);
 * });
 *
 * // Subscribe to all events
 * const unsubscribeAll = bus.onAll((event) => {
 *   console.log(`[${event.type}]`, event.data);
 * });
 *
 * // Publish an event
 * bus.publish({
 *   type: "stream.text.delta",
 *   sessionId: "abc123",
 *   runId: 1,
 *   timestamp: Date.now(),
 *   data: { delta: "Hello", messageId: "msg1" }
 * });
 *
 * // Cleanup
 * unsubscribe();
 * unsubscribeAll();
 * ```
 */
export class AtomicEventBus {
  private handlers = new Map<BusEventType, Set<BusHandler<BusEventType>>>();
  private wildcardHandlers = new Set<WildcardHandler>();

  /**
   * Subscribe to a specific event type.
   *
   * Returns an unsubscribe function that removes the handler when called.
   *
   * @param type - The event type to subscribe to
   * @param handler - Callback function to handle the event
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = bus.on("stream.tool.start", (event) => {
   *   console.log(`Tool started: ${event.data.toolName}`);
   * });
   *
   * // Later, cleanup
   * unsubscribe();
   * ```
   */
  on<T extends BusEventType>(type: T, handler: BusHandler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as BusHandler<BusEventType>);
    return () => {
      set?.delete(handler as BusHandler<BusEventType>);
    };
  }

  /**
   * Subscribe to all events (wildcard subscription).
   *
   * Useful for debugging, logging, and observability.
   * Returns an unsubscribe function that removes the handler when called.
   *
   * @param handler - Callback function to handle all events
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = bus.onAll((event) => {
   *   console.log(`[${event.type}] at ${event.timestamp}`, event.data);
   * });
   * ```
   */
  onAll(handler: WildcardHandler): () => void {
    this.wildcardHandlers.add(handler);
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }

  /**
   * Publish an event to all matching subscribers.
   *
   * Dispatches the event to:
   * 1. All handlers subscribed to the specific event type
   * 2. All wildcard handlers subscribed to all events
   *
   * Handler errors are caught and logged to prevent breaking the publisher.
   * This ensures that one broken handler doesn't affect other handlers or the event source.
   *
   * @param event - The event to publish
   *
   * @example
   * ```typescript
   * bus.publish({
   *   type: "stream.text.delta",
   *   sessionId: "abc123",
   *   runId: 1,
   *   timestamp: Date.now(),
   *   data: { delta: "Hello", messageId: "msg1" }
   * });
   * ```
   */
  publish<T extends BusEventType>(event: BusEvent<T>): void {
    // Validate event data with Zod schema before dispatch
    const schema = BusEventSchemas[event.type];
    if (schema) {
      try {
        schema.parse(event.data);
      } catch (error) {
        pipelineLog("EventBus", "schema_drop", { type: event.type });
        console.error(`[EventBus] Schema validation failed for ${event.type}:`, error);
        // DEBUG: Log the actual event data that failed validation
        if (event.type.startsWith("stream.tool.")) {
          console.error(`[EventBus] Rejected tool event data:`, JSON.stringify(event.data));
        }
        return;
      }
    }

    // Dispatch to typed handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event as BusEvent<BusEventType>);
        } catch (error) {
          pipelineLog("EventBus", "handler_error", { type: event.type });
          console.error(`[EventBus] Error in handler for ${event.type}:`, error);
        }
      }
    }

    // Dispatch to wildcard handlers
    for (const handler of this.wildcardHandlers) {
      try {
        handler(event);
      } catch (error) {
        pipelineLog("EventBus", "wildcard_handler_error", { type: event.type });
        console.error(`[EventBus] Error in wildcard handler:`, error);
      }
    }
  }

  /**
   * Remove all handlers and reset bus state.
   *
   * Useful for cleanup in tests or when shutting down the application.
   *
   * @example
   * ```typescript
   * bus.clear();
   * ```
   */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }

  /**
   * Check if any handlers are registered for a specific event type.
   *
   * Does not count wildcard handlers.
   *
   * @param type - The event type to check
   * @returns True if handlers are registered for this type
   *
   * @example
   * ```typescript
   * if (bus.hasHandlers("stream.tool.start")) {
   *   console.log("Tool start handlers are registered");
   * }
   * ```
   */
  hasHandlers(type: BusEventType): boolean {
    const handlers = this.handlers.get(type);
    return handlers !== undefined && handlers.size > 0;
  }

  /**
   * Get total count of registered handlers (typed + wildcard).
   *
   * Useful for debugging and monitoring.
   *
   * @returns Total number of registered handlers
   *
   * @example
   * ```typescript
   * console.log(`Total handlers: ${bus.handlerCount}`);
   * ```
   */
  get handlerCount(): number {
    let count = this.wildcardHandlers.size;
    for (const set of this.handlers.values()) {
      count += set.size;
    }
    return count;
  }
}
