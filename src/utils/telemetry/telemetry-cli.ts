/**
 * CLI telemetry module for tracking Atomic command usage
 *
 * Provides:
 * - trackAtomicCommand() for tracking init, update, uninstall, run commands
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
  CliCommandEvent,
} from "./types";
import { VERSION } from "../../version";
import { ATOMIC_COMMANDS } from "./constants";
import { appendEvent, getEventsFilePath } from "./telemetry-file-io";
import { handleTelemetryError } from "./telemetry-errors";

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
 * Extract Atomic slash commands from CLI arguments.
 * Used to identify which commands were passed to the agent.
 *
 * @param args - The CLI arguments array (e.g., ['/research-codebase', 'src/'])
 * @returns Array of unique slash commands found in args
 *
 * @example
 * extractCommandsFromArgs(['/research-codebase', 'src/'])
 * // Returns: ['/research-codebase']
 *
 * @example
 * extractCommandsFromArgs(['/commit', '/create-gh-pr'])
 * // Returns: ['/commit', '/create-gh-pr']
 */
export function extractCommandsFromArgs(args: string[]): string[] {
  const foundCommands: string[] = [];

  for (const arg of args) {
    for (const cmd of ATOMIC_COMMANDS) {
      // Exact match or prefix match (command followed by space and args)
      if (arg === cmd || arg.startsWith(cmd + " ")) {
        foundCommands.push(cmd);
        break; // Only match one command per arg
      }
    }
  }

  // Return deduplicated array
  return [...new Set(foundCommands)];
}

// appendEvent moved to telemetry-file-io.ts to avoid duplication

/**
 * Track an Atomic CLI command execution.
 *
 * This function should be called when init, update, uninstall, or run commands
 * are executed. It logs an event to the local telemetry buffer if telemetry
 * is enabled.
 *
 * @param command - The command being executed ('init', 'update', 'uninstall', 'run')
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
 * // Track run command with opencode agent
 * trackAtomicCommand('run', 'opencode', true);
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

/**
 * Track CLI invocation with slash commands.
 *
 * This function should be called before spawning the agent process when
 * CLI args contain slash commands. It logs a CliCommandEvent to the local
 * telemetry buffer if telemetry is enabled and commands are found.
 *
 * @param agentType - The agent type being invoked ('claude', 'opencode', 'copilot')
 * @param args - The CLI arguments passed to the agent
 *
 * @example
 * // Track CLI invocation with research command
 * trackCliInvocation('claude', ['/research-codebase', 'src/']);
 *
 * @example
 * // Track CLI invocation with multiple commands
 * trackCliInvocation('claude', ['/commit', '-m', 'fix bug']);
 */
export function trackCliInvocation(agentType: AgentType, args: string[]): void {
  // Return early (no-op) if telemetry is disabled
  if (!isTelemetryEnabledSync()) {
    return;
  }

  // Extract slash commands from args
  const commands = extractCommandsFromArgs(args);

  // Don't log events with no commands
  if (commands.length === 0) {
    return;
  }

  // Create the event using the factory pattern
  const baseFields = createBaseEvent();
  const event: CliCommandEvent = {
    ...baseFields,
    eventType: "cli_command",
    agentType,
    commands,
    commandCount: commands.length,
  };

  // Write to JSONL buffer
  appendEvent(event, agentType);
}
