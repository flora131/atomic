/**
 * Copilot SDK Hook Handlers
 *
 * This module provides native SDK hook handlers for the CopilotClient.
 * It replaces the external command-based hooks in .github/hooks/hooks.json
 * with inline TypeScript handlers that run within the SDK context.
 *
 * Reference: Feature 7 - Migrate Copilot hooks to SDK session.on() event handlers
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import type { CopilotClient } from "./copilot-client.ts";
import type { AgentEvent, EventType } from "./types.ts";
import { trackAgentSession } from "../utils/telemetry/index.ts";
import { tryAcquireLock, releaseLock } from "../utils/file-lock.ts";

/**
 * Type alias for hook event - uses our unified event type
 */
type HookEvent = AgentEvent<EventType>;

// ============================================================================
// CONSTANTS
// ============================================================================

const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_LOG_DIR = ".github/logs";
const RALPH_CONTINUE_FILE = ".github/ralph-continue.flag";
const TEMP_COMMANDS_FILE = ".github/telemetry-session-commands.tmp";

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
 * Configuration for Copilot SDK hooks
 */
export interface CopilotHookHandlers {
  onSessionStart?: (event: HookEvent) => void | Promise<void>;
  onSessionEnd?: (event: HookEvent) => void | Promise<void>;
  onUserPrompt?: (prompt: string) => void | Promise<void>;
}

// ============================================================================
// RALPH STATE MANAGEMENT
// ============================================================================

/**
 * Parse Ralph state from YAML frontmatter file
 */
