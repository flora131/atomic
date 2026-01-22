/**
 * Session telemetry module for tracking agent session usage
 *
 * Provides:
 * - extractCommandsFromTranscript() for extracting slash commands from transcripts
 * - createSessionEvent() factory for creating AgentSessionEvent objects
 * - trackAgentSession() for logging session events from hooks
 *
 * Reference: Spec Section 5.3.3
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { getBinaryDataDir } from "../config-path";
import { isTelemetryEnabledSync, getOrCreateTelemetryState } from "./telemetry";
import type { AgentSessionEvent, AgentType, TelemetryEvent } from "./types";
import { VERSION } from "../../version";
import { ATOMIC_COMMANDS } from "./constants";

/**
 * Extract Atomic slash commands from a transcript string.
 * Used to identify which commands were used during an agent session.
 * Counts all occurrences to track actual usage frequency.
 *
 * @param transcript - The transcript text from the agent session
 * @returns Array of slash commands found (includes duplicates for usage tracking)
 *
 * @example
 * extractCommandsFromTranscript('User ran /research-codebase src/')
 * // Returns: ['/research-codebase']
 *
 * @example
 * extractCommandsFromTranscript('First /commit then another /commit')
 * // Returns: ['/commit', '/commit']
 *
 * @example
 * extractCommandsFromTranscript('/ralph:ralph-loop was started')
 * // Returns: ['/ralph:ralph-loop']
 */
export function extractCommandsFromTranscript(transcript: string): string[] {
  const foundCommands: string[] = [];

  for (const cmd of ATOMIC_COMMANDS) {
    // Escape special regex characters in command (e.g., the colon in namespaced commands)
    const escapedCmd = cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match command at word boundary (start of line, after space, etc.)
    // Followed by end of string, whitespace, or non-word character
    const regex = new RegExp(`(?:^|\\s|[^\\w/])${escapedCmd}(?:\\s|$|[^\\w-:])`, "g");

    // Count all occurrences of this command (for usage frequency tracking)
    const matches = transcript.match(regex);
    if (matches) {
      for (let i = 0; i < matches.length; i++) {
        foundCommands.push(cmd);
      }
    }
  }

  return foundCommands;
}

/**
 * Create an AgentSessionEvent with all required fields.
 * Factory function that generates a complete session event object.
 *
 * @param agentType - The agent type ('claude', 'opencode', 'copilot')
 * @param commands - Array of slash commands used during the session
 * @param sessionStartedAt - Optional ISO 8601 timestamp when session started
 * @returns A fully-formed AgentSessionEvent object
 *
 * @example
 * const event = createSessionEvent('claude', ['/commit', '/create-gh-pr']);
 * // Returns AgentSessionEvent with generated sessionId, timestamp, etc.
 *
 * @example
 * const event = createSessionEvent('opencode', ['/research-codebase'], '2024-01-15T10:30:00Z');
 * // Returns AgentSessionEvent with provided sessionStartedAt
 */
export function createSessionEvent(
  agentType: AgentType,
  commands: string[],
  sessionStartedAt?: string
): AgentSessionEvent {
  const state = getOrCreateTelemetryState();
  const sessionId = crypto.randomUUID();

  return {
    anonymousId: state.anonymousId,
    eventId: sessionId,
    sessionId,
    eventType: "agent_session",
    timestamp: new Date().toISOString(),
    sessionStartedAt: sessionStartedAt ?? null,
    agentType,
    commands,
    commandCount: commands.length,
    platform: process.platform,
    atomicVersion: VERSION,
    source: "session_hook",
  };
}

/**
 * Append an event to the telemetry events JSONL file.
 * Uses atomic append-only writes for concurrent safety.
 * Fails silently to ensure telemetry never breaks hook operation.
 *
 * @param event - The event object to append
 */
function appendEvent(event: TelemetryEvent): void {
  try {
    const dataDir = getBinaryDataDir();

    // Ensure data directory exists before writing
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const eventsPath = join(dataDir, "telemetry-events.jsonl");
    const line = JSON.stringify(event) + "\n";

    // Atomic append-only write
    appendFileSync(eventsPath, line, "utf-8");
  } catch {
    // Fail silently - telemetry should never break hooks
  }
}

/**
 * Track an agent session end event.
 *
 * This function should be called from agent-specific hooks when a session ends.
 * It extracts commands from the provided transcript (or uses commands array directly)
 * and logs an AgentSessionEvent to the local telemetry buffer.
 *
 * The function is fail-safe and will never throw or block the hook execution.
 *
 * @param agentType - The agent type ('claude', 'opencode', 'copilot')
 * @param input - Either a transcript string to extract commands from, or an array of commands
 * @param sessionStartedAt - Optional ISO 8601 timestamp when session started
 *
 * @example
 * // Track session with transcript (Claude Code hook)
 * trackAgentSession('claude', transcriptContent, '2024-01-15T10:30:00Z');
 *
 * @example
 * // Track session with commands array (when transcript unavailable)
 * trackAgentSession('copilot', ['/commit']);
 *
 * @example
 * // Track session with no commands (logs nothing)
 * trackAgentSession('opencode', []);
 */
export function trackAgentSession(
  agentType: AgentType,
  input: string | string[],
  sessionStartedAt?: string
): void {
  // Return early (no-op) if telemetry is disabled
  if (!isTelemetryEnabledSync()) {
    return;
  }

  // Extract commands from transcript or use provided array
  const commands = typeof input === "string" ? extractCommandsFromTranscript(input) : input;

  // Don't log events with no commands - no value in tracking empty sessions
  if (commands.length === 0) {
    return;
  }

  // Create and write the event
  const event = createSessionEvent(agentType, commands, sessionStartedAt);
  appendEvent(event);
}
