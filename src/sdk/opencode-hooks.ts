/**
 * OpenCode SDK Hook Handlers
 *
 * This module provides native SDK hook handlers for the OpenCodeClient.
 * It replaces the external plugin files in .opencode/plugin/ with inline
 * TypeScript handlers that run within the SDK context.
 *
 * Migrated from:
 * - .opencode/plugin/telemetry.ts - Telemetry tracking
 * - .opencode/plugin/ralph.ts - Ralph Wiggum loop
 *
 * Reference: Feature 8 - Migrate OpenCode hooks from plugin files to SDK plugin hooks
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import type { OpenCodeClient, OpenCodeSdkEvent } from "./opencode-client.ts";
import { trackAgentSession } from "../utils/telemetry/index.ts";
import { tryAcquireLock, releaseLock } from "../utils/file-lock.ts";

// ============================================================================
// CONSTANTS
// ============================================================================

const RALPH_STATE_FILE = ".opencode/ralph-loop.local.md";
const RALPH_LOG_DIR = ".opencode/logs";
const TEMP_COMMANDS_FILE = ".opencode/telemetry-session-commands.tmp";

// Atomic commands to track (must match src/utils/telemetry/constants.ts)
const ATOMIC_COMMANDS = [
  "/research-codebase",
  "/create-spec",
  "/create-feature-list",
  "/implement-feature",
  "/commit",
  "/create-gh-pr",
  "/explain-code",
  "/ralph",
];

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Ralph state parsed from YAML frontmatter
 */
interface RalphState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  featureListPath: string;
  startedAt: string;
  prompt: string;
}

/**
 * Feature entry from feature-list.json
 */
interface Feature {
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
}

/**
 * Feature status result
 */
interface FeatureStatus {
  allPassing: boolean;
  total: number;
  passing: number;
  failing: number;
}

/**
 * Configuration for OpenCode SDK hooks
 */
export interface OpenCodeHookHandlers {
  onSessionStart?: (event: OpenCodeSdkEvent) => void | Promise<void>;
  onSessionIdle?: (event: OpenCodeSdkEvent) => void | Promise<void>;
  onSessionDeleted?: (event: OpenCodeSdkEvent) => void | Promise<void>;
  onCommandExecute?: (command: string) => void | Promise<void>;
  onChatMessage?: (message: string) => void | Promise<void>;
}

/**
 * OpenCode hook execution context
 */
export interface OpenCodeHookContext {
  directory: string;
  sessionId: string;
  timestamp: string;
}

// ============================================================================
// RALPH STATE MANAGEMENT
// ============================================================================

/**
 * Parse Ralph state from YAML frontmatter file
 */