function parseRalphState(): RalphState | null {
  if (!existsSync(RALPH_STATE_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(RALPH_STATE_FILE, "utf-8").replace(/\r\n/g, "\n");
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
function writeRalphState(state: RalphState): void {
  // Acquire lock before writing
  const lockResult = tryAcquireLock(RALPH_STATE_FILE);
  if (!lockResult.acquired) {
    console.warn(`[Copilot] Could not acquire lock for ${RALPH_STATE_FILE}: ${lockResult.error}`);
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

    writeFileSync(RALPH_STATE_FILE, content, "utf-8");
  } finally {
    // Release lock if we acquired it
    if (lockResult.acquired) {
      releaseLock(RALPH_STATE_FILE);
    }
  }
}

/**
 * Check if all features are passing in the feature list.
 * Uses file locking to prevent read during concurrent write.
 */
async function checkFeaturesPassing(path: string): Promise<boolean> {
  // Acquire lock before reading
  const lockResult = tryAcquireLock(path);

  try {
    const features = JSON.parse(readFileSync(path, "utf-8")) as Array<{ passes?: boolean }>;

    const totalFeatures = features.length;
    if (totalFeatures === 0) {
      return false;
    }

    const passingFeatures = features.filter((f) => f.passes === true).length;
    const failingFeatures = totalFeatures - passingFeatures;

    console.error(
      `Feature Progress: ${passingFeatures} / ${totalFeatures} passing (${failingFeatures} remaining)`
    );

    return failingFeatures === 0;
  } catch {
    return false;
  } finally {
    // Release lock if we acquired it
    if (lockResult.acquired) {
      releaseLock(path);
    }
  }
}

// ============================================================================
// TELEMETRY HELPERS
// ============================================================================

/**
 * Extract Atomic commands from a prompt string
 */
function extractCommandsFromPrompt(prompt: string): string[] {
  const commands: string[] = [];
  for (const cmd of ATOMIC_COMMANDS) {
    const regex = new RegExp(
      `(?:^|\\s)${cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
      "g"
    );
    const matches = prompt.match(regex);
    if (matches) {
      for (const _match of matches) {
        commands.push(cmd);
      }
    }
  }
  return commands;
}

/**
 * Append commands to temp file for session accumulation
 */
async function appendCommandsToTemp(commands: string[]): Promise<void> {
  if (commands.length === 0) return;

  const existingContent = existsSync(TEMP_COMMANDS_FILE)
    ? readFileSync(TEMP_COMMANDS_FILE, "utf-8")
    : "";

  writeFileSync(TEMP_COMMANDS_FILE, existingContent + commands.join("\n") + "\n", "utf-8");
}

/**
 * Read accumulated commands from temp file
 */
function readAccumulatedCommands(): string[] {
  if (!existsSync(TEMP_COMMANDS_FILE)) return [];
  try {
    const content = readFileSync(TEMP_COMMANDS_FILE, "utf-8");
    return content.split("\n").filter((line) => line.trim());
  } catch {
    return [];
  }
}

/**
 * Clear temp commands file
 */
function clearTempFile(): void {
  if (existsSync(TEMP_COMMANDS_FILE)) {
    try {
      unlinkSync(TEMP_COMMANDS_FILE);
    } catch {
      // Ignore
    }
  }
}

/**
 * Log entry to Ralph sessions log
 */
async function logRalphSession(entry: Record<string, unknown>): Promise<void> {
  if (!existsSync(RALPH_LOG_DIR)) {
    mkdirSync(RALPH_LOG_DIR, { recursive: true });
  }

  const logFile = join(RALPH_LOG_DIR, "ralph-sessions.jsonl");
  const existingLog = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";
  writeFileSync(logFile, existingLog + JSON.stringify(entry) + "\n", "utf-8");
}

// ============================================================================
// SESSION START HANDLER
// ============================================================================

/**
 * Creates a session start handler for Ralph loop detection.
 *
 * This handler is called when a Copilot session starts. It checks if a Ralph
 * loop is active and logs session information.
 *
 * @returns Handler function for session.start event
 */
export function createSessionStartHandler(): (event: HookEvent) => Promise<void> {
  return async (event: HookEvent) => {
    try {
      const timestamp = event.timestamp || new Date().toISOString();
      const sessionId = event.sessionId;

      // Log session start
      await logRalphSession({
        timestamp,
        event: "session_start",
        sessionId,
        source: "sdk_hook",
      });

      // Check if Ralph loop is active
      const state = parseRalphState();

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

        // Truncate prompt for display
        const promptDisplay =
          state.prompt.length > 100 ? state.prompt.substring(0, 100) + "..." : state.prompt;
        console.error(`  Prompt: ${promptDisplay}`);
      }
    } catch {
      // Never block session start on hook errors
    }
  };
}

// ============================================================================
// USER PROMPT HANDLER
// ============================================================================

/**
 * Creates a user prompt handler for telemetry tracking.
 *
 * This handler is called when the user submits a prompt. It extracts Atomic
 * commands and appends them to a temp file for session-end processing.
 *
 * @returns Handler function for assistant.message event
 */
export function createUserPromptHandler(): (prompt: string) => Promise<void> {
  return async (prompt: string) => {
    try {
      const commands = extractCommandsFromPrompt(prompt);
      if (commands.length > 0) {
        await appendCommandsToTemp(commands);
      }
    } catch {
      // Never block prompt submission on hook errors
    }
  };
}

// ============================================================================
// SESSION END HANDLER
// ============================================================================

/**
 * Creates a session end handler for telemetry and Ralph loop continuation.
 *
 * This handler is called when a Copilot session ends. It:
 * 1. Reads accumulated commands from temp file
 * 2. Tracks telemetry via trackAgentSession()
 * 3. Checks Ralph loop completion conditions
 * 4. Spawns next iteration if loop continues
 *
 * @returns Handler function for session.idle event
 */
export function createSessionEndHandler(): (event: HookEvent) => Promise<void> {
  return async (event: HookEvent) => {
    try {
      const timestamp = event.timestamp || new Date().toISOString();
      const sessionId = event.sessionId;

      // Log session end
      await logRalphSession({
        timestamp,
        event: "session_end",
        sessionId,
        source: "sdk_hook",
      });

      // Read accumulated commands and track telemetry
      const accumulatedCommands = readAccumulatedCommands();
      if (accumulatedCommands.length > 0) {
        trackAgentSession("copilot", accumulatedCommands);
      }

      // Clear temp file
      clearTempFile();

      // Handle Ralph loop continuation
      await handleRalphLoopContinuation();
    } catch {
      // Never block session end on hook errors
      clearTempFile();
    }
  };
}

/**
 * Handle Ralph loop continuation logic
 */
async function handleRalphLoopContinuation(): Promise<void> {
  const state = parseRalphState();

  if (!state || !state.active) {
    // No active loop - clean up
    try {
      unlinkSync(RALPH_CONTINUE_FILE);
    } catch {
      // File may not exist
    }
    return;
  }

  const { iteration, maxIterations, featureListPath, prompt } = state;

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
  if (shouldContinue && maxIterations === 0 && existsSync(featureListPath)) {
    if (await checkFeaturesPassing(featureListPath)) {
      shouldContinue = false;
      stopReason = "all_features_passing";
      console.error("Ralph loop: All features passing! Loop complete.");
    }
  }

  if (shouldContinue) {
    // Increment iteration for next run
    const nextIteration = iteration + 1;

    writeRalphState({
      ...state,
      iteration: nextIteration,
    });

    // Keep continue flag for status checking
    writeFileSync(RALPH_CONTINUE_FILE, prompt, "utf-8");

    console.error(
      `Ralph loop: Iteration ${iteration} complete. Spawning iteration ${nextIteration}...`
    );

    // Spawn new copilot-cli session in background
    const currentDir = process.cwd();
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const spawnLogFile = join(RALPH_LOG_DIR, `ralph-spawn-${nextIteration}.log`);

    // Ensure log directory exists
    const logDir = dirname(spawnLogFile);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    Bun.spawn(
      [
        "bash",
        "-c",
        `
      sleep 2
      cd '${currentDir}'
      echo '${escapedPrompt}' | copilot --allow-all-tools --allow-all-paths
    `,
      ],
      {
        stdout: Bun.file(spawnLogFile),
        stderr: Bun.file(spawnLogFile),
        stdin: "ignore",
      }
    );

    console.error(`Ralph loop: Spawned background process for iteration ${nextIteration}`);
  } else {
    // Loop complete - archive and clean up
    try {
      unlinkSync(RALPH_CONTINUE_FILE);
    } catch {
      // File may not exist
    }

    const archiveTimestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archiveFile = join(RALPH_LOG_DIR, `ralph-loop-${archiveTimestamp}.md`);

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
    try {
      unlinkSync(RALPH_STATE_FILE);
    } catch {
      // File may not exist
    }

    console.error(`Ralph loop completed. Reason: ${stopReason}`);
    console.error(`State archived to: ${archiveFile}`);
  }

  // Log completion status
  await logRalphSession({
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    event: "ralph_iteration_end",
    iteration,
    shouldContinue,
    stopReason,
  });
}

// ============================================================================
// HOOK REGISTRATION
// ============================================================================

/**
 * Registers all default hooks with a CopilotClient.
 *
 * This is the recommended way to initialize hooks for the CopilotClient
 * when using the Atomic CLI. It registers handlers for:
 * - session.start: Ralph loop detection
 * - session.idle: Telemetry and Ralph loop continuation
 *
 * @param client - The CopilotClient to register hooks with
 * @returns Unsubscribe functions for all registered handlers
 *
 * @example
 * ```typescript
 * const client = createCopilotClient();
 * const unsubscribers = registerDefaultCopilotHooks(client);
 * await client.start();
 *
 * // Later, to unsubscribe:
 * for (const unsub of unsubscribers) {
 *   unsub();
 * }
 * ```
 */
export function registerDefaultCopilotHooks(client: CopilotClient): Array<() => void> {
  const unsubscribers: Array<() => void> = [];

  // Register session start handler
  const sessionStartHandler = createSessionStartHandler();
  const unsubSessionStart = client.on("session.start", (event) => {
    sessionStartHandler(event);
  });
  unsubscribers.push(unsubSessionStart);

  // Register session end handler (using session.idle as per SDK mapping)
  const sessionEndHandler = createSessionEndHandler();
  const unsubSessionEnd = client.on("session.idle", (event) => {
    sessionEndHandler(event);
  });
  unsubscribers.push(unsubSessionEnd);

  return unsubscribers;
}

/**
 * Creates default Copilot hook handlers configuration.
 *
 * @returns CopilotHookHandlers with all default handlers
 */
export function createDefaultCopilotHooks(): CopilotHookHandlers {
  return {
    onSessionStart: createSessionStartHandler(),
    onSessionEnd: createSessionEndHandler(),
    onUserPrompt: createUserPromptHandler(),
  };
}
