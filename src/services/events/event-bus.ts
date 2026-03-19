/**
 * Event Bus Implementation
 *
 * This module provides the core event bus implementation for the streaming architecture.
 * The EventBus class manages type-safe pub/sub for all streaming events across
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
} from "@/services/events/bus-events/index.ts";
import { BusEventSchemas } from "@/services/events/bus-events/index.ts";
import { pipelineLog, pipelineError } from "@/services/events/pipeline-logger.ts";

/**
 * Internal error reported by the event bus itself.
 * These errors are not BusEvents — they represent failures in
 * event dispatch (schema validation, handler exceptions) that
 * would otherwise only go to console.error and be lost in TUI mode.
 */
export interface InternalBusError {
  /** Kind of internal error */
  kind: "schema_validation" | "handler_error" | "wildcard_handler_error" | "contract_violation";
  /** Event type that triggered the error */
  eventType: string;
  /** The error object */
  error: unknown;
  /** Event data that caused the error (included for schema_validation) */
  eventData?: unknown;
}

export type InternalErrorHandler = (error: InternalBusError) => void;

export interface EventBusOptions {
  /**
   * Enable runtime payload validation with Zod before dispatch.
   * Keep enabled for tests/debugging; disable in the TUI hot path for performance.
   */
  validatePayloads?: boolean;
}

/**
 * Core event bus for the streaming architecture.
 *
 * Manages typed pub/sub for all streaming events from SDK adapters and workflows.
 * Provides type safety, wildcard subscriptions, and error isolation between handlers.
 *
 * Usage:
 * ```typescript
 * const bus = new EventBus();
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
export class EventBus {
  private handlers = new Map<BusEventType, Set<BusHandler<BusEventType>>>();
  private wildcardHandlers = new Set<WildcardHandler>();
  private internalErrorHandlers = new Set<InternalErrorHandler>();
  private validatePayloads: boolean;

  constructor(options: EventBusOptions = {}) {
    this.validatePayloads = options.validatePayloads ?? true;
  }

  /**
   * Subscribe to internal bus errors (schema drops, handler exceptions).
   *
   * These errors are normally only logged to console.error and lost
   * when running inside a TUI. This callback enables the debug subscriber
   * to write them to the JSONL log file.
   *
   * @param handler - Callback invoked on each internal error
   * @returns Unsubscribe function
   */
  onInternalError(handler: InternalErrorHandler): () => void {
    this.internalErrorHandlers.add(handler);
    return () => {
      this.internalErrorHandlers.delete(handler);
    };
  }

  private emitInternalError(error: InternalBusError): void {
    for (const handler of this.internalErrorHandlers) {
      try {
        handler(error);
      } catch {
        // Swallow to avoid infinite recursion
      }
    }
  }

  /**
   * Report an application-level error through the internal error channel.
   *
   * Unlike schema/handler errors which are detected by the bus itself,
   * this allows external code (e.g., contract violation detectors) to
   * emit errors that get captured by the debug subscriber's JSONL log.
   *
   * @param error - The error to report
   */
  reportError(error: InternalBusError): void {
    this.emitInternalError(error);
  }

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
      if (set && set.size === 0) {
        this.handlers.delete(type);
      }
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
    const handlers = this.handlers.get(event.type);
    const hasTypedHandlers = handlers !== undefined && handlers.size > 0;
    const hasWildcardHandlers = this.wildcardHandlers.size > 0;
    if (!hasTypedHandlers && !hasWildcardHandlers) {
      return;
    }

    // Validate event data with Zod schema before dispatch
    const schema = this.validatePayloads ? BusEventSchemas[event.type] : undefined;
    if (schema) {
      try {
        schema.parse(event.data);
      } catch (error) {
        pipelineError("EventBus", "schema_drop", { type: event.type });
        console.error(`[EventBus] Schema validation failed for ${event.type}:`, error);
        // DEBUG: Log the actual event data that failed validation
        if (event.type.startsWith("stream.tool.")) {
          console.error(`[EventBus] Rejected tool event data:`, JSON.stringify(event.data));
        }
        this.emitInternalError({
          kind: "schema_validation",
          eventType: event.type,
          error,
          eventData: event.data,
        });
        return;
      }
    }

    // Dispatch to typed handlers
    if (hasTypedHandlers && handlers) {
      for (const handler of handlers) {
        try {
          handler(event as BusEvent<BusEventType>);
        } catch (error) {
          pipelineError("EventBus", "handler_error", { type: event.type });
          console.error(`[EventBus] Error in handler for ${event.type}:`, error);
          this.emitInternalError({
            kind: "handler_error",
            eventType: event.type,
            error,
          });
        }
      }
    }

    // Dispatch to wildcard handlers
    for (const handler of this.wildcardHandlers) {
      try {
        handler(event);
      } catch (error) {
        pipelineError("EventBus", "wildcard_handler_error", { type: event.type });
        console.error(`[EventBus] Error in wildcard handler:`, error);
        this.emitInternalError({
          kind: "wildcard_handler_error",
          eventType: event.type,
          error,
        });
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