export function parseRalphState(directory: string = process.cwd()): RalphState | null {
  const statePath = join(directory, RALPH_STATE_FILE);

  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = readFileSync(statePath, "utf-8").replace(/\r\n/g, "\n");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const prompt = frontmatterMatch[2];

    if (!frontmatter) {
      return null;
    }

    const getValue = (key: string): string | null => {
      const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
      if (!match || !match[1]) return null;
      return match[1].replace(/^["'](.*)["']$/, "$1");
    };

    const active = getValue("active") === "true";
    const iteration = parseInt(getValue("iteration") || "1", 10);
    const maxIterations = parseInt(getValue("max_iterations") || "0", 10);
    const completionPromise = getValue("completion_promise");
    const featureListPath = getValue("feature_list_path") || "research/feature-list.json";
    const startedAt = getValue("started_at") || new Date().toISOString();

    return {
      active,
      iteration,
      maxIterations,
      completionPromise:
        completionPromise === "null" || !completionPromise ? null : completionPromise,
      featureListPath,
      startedAt,
      prompt: (prompt ?? "").trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Write Ralph state to YAML frontmatter file with file locking.
 * Uses non-blocking lock acquisition to prevent concurrent writes.
 */
export function writeRalphState(state: RalphState, directory: string = process.cwd()): void {
  const statePath = join(directory, RALPH_STATE_FILE);
  const dirPath = dirname(statePath);

  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  // Acquire lock before writing
  const lockResult = tryAcquireLock(statePath);
  if (!lockResult.acquired) {
    console.warn(`[OpenCode] Could not acquire lock for ${statePath}: ${lockResult.error}`);
    // Fall through to write anyway to avoid blocking the session
  }

  try {
    const completionPromiseYaml =
      state.completionPromise === null ? "null" : `"${state.completionPromise}"`;

    const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
---

${state.prompt}
`;

    writeFileSync(statePath, content, "utf-8");
  } finally {
    // Release lock if we acquired it
    if (lockResult.acquired) {
      releaseLock(statePath);
    }
  }
}

/**
 * Delete Ralph state file
 */
export function deleteRalphState(directory: string = process.cwd()): boolean {
  const statePath = join(directory, RALPH_STATE_FILE);

  if (existsSync(statePath)) {
    unlinkSync(statePath);
    return true;
  }
  return false;
}

/**
 * Check if all features are passing in the feature list.
 * Uses file locking to prevent read during concurrent write.
 */
export function checkFeaturesPassing(
  directory: string,
  featureListPath: string
): FeatureStatus | null {
  const fullPath = join(directory, featureListPath);

  // Acquire lock before reading
  const lockResult = tryAcquireLock(fullPath);

  try {
    const content = readFileSync(fullPath, "utf-8");
    const features: Feature[] = JSON.parse(content);

    if (!Array.isArray(features) || features.length === 0) {
      return null;
    }

    const total = features.length;
    const passing = features.filter((f) => f.passes === true).length;
    const failing = total - passing;

    return {
      allPassing: failing === 0,
      total,
      passing,
      failing,
    };
  } catch {
    return null;
  } finally {
    // Release lock if we acquired it
    if (lockResult.acquired) {
      releaseLock(fullPath);
    }
  }
}

/**
 * Check if completion promise is present in text
 */
export function checkCompletionPromise(text: string, promise: string): boolean {
  const promiseMatch = text.match(/<promise>([\s\S]*?)<\/promise>/);
  if (!promiseMatch || !promiseMatch[1]) return false;

  const promiseText = promiseMatch[1].trim().replace(/\s+/g, " ");
  return promiseText === promise;
}

// ============================================================================
// TELEMETRY HELPERS
// ============================================================================

/**
 * Normalize command name to match ATOMIC_COMMANDS format.
 * Handles both "command-name" and "/command-name" formats.
 */
export function normalizeCommandName(commandName: string): string | null {
  const withSlash = commandName.startsWith("/") ? commandName : `/${commandName}`;
  return ATOMIC_COMMANDS.includes(withSlash as (typeof ATOMIC_COMMANDS)[number]) ? withSlash : null;
}

/**
 * Extract Atomic commands from message text.
 * Counts all occurrences to track actual usage frequency.
 */
export function extractCommandsFromText(text: string): string[] {
  const found: string[] = [];

  for (const cmd of ATOMIC_COMMANDS) {
    const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|\\s|[^\\w/])${escaped}(?:\\s|$|[^\\w-:])`, "g");
    const matches = text.match(regex);
    if (matches) {
      for (let i = 0; i < matches.length; i++) {
        found.push(cmd);
      }
    }
  }

  return found;
}

/**
 * Append commands to temp file for session accumulation
 */
export function appendCommandsToTemp(
  commands: string[],
  directory: string = process.cwd()
): void {
  if (commands.length === 0) return;

  const tempPath = join(directory, TEMP_COMMANDS_FILE);
  const dirPath = dirname(tempPath);
  
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  const existingContent = existsSync(tempPath)
    ? readFileSync(tempPath, "utf-8")
    : "";

  writeFileSync(tempPath, existingContent + commands.join("\n") + "\n", "utf-8");
}

/**
 * Read accumulated commands from temp file
 */
export function readAccumulatedCommands(directory: string = process.cwd()): string[] {
  const tempPath = join(directory, TEMP_COMMANDS_FILE);
  
  if (!existsSync(tempPath)) return [];
  
  try {
    const content = readFileSync(tempPath, "utf-8");
    return content.split("\n").filter((line) => line.trim());
  } catch {
    return [];
  }
}

/**
 * Clear temp commands file
 */
export function clearTempFile(directory: string = process.cwd()): void {
  const tempPath = join(directory, TEMP_COMMANDS_FILE);
  
  if (existsSync(tempPath)) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore
    }
  }
}

/**
 * Log entry to session log file
 */
export function logSessionEntry(
  entry: Record<string, unknown>,
  directory: string = process.cwd()
): void {
  const logDir = join(directory, RALPH_LOG_DIR);
  
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const logFile = join(logDir, "opencode-sessions.jsonl");
  appendFileSync(logFile, JSON.stringify(entry) + "\n", "utf-8");
}

// ============================================================================
// SESSION START HANDLER
// ============================================================================

/**
 * Creates a session start handler for Ralph loop detection and initialization.
 *
 * This handler is called when an OpenCode session starts. It:
 * 1. Resets accumulated commands for the new session
 * 2. Logs session start
 * 3. Checks if a Ralph loop is active and logs status
 *
 * @param directory - Working directory (defaults to cwd)
 * @returns Handler function for session.created event
 */
export function createSessionStartHandler(
  directory: string = process.cwd()
): (event: OpenCodeSdkEvent) => Promise<void> {
  return async (event: OpenCodeSdkEvent) => {
    try {
      const timestamp = event.timestamp || new Date().toISOString();
      const sessionId = event.sessionId;

      // Reset commands for new session
      clearTempFile(directory);

      // Log session start
      logSessionEntry(
        {
          timestamp,
          event: "session_start",
          sessionId,
          source: "sdk_hook",
        },
        directory
      );

      // Check if Ralph loop is active
      const state = parseRalphState(directory);

      if (state && state.active) {
        console.error(`Ralph loop active - Iteration ${state.iteration}`);

        if (state.maxIterations > 0) {
          console.error(`  Max iterations: ${state.maxIterations}`);
        } else {
          console.error("  Max iterations: unlimited");
        }

        if (state.completionPromise) {
          console.error(`  Completion promise: ${state.completionPromise}`);
        }

        // Check feature progress
        const featureStatus = checkFeaturesPassing(directory, state.featureListPath);
        if (featureStatus) {
          console.error(
            `  Features: ${featureStatus.passing}/${featureStatus.total} passing`
          );
        }
      }
    } catch {
      // Never block session start on hook errors
    }
  };
}

// ============================================================================
// COMMAND EXECUTE HANDLER
// ============================================================================

/**
 * Creates a command execute handler for telemetry tracking.
 *
 * This handler is called before a slash command is executed. It normalizes
 * the command name and appends it to the temp file for session-end processing.
 *
 * @param directory - Working directory (defaults to cwd)
 * @returns Handler function for command execution
 */
export function createCommandExecuteHandler(
  directory: string = process.cwd()
): (command: string) => Promise<void> {
  return async (command: string) => {
    try {
      const normalizedCommand = normalizeCommandName(command);
      if (normalizedCommand) {
        appendCommandsToTemp([normalizedCommand], directory);
      }
    } catch {
      // Never block command execution on hook errors
    }
  };
}

// ============================================================================
// CHAT MESSAGE HANDLER
// ============================================================================

/**
 * Creates a chat message handler for command extraction from text.
 *
 * This handler is called when a chat message is processed. It extracts
 * any Atomic commands mentioned in the text and tracks them.
 *
 * @param directory - Working directory (defaults to cwd)
 * @returns Handler function for chat messages
 */
export function createChatMessageHandler(
  directory: string = process.cwd()
): (message: string) => Promise<void> {
  return async (message: string) => {
    try {
      const commands = extractCommandsFromText(message);
      if (commands.length > 0) {
        appendCommandsToTemp(commands, directory);
      }
    } catch {
      // Never block message processing on hook errors
    }
  };
}

// ============================================================================
// SESSION IDLE HANDLER
// ============================================================================

/**
 * Creates a session idle handler for telemetry and Ralph loop continuation.
 *
 * This handler is called when the session becomes idle. It:
 * 1. Reads accumulated commands and tracks telemetry
 * 2. Checks Ralph loop completion conditions
 * 3. Continues the loop if conditions are not met
 *
 * @param directory - Working directory (defaults to cwd)
 * @param client - OpenCode SDK client for session operations (optional)
 * @returns Handler function for session.idle event
 */
export function createSessionIdleHandler(
  directory: string = process.cwd(),
  client?: { session: { summarize: (params: { path: { id: string } }) => Promise<void>; prompt: (params: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => Promise<void> } }
): (event: OpenCodeSdkEvent) => Promise<void> {
  return async (event: OpenCodeSdkEvent) => {
    try {
      const timestamp = event.timestamp || new Date().toISOString();
      const sessionId = event.sessionId;

      // Log session idle
      logSessionEntry(
        {
          timestamp,
          event: "session_idle",
          sessionId,
          source: "sdk_hook",
        },
        directory
      );

      // Read accumulated commands and track telemetry
      const accumulatedCommands = readAccumulatedCommands(directory);
      if (accumulatedCommands.length > 0) {
        trackAgentSession("opencode", accumulatedCommands);
        // Reset commands for next interaction
        clearTempFile(directory);
      }

      // Handle Ralph loop continuation
      await handleRalphLoopContinuation(directory, sessionId, client);
    } catch {
      // Never block session idle on hook errors
      clearTempFile(directory);
    }
  };
}

/**
 * Handle Ralph loop continuation logic
 */
async function handleRalphLoopContinuation(
  directory: string,
  sessionId: string,
  client?: { session: { summarize: (params: { path: { id: string } }) => Promise<void>; prompt: (params: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => Promise<void> } }
): Promise<void> {
  const state = parseRalphState(directory);

  if (!state || !state.active) {
    return;
  }

  const { iteration, maxIterations, featureListPath, completionPromise, prompt } = state;

  // Check completion conditions
  let shouldContinue = true;
  let stopReason = "";

  // Check 1: Max iterations reached
  if (maxIterations > 0 && iteration >= maxIterations) {
    shouldContinue = false;
    stopReason = "max_iterations_reached";
    console.error(`Ralph loop: Max iterations (${maxIterations}) reached.`);
  }

  // Check 2: All features passing (only in unlimited mode when feature file exists)
  if (shouldContinue && maxIterations === 0) {
    const fullFeaturePath = join(directory, featureListPath);
    if (existsSync(fullFeaturePath)) {
      const featureStatus = checkFeaturesPassing(directory, featureListPath);
      if (featureStatus?.allPassing) {
        shouldContinue = false;
        stopReason = "all_features_passing";
        console.error(`Ralph loop: All ${featureStatus.total} features passing! Loop complete.`);
      }
    }
  }

  if (shouldContinue) {
    // Increment iteration for next run
    const nextIteration = iteration + 1;

    writeRalphState(
      {
        ...state,
        iteration: nextIteration,
      },
      directory
    );

    // Build the continuation message
    let systemMsg = `Ralph iteration ${nextIteration}`;
    const featureStatus = checkFeaturesPassing(directory, featureListPath);
    if (featureStatus) {
      systemMsg += ` | Features: ${featureStatus.passing}/${featureStatus.total} passing`;
    }
    if (completionPromise) {
      systemMsg += ` | To stop: output <promise>${completionPromise}</promise> (ONLY when TRUE)`;
    } else if (maxIterations > 0) {
      systemMsg += ` / ${maxIterations}`;
    } else if (!featureStatus) {
      systemMsg += ` | No completion promise set - loop runs until cancelled`;
    }

    console.error(systemMsg);

    // If we have a client, use it to compact context and continue
    if (client) {
      try {
        // Compact context before continuing
        await client.session.summarize({ path: { id: sessionId } });
        console.error(`Context compacted before iteration ${nextIteration}`);
      } catch (err) {
        console.error(`Could not compact context: ${err}`);
      }

      try {
        // Send continuation prompt
        const continuationPrompt = `[${systemMsg}]\n\n${prompt}`;
        await client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: "text", text: continuationPrompt }],
          },
        });
      } catch (err) {
        console.error(`Could not send continuation prompt: ${err}`);
      }
    } else {
      // Without client, spawn background process (fallback for CLI usage)
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      const spawnLogFile = join(directory, RALPH_LOG_DIR, `ralph-spawn-${nextIteration}.log`);

      const logDir = dirname(spawnLogFile);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      console.error(`Ralph loop: Iteration ${iteration} complete. Spawning iteration ${nextIteration}...`);

      Bun.spawn(
        [
          "bash",
          "-c",
          `
        sleep 2
        cd '${directory}'
        echo '${escapedPrompt}' | opencode --continue
      `,
        ],
        {
          stdout: Bun.file(spawnLogFile),
          stderr: Bun.file(spawnLogFile),
          stdin: "ignore",
        }
      );
    }
  } else {
    // Loop complete - archive and clean up
    archiveRalphLoop(state, stopReason, directory);
  }

  // Log completion status
  logSessionEntry(
    {
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      event: "ralph_iteration_end",
      iteration,
      shouldContinue,
      stopReason,
    },
    directory
  );
}

