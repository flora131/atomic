/**
 * Base Client Utilities for CodingAgentClient Implementations
 *
 * This module provides shared utilities and patterns used across all
 * agent-specific client implementations (Claude, OpenCode, Copilot).
 *
 * Common patterns extracted:
 * - Event handler registration and dispatch
 * - Session state management helpers
 * - Agent event construction
 *
 * Agent-specific logic that SHOULD NOT be in this module:
 * - SDK-specific initialization (varies by SDK API)
 * - SDK-specific event mapping (each SDK has different event types)
 * - SDK-specific session wrapping (each SDK has different session APIs)
 * - Permission handling (varies by SDK permission models)
 */

import type {
  EventType,
  EventHandler,
  AgentEvent,
} from "./types.ts";

/**
 * Manages event handler registration and dispatch.
 *
 * This class extracts the common event handling pattern used across
 * all client implementations. Each client has agent-specific event
 * mapping logic, but the registration and dispatch mechanism is identical.
 */
export class EventEmitter {
  private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> = new Map();

  /**
   * Register an event handler for a specific event type.
   * @param eventType - The type of event to listen for
   * @param handler - Callback function to handle the event
   * @returns Function to unregister the handler
   */
  on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
    let handlers = this.eventHandlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventType, handlers);
    }

    handlers.add(handler as EventHandler<EventType>);

    return () => {
      handlers?.delete(handler as EventHandler<EventType>);
    };
  }

  /**
   * Emit an event to all registered handlers.
   *
   * Note: Agent-specific clients may extend this to also emit to
   * native SDK hooks (e.g., Claude's HookCallback system).
   *
   * @param eventType - Type of event to emit
   * @param sessionId - Session that emitted this event
   * @param data - Event-specific data
   */
  emit<T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>
  ): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers) return;

    const event: AgentEvent<T> = {
      type: eventType,
      sessionId,
      timestamp: new Date().toISOString(),
      data: data as AgentEvent<T>["data"],
    };

    for (const handler of handlers) {
      try {
        handler(event as AgentEvent<EventType>);
      } catch (error) {
        console.error(`Error in event handler for ${eventType}:`, error);
      }
    }
  }

  /**
   * Clear all registered event handlers.
   * Called during client shutdown.
   */
  clearHandlers(): void {
    this.eventHandlers.clear();
  }

  /**
   * Check if any handlers are registered for an event type.
   */
  hasHandlers(eventType: EventType): boolean {
    const handlers = this.eventHandlers.get(eventType);
    return handlers !== undefined && handlers.size > 0;
  }
}

/**
 * Creates a standardized AgentEvent object.
 *
 * Helper for agent-specific clients to construct events with
 * consistent structure.
 *
 * @param eventType - Type of the event
 * @param sessionId - Session that emitted this event
 * @param data - Event-specific data
 */
export function createAgentEvent<T extends EventType>(
  eventType: T,
  sessionId: string,
  data: Record<string, unknown>
): AgentEvent<T> {
  return {
    type: eventType,
    sessionId,
    timestamp: new Date().toISOString(),
    data: data as AgentEvent<T>["data"],
  };
}

/**
 * Client state management utilities.
 *
 * Common state patterns:
 * - Running state tracking
 * - Session lifecycle management
 */
export interface ClientState {
  isRunning: boolean;
}

/**
 * Validates that a client is in a running state before operations.
 * @throws Error if client is not running
 */
export function requireRunning(state: ClientState, operation: string): void {
  if (!state.isRunning) {
    throw new Error(`Client not started. Call start() first. (operation: ${operation})`);
  }
}
