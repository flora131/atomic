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

import { isTelemetryEnabledSync, getOrCreateTelemetryState } from "./telemetry";
import type { AgentSessionEvent, AgentType } from "./types";
import { VERSION } from "../../version";
import { ATOMIC_COMMANDS } from "./constants";
import { appendEvent } from "./telemetry-file-io";

/**
 * Message structure from Claude Code transcript JSONL format.
 * User messages have content as string, assistant messages as array.
 */
interface TranscriptMessage {
  type: "user" | "assistant" | "system";
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

/**
 * Extract text content from a parsed transcript message.
 *
 * CRITICAL: Only extracts from string content (user-typed commands).
 * When user messages have array content, it means skill instructions were loaded,
 * which contain command references that are NOT actual user invocations.
 *
 * Format examples:
 * - User typed command: {type: "user", message: {content: "/commit"}}
 * - Skill loaded: {type: "user", message: {content: [{type: "text", text: "...run /commit..."}]}}
 *
 * @param message - Parsed JSONL message object
 * @returns Text content from user-typed input only (empty string for loaded skills)
 */
function extractTextFromMessage(message: TranscriptMessage): string {
  const content = message.message?.content;

  // Only extract from string content - this is what the user actually typed
  if (typeof content === "string") {
    return content;
  }

  // Array content means skill instructions were loaded - DO NOT extract commands from these
  // Skill instructions contain command references like "/commit" that are NOT user invocations
  return "";
}

/**
 * Find all occurrences of a command in text.
 * Uses word boundary matching to avoid partial matches.
 *
 * @param text - Text to search
 * @param command - Command to find (e.g., '/commit')
 * @returns Number of times the command appears
 */
function countCommandOccurrences(text: string, command: string): number {
  const escapedCmd = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|\\s|[^\\w/])${escapedCmd}(?:\\s|$|[^\\w-:])`, "g");
  return text.match(regex)?.length || 0;
}

/**
 * Extract Atomic slash commands from a transcript string.
 * Used to identify which commands were used during an agent session.
 * Counts all occurrences to track actual usage frequency.
 *
 * The transcript is in JSONL format where each line is a JSON message.
 * Only extracts commands from user messages to avoid false positives from
 * skill instructions or agent suggestions.
 *
 * @param transcript - The transcript text from the agent session (JSONL format)
 * @returns Array of slash commands found (includes duplicates for usage tracking)
 *
 * @example
 * extractCommandsFromTranscript('{"role":"user","message":{"content":[{"type":"text","text":"/commit"}]}}')
 * // Returns: ['/commit']
 *
 * @example
 * // Ignores commands in system messages (skill instructions)
 * extractCommandsFromTranscript('{"role":"system","message":{"content":[{"type":"text","text":"Run /commit"}]}}')
 * // Returns: []
 */
export function extractCommandsFromTranscript(transcript: string): string[] {
  const foundCommands: string[] = [];
  const lines = transcript.split("\n").filter((line) => line.trim() !== "");

  for (const line of lines) {
    try {
      const message: TranscriptMessage = JSON.parse(line);

      // Only extract from user messages - skip assistant/system to avoid false positives
      if (message.type !== "user") {
        continue;
      }

      const text = extractTextFromMessage(message);

      // Find all commands in this user message
      for (const cmd of ATOMIC_COMMANDS) {
        const count = countCommandOccurrences(text, cmd);
        for (let i = 0; i < count; i++) {
          foundCommands.push(cmd);
        }
      }
    } catch {
      // Skip invalid JSON lines - graceful degradation
      continue;
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
 * @returns A fully-formed AgentSessionEvent object
 *
 * @example
 * const event = createSessionEvent('claude', ['/commit', '/create-gh-pr']);
 * // Returns AgentSessionEvent with generated sessionId, timestamp, etc.
 */
export function createSessionEvent(
  agentType: AgentType,
  commands: string[]
): AgentSessionEvent {
  const state = getOrCreateTelemetryState();
  const sessionId = crypto.randomUUID();

  return {
    anonymousId: state.anonymousId,
    eventId: sessionId,
    sessionId,
    eventType: "agent_session",
    timestamp: new Date().toISOString(),
    agentType,
    commands,
    commandCount: commands.length,
    platform: process.platform,
    atomicVersion: VERSION,
    source: "session_hook",
  };
}

// appendEvent moved to telemetry-file-io.ts to avoid duplication

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
 *
 * @example
 * // Track session with transcript (Claude Code hook)
 * trackAgentSession('claude', transcriptContent);
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
  input: string | string[]
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
  const event = createSessionEvent(agentType, commands);
  appendEvent(event, agentType);
}