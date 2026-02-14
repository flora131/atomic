/**
 * CLI telemetry module for tracking Atomic command usage
 *
 * Provides:
 * - trackAtomicCommand() for tracking init, update, uninstall, chat commands
 * - JSONL event buffering to telemetry-events.jsonl
 * - Fail-safe, non-blocking operation (telemetry never breaks CLI)
 *
 * Reference: Spec Section 5.3.1
 */

import { isTelemetryEnabledSync, getOrCreateTelemetryState } from "./telemetry";
import type {
  AtomicCommandEvent,
  AtomicCommandType,
  AgentType,
} from "./types";
import { VERSION } from "../version";
import { appendEvent, getEventsFilePath } from "./telemetry-file-io";

// Re-export for backward compatibility
export { getEventsFilePath } from "./telemetry-file-io";

// getEventsFilePath moved to telemetry-file-io.ts and re-exported above

/**
 * Base event fields that are common to all telemetry events.
 * Used by the factory function to reduce duplication.
 */
interface BaseEventFields {
  anonymousId: string;
  eventId: string;
  timestamp: string;
  platform: NodeJS.Platform;
  atomicVersion: string;
  source: "cli";
}

/**
 * Create base event fields for telemetry events.
 * Factory function that generates common fields to reduce duplication.
 *
 * @returns Base event fields including anonymousId, eventId, timestamp, platform, version, source
 */
function createBaseEvent(): BaseEventFields {
  const state = getOrCreateTelemetryState();
  return {
    anonymousId: state.anonymousId,
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    platform: process.platform,
    atomicVersion: VERSION,
    source: "cli",
  };
}

/**
 * Track an Atomic CLI command execution.
 *
 * This function should be called when init, update, uninstall, or chat commands
 * are executed. It logs an event to the local telemetry buffer if telemetry
 * is enabled.
 *
 * @param command - The command being executed ('init', 'update', 'uninstall', 'chat')
 * @param agentType - The agent type if applicable (null for agent-agnostic commands)
 * @param success - Whether the command succeeded (defaults to true)
 *
 * @example
 * // Track successful init with claude agent
 * trackAtomicCommand('init', 'claude', true);
 *
 * @example
 * // Track failed update (no agent)
 * trackAtomicCommand('update', null, false);
 *
 * @example
 * // Track chat command with opencode agent
 * trackAtomicCommand('chat', 'opencode', true);
 */
export function trackAtomicCommand(
  command: AtomicCommandType,
  agentType: AgentType | null,
  success: boolean = true
): void {
  // Return early (no-op) if telemetry is disabled
  if (!isTelemetryEnabledSync()) {
    return;
  }

  // Create the event using the factory pattern
  const baseFields = createBaseEvent();
  const event: AtomicCommandEvent = {
    ...baseFields,
    eventType: "atomic_command",
    command,
    agentType,
    success,
  };

  // Write to JSONL buffer
  appendEvent(event, agentType);
}
