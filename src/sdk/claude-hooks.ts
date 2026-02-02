/**
 * Claude SDK Hook Handlers
 *
 * This module provides native SDK hooks for the ClaudeAgentClient.
 * It replaces the external command-based hooks in .claude/settings.json
 * with inline TypeScript handlers that run within the SDK context.
 *
 * Reference: Spec Section 5.3.3 - Telemetry Collection
 */

import { existsSync } from "fs";
import type {
  HookCallback,
  HookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeHookConfig } from "./claude-client.ts";
import { trackAgentSession } from "../utils/telemetry/index.ts";

/**
 * Hook input that includes transcript path for session end events
 */
type SessionEndHookInput = HookInput & {
  transcript_path?: string;
  session_started_at?: string;
};

/**
 * Read transcript content from file path
 * @param transcriptPath - Path to the JSONL transcript file
 * @returns Transcript content or empty string on failure
 */
async function readTranscript(transcriptPath: string): Promise<string> {
  if (!existsSync(transcriptPath)) {
    return "";
  }

  try {
    return await Bun.file(transcriptPath).text();
  } catch {
    return "";
  }
}

/**
 * Creates a SessionEnd hook callback that tracks telemetry.
 *
 * This hook is called when a Claude Code session ends. It reads the session
 * transcript, extracts Atomic slash commands, and logs an agent_session
 * telemetry event.
 *
 * The hook is non-blocking and will never throw errors that could
 * interrupt the session end flow.
 *
 * @returns HookCallback function for SessionEnd event
 *
 * @example
 * ```typescript
 * const client = new ClaudeAgentClient();
 * client.registerHooks({
 *   SessionEnd: [createSessionEndTelemetryHook()],
 * });
 * ```
 */
export function createSessionEndTelemetryHook(): HookCallback {
  return async (
    input: HookInput,
    _toolUseId: string | undefined,
    _options: { signal: AbortSignal }
  ): Promise<HookJSONOutput> => {
    try {
      const hookInput = input as SessionEndHookInput;
      const transcriptPath = hookInput.transcript_path;

      // Early exit if no transcript available
      if (!transcriptPath) {
        return { continue: true };
      }

      // Read transcript content
      const transcript = await readTranscript(transcriptPath);

      // Early exit if transcript is empty
      if (!transcript) {
        return { continue: true };
      }

      // Track the session (telemetry module handles command extraction)
      trackAgentSession("claude", transcript);

      return { continue: true };
    } catch {
      // Never block session end on telemetry errors
      return { continue: true };
    }
  };
}

/**
 * Creates the default Claude hook configuration with telemetry handlers.
 *
 * This is the recommended way to initialize hooks for the ClaudeAgentClient
 * when using the Atomic CLI. It includes all standard hooks needed for
 * telemetry collection.
 *
 * @returns ClaudeHookConfig with telemetry hooks configured
 *
 * @example
 * ```typescript
 * const client = new ClaudeAgentClient();
 * client.registerHooks(createDefaultClaudeHooks());
 * await client.start();
 * ```
 */
export function createDefaultClaudeHooks(): ClaudeHookConfig {
  return {
    SessionEnd: [createSessionEndTelemetryHook()],
  };
}

/**
 * Creates a SessionStart hook callback for session initialization.
 *
 * This hook can be used to perform setup tasks when a session begins,
 * such as logging session start events or initializing session state.
 *
 * @param onStart - Optional callback to execute on session start
 * @returns HookCallback function for SessionStart event
 */
export function createSessionStartHook(
  onStart?: (sessionId: string) => void | Promise<void>
): HookCallback {
  return async (
    input: HookInput,
    _toolUseId: string | undefined,
    _options: { signal: AbortSignal }
  ): Promise<HookJSONOutput> => {
    try {
      if (onStart) {
        await onStart(input.session_id);
      }
      return { continue: true };
    } catch {
      // Never block session start on hook errors
      return { continue: true };
    }
  };
}

/**
 * Creates a PreToolUse hook callback for tool execution filtering.
 *
 * This hook is called before each tool execution, allowing for
 * permission checks, logging, or tool execution modification.
 *
 * @param filter - Optional function to filter or modify tool execution
 * @returns HookCallback function for PreToolUse event
 */
export function createPreToolUseHook(
  filter?: (toolName: string, toolInput: unknown) => boolean | Promise<boolean>
): HookCallback {
  return async (
    input: HookInput,
    _toolUseId: string | undefined,
    _options: { signal: AbortSignal }
  ): Promise<HookJSONOutput> => {
    try {
      if (filter) {
        const toolName = (input as Record<string, unknown>).tool_name as string;
        const toolInput = (input as Record<string, unknown>).tool_input;
        const shouldContinue = await filter(toolName, toolInput);
        return { continue: shouldContinue };
      }
      return { continue: true };
    } catch {
      return { continue: true };
    }
  };
}

/**
 * Creates a PostToolUse hook callback for tool result processing.
 *
 * This hook is called after each tool execution completes successfully,
 * allowing for result logging or post-processing.
 *
 * @param onComplete - Optional callback to execute on tool completion
 * @returns HookCallback function for PostToolUse event
 */
export function createPostToolUseHook(
  onComplete?: (
    toolName: string,
    toolResult: unknown
  ) => void | Promise<void>
): HookCallback {
  return async (
    input: HookInput,
    _toolUseId: string | undefined,
    _options: { signal: AbortSignal }
  ): Promise<HookJSONOutput> => {
    try {
      if (onComplete) {
        const toolName = (input as Record<string, unknown>).tool_name as string;
        // PostToolUse hook provides tool_response (not tool_result)
        const toolResult = (input as Record<string, unknown>).tool_response;
        await onComplete(toolName, toolResult);
      }
      return { continue: true };
    } catch {
      return { continue: true };
    }
  };
}
