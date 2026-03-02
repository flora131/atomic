/**
 * Base Client Utilities for CodingAgentClient Implementations
 *
 * This module provides shared utilities and patterns used across all
 * agent-specific client implementations (Claude, OpenCode, Copilot).
 *
 * Common patterns extracted:
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
  AgentEvent,
} from "./types.ts";

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