/**
 * Archive completed Ralph loop state
 */
function archiveRalphLoop(state: RalphState, stopReason: string, directory: string): void {
  const logDir = join(directory, RALPH_LOG_DIR);
  
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const archiveTimestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archiveFile = join(logDir, `ralph-loop-${archiveTimestamp}.md`);

  const completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`;

  const archiveContent = `---
active: false
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
completed_at: "${completedAt}"
stop_reason: "${stopReason}"
---

${state.prompt}
`;

  writeFileSync(archiveFile, archiveContent, "utf-8");

  // Remove active state
  deleteRalphState(directory);

  console.error(`Ralph loop completed. Reason: ${stopReason}`);
  console.error(`State archived to: ${archiveFile}`);
}

// ============================================================================
// SESSION DELETED HANDLER
// ============================================================================

/**
 * Creates a session deleted handler for cleanup.
 *
 * This handler is called when a session is deleted. It ensures any
 * remaining commands are tracked and temp files are cleaned up.
 *
 * @param directory - Working directory (defaults to cwd)
 * @returns Handler function for session.deleted event
 */
export function createSessionDeletedHandler(
  directory: string = process.cwd()
): (event: OpenCodeSdkEvent) => Promise<void> {
  return async (event: OpenCodeSdkEvent) => {
    try {
      const timestamp = event.timestamp || new Date().toISOString();
      const sessionId = event.sessionId;

      // Log session deleted
      logSessionEntry(
        {
          timestamp,
          event: "session_deleted",
          sessionId,
          source: "sdk_hook",
        },
        directory
      );

      // Track any remaining commands
      const accumulatedCommands = readAccumulatedCommands(directory);
      if (accumulatedCommands.length > 0) {
        trackAgentSession("opencode", accumulatedCommands);
      }

      // Clean up temp file
      clearTempFile(directory);
    } catch {
      // Never block session deletion on hook errors
      clearTempFile(directory);
    }
  };
}

// ============================================================================
// HOOK REGISTRATION
// ============================================================================

/**
 * Registers all default hooks with an OpenCodeClient.
 *
 * This is the recommended way to initialize hooks for the OpenCodeClient
 * when using the Atomic CLI. It registers handlers for:
 * - session.start: Session initialization and Ralph loop detection
 * - session.idle: Telemetry tracking and Ralph loop continuation
 *
 * @param client - The OpenCodeClient to register hooks with
 * @param directory - Working directory (defaults to cwd)
 * @returns Unsubscribe functions for all registered handlers
 *
 * @example
 * ```typescript
 * const client = createOpenCodeClient();
 * const unsubscribers = registerDefaultOpenCodeHooks(client);
 * await client.start();
 *
 * // Later, to unsubscribe:
 * for (const unsub of unsubscribers) {
 *   unsub();
 * }
 * ```
 */
export function registerDefaultOpenCodeHooks(
  client: OpenCodeClient,
  directory: string = process.cwd()
): Array<() => void> {
  const unsubscribers: Array<() => void> = [];

  // Register session start handler
  const sessionStartHandler = createSessionStartHandler(directory);
  const unsubSessionStart = client.on("session.start", (event) => {
    sessionStartHandler({
      type: "session.created",
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      data: event.data as Record<string, unknown>,
    });
  });
  unsubscribers.push(unsubSessionStart);

  // Register session idle handler
  const sessionIdleHandler = createSessionIdleHandler(directory);
  const unsubSessionIdle = client.on("session.idle", (event) => {
    sessionIdleHandler({
      type: "session.idle",
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      data: event.data as Record<string, unknown>,
    });
  });
  unsubscribers.push(unsubSessionIdle);

  return unsubscribers;
}

/**
 * Creates default OpenCode hook handlers configuration.
 *
 * @param directory - Working directory (defaults to cwd)
 * @returns OpenCodeHookHandlers with all default handlers
 */
export function createDefaultOpenCodeHooks(
  directory: string = process.cwd()
): OpenCodeHookHandlers {
  return {
    onSessionStart: createSessionStartHandler(directory),
    onSessionIdle: createSessionIdleHandler(directory),
    onSessionDeleted: createSessionDeletedHandler(directory),
    onCommandExecute: createCommandExecuteHandler(directory),
    onChatMessage: createChatMessageHandler(directory),
  };
}
