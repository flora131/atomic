#!/usr/bin/env bun

/**
 * Ralph Wiggum Session End Hook (Self-Restarting) - TypeScript Version
 *
 * Tracks iterations, checks completion conditions, spawns next session automatically.
 * This hook implements a self-restarting pattern: when the session ends,
 * it spawns a new detached copilot-cli session to continue the loop.
 * No external orchestrator required!
 *
 * Converted from: .github/hooks/stop-hook.sh
 */

import { existsSync, mkdirSync, unlinkSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

// ============================================================================
// INLINED TELEMETRY HELPER FUNCTIONS
// ============================================================================
// Source of truth: bin/telemetry-helper.sh and src/utils/telemetry/
// These are intentionally duplicated - TypeScript hooks cannot import at runtime

// Atomic commands to track
// Source of truth: src/utils/telemetry/constants.ts
// Keep synchronized when adding/removing commands
const ATOMIC_COMMANDS = [
  "/research-codebase",
  "/create-spec",
  "/create-feature-list",
  "/implement-feature",
  "/commit",
  "/create-gh-pr",
  "/explain-code",
  "/ralph-loop",
  "/ralph:ralph-loop",
  "/cancel-ralph",
  "/ralph:cancel-ralph",
  "/ralph-help",
  "/ralph:help",
];

// Get the telemetry data directory
// Source of truth: src/utils/config-path.ts getBinaryDataDir()
// Keep synchronized when changing data directory paths
function getTelemetryDataDir(): string {
  const osType = process.platform;
  if (osType === "win32") {
    // Windows
    const appData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData/Local");
    return join(appData, "atomic");
  } else {
    // Unix (macOS/Linux)
    const xdgData = process.env.XDG_DATA_HOME || join(process.env.HOME || "", ".local/share");
    return join(xdgData, "atomic");
  }
}

// Get the telemetry events file path
// Arguments: agentType = "claude", "opencode", "copilot"
function getEventsFilePath(agentType: string): string {
  return join(getTelemetryDataDir(), `telemetry-events-${agentType}.jsonl`);
}

// Get the telemetry.json state file path
function getTelemetryStatePath(): string {
  return join(getTelemetryDataDir(), "telemetry.json");
}

// Check if telemetry is enabled
// Source of truth: src/utils/telemetry/telemetry.ts isTelemetryEnabled()
// Keep synchronized when changing opt-out logic
// Returns true if enabled, false if disabled
async function isTelemetryEnabled(): Promise<boolean> {
  // Check environment variables first (quick exit)
  if (process.env.ATOMIC_TELEMETRY === "0") {
    return false;
  }

  if (process.env.DO_NOT_TRACK === "1") {
    return false;
  }

  // Check telemetry.json state file
  const stateFile = getTelemetryStatePath();

  if (!existsSync(stateFile)) {
    // No state file = telemetry not configured, assume disabled
    return false;
  }

  try {
    // Check enabled and consentGiven fields in state file
    const stateContent = (await Bun.file(stateFile).json()) as Record<string, unknown>;
    const enabled = stateContent?.enabled ?? false;
    const consentGiven = stateContent?.consentGiven ?? false;

    return enabled === true && consentGiven === true;
  } catch {
    return false;
  }
}

// Get anonymous ID from telemetry state
async function getAnonymousId(): Promise<string | null> {
  const stateFile = getTelemetryStatePath();

  if (existsSync(stateFile)) {
    try {
      const stateContent = (await Bun.file(stateFile).json()) as Record<string, unknown>;
      return (stateContent?.anonymousId as string) || null;
    } catch {
      return null;
    }
  }
  return null;
}

// Get Atomic version from state file (if available) or use "unknown"
async function getAtomicVersion(): Promise<string> {
  // Try to get version by running atomic --version
  // Strip "atomic v" prefix to match TypeScript VERSION format
  // Fall back to "unknown" if not available
  try {
    const result = await Bun.$`atomic --version`.text();
    return result.trim().replace(/^atomic v/, "") || "unknown";
  } catch {
    return "unknown";
  }
}

// Generate a UUID v4
function generateUuid(): string {
  return randomUUID();
}

// Get current timestamp in ISO 8601 format
function getTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Get current platform
function getPlatform(): string {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "win32";
    default:
      return "unknown";
  }
}

// Detect agents from Copilot session events.jsonl
// Parses the most recent session's events to find agent invocations
//
// Detection Methods:
// - Method 1: Explicit agent_type in task tool calls (natural language invocations)
// - Method 2: agent_name in tool telemetry (when agents complete execution)
//
// Note: We do NOT attempt to detect agents from dropdown/CLI invocations by parsing
// transformedContent, as this approach is unreliable and not worth maintaining.
//
// Returns: comma-separated list of detected agent names (preserving duplicates)
async function detectCopilotAgents(): Promise<string> {
  const copilotStateDir = join(process.env.HOME || "", ".copilot/session-state");

  // Early exit if Copilot state directory doesn't exist
  if (!existsSync(copilotStateDir)) {
    return "";
  }

  // Find the most recent session directory
  let latestSession: string | null = null;
  try {
    const result = await Bun.$`ls -td ${copilotStateDir}/*/ 2>/dev/null | head -1`.text();
    latestSession = result.trim();
  } catch {
    return "";
  }

  if (!latestSession) {
    return "";
  }

  const eventsFile = join(latestSession, "events.jsonl");

  if (!existsSync(eventsFile)) {
    return "";
  }

  const foundAgents: string[] = [];

  try {
    const eventsContent = await Bun.file(eventsFile).text();
    const lines = eventsContent.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const eventType = parsed?.type as string | undefined;

        // Method 1: Check assistant.message for task tool calls with agent_type
        // This handles natural language invocations like "use explain-code to..."
        if (eventType === "assistant.message") {
          const data = parsed?.data as Record<string, unknown> | undefined;
          const toolRequests = data?.toolRequests as Array<Record<string, unknown>> | undefined;

          if (toolRequests) {
            for (const request of toolRequests) {
              if (request?.name === "task") {
                const args = request?.arguments as Record<string, unknown> | undefined;
                const agentType = args?.agent_type as string | undefined;

                if (agentType && existsSync(`.github/agents/${agentType}.md`)) {
                  foundAgents.push(`/${agentType}`);
                }
              }
            }
          }
        }

        // Method 2: Check tool.execution_complete for agent_name in telemetry
        // This captures agents when they finish execution (works for all invocation methods)
        if (eventType === "tool.execution_complete") {
          const data = parsed?.data as Record<string, unknown> | undefined;
          const toolTelemetry = data?.toolTelemetry as Record<string, unknown> | undefined;
          const properties = toolTelemetry?.properties as Record<string, unknown> | undefined;
          const agentName = properties?.agent_name as string | undefined;

          if (agentName && existsSync(`.github/agents/${agentName}.md`)) {
            foundAgents.push(`/${agentName}`);
          }
        }
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }
  } catch {
    return "";
  }

  // Return comma-separated list (preserving duplicates for frequency tracking)
  return foundAgents.join(",");
}

// Write an agent session event to the telemetry events file
// Source of truth: src/utils/telemetry/telemetry-file-io.ts appendEvent()
// Keep synchronized when changing event structure or file writing logic
//
// Arguments:
//   agentType: "claude", "opencode", or "copilot"
//   commands: comma-separated list of commands (e.g., "/commit,/create-gh-pr")
//
// Returns: true on success, false on failure
async function writeSessionEvent(agentType: string, commandsStr: string): Promise<boolean> {
  // Early return if telemetry disabled
  if (!(await isTelemetryEnabled())) {
    return true;
  }

  // Early return if no commands
  if (!commandsStr) {
    return true;
  }

  // Get required fields
  const anonymousId = await getAnonymousId();

  if (!anonymousId) {
    // No anonymous ID = telemetry not properly configured
    return false;
  }

  const eventId = generateUuid();
  const sessionId = eventId;
  const timestamp = getTimestamp();
  const platform = getPlatform();
  const atomicVersion = await getAtomicVersion();

  // Convert commands to JSON array
  const commands = commandsStr.split(",").filter((c) => c);
  const commandCount = commands.length;

  // Build event JSON
  const eventJson = {
    anonymousId,
    eventId,
    sessionId,
    eventType: "agent_session",
    timestamp,
    agentType,
    commands,
    commandCount,
    platform,
    atomicVersion,
    source: "session_hook",
  };

  // Get events file path and ensure directory exists
  const eventsFile = getEventsFilePath(agentType);
  const eventsDir = dirname(eventsFile);

  if (!existsSync(eventsDir)) {
    mkdirSync(eventsDir, { recursive: true });
  }

  // Append event to JSONL file
  const existingContent = await Bun.file(eventsFile).text().catch(() => "");
  await Bun.write(eventsFile, existingContent + JSON.stringify(eventJson) + "\n");

  return true;
}

// Spawn background upload process
// Usage: spawnUploadProcess()
async function spawnUploadProcess(): Promise<void> {
  try {
    // Check if atomic command exists
    await Bun.$`command -v atomic`.quiet();
    // Spawn in background
    Bun.$`nohup atomic --upload-telemetry > /dev/null 2>&1 &`.quiet().nothrow();
  } catch {
    // atomic not available, skip
  }
}

// ============================================================================
// RALPH LOOP LOGIC
// ============================================================================

interface HookInput {
  timestamp?: string;
  cwd?: string;
  reason?: string;
}

// State file locations
const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_LOG_DIR = ".github/logs";
const RALPH_CONTINUE_FILE = ".github/ralph-continue.flag";

// ============================================================================
// YAML FRONTMATTER PARSING
// Reference: .opencode/plugin/ralph.ts:119-168
// ============================================================================

interface ParsedRalphState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  featureListPath: string;
  startedAt: string;
  prompt: string;
}

function parseRalphState(): ParsedRalphState | null {
  if (!existsSync(RALPH_STATE_FILE)) {
    return null;
  }

  try {
    // Normalize line endings to LF for cross-platform compatibility
    const content = readFileSync(RALPH_STATE_FILE, "utf-8").replace(/\r\n/g, "\n");

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      return null;
    }

    const [, frontmatter, prompt] = frontmatterMatch;

    // Parse frontmatter values
    const getValue = (key: string): string | null => {
      const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
      if (!match) return null;
      // Remove surrounding quotes if present
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
      prompt: prompt.trim(),
    };
  } catch {
    return null;
  }
}

function writeRalphState(state: ParsedRalphState): void {
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

  Bun.write(RALPH_STATE_FILE, content);
}

// Check if all features are passing
// Note: Caller must verify file exists before calling this function
async function checkFeaturesPassing(path: string): Promise<boolean> {
  try {
    const features = (await Bun.file(path).json()) as Array<{ passes?: boolean }>;

    const totalFeatures = features.length;
    if (totalFeatures === 0) {
      return false;
    }

    const passingFeatures = features.filter((f) => f.passes === true).length;
    const failingFeatures = totalFeatures - passingFeatures;

    console.error(`Feature Progress: ${passingFeatures} / ${totalFeatures} passing (${failingFeatures} remaining)`);

    return failingFeatures === 0;
  } catch {
    return false;
  }
}

// Main execution
async function main(): Promise<void> {
  // Read hook input from stdin
  const input = await Bun.stdin.text();

  // Parse input fields
  let timestamp = "";
  let cwd = "";
  let reason = "unknown";

  try {
    const parsed = JSON.parse(input) as HookInput;
    timestamp = parsed?.timestamp || "";
    cwd = parsed?.cwd || "";
    reason = parsed?.reason || "unknown";
  } catch {
    // Continue with defaults if parsing fails
  }

  // Ensure log directory exists
  if (!existsSync(RALPH_LOG_DIR)) {
    mkdirSync(RALPH_LOG_DIR, { recursive: true });
  }

  // Log session end
  const sessionEndEntry = {
    timestamp,
    event: "session_end",
    cwd,
    reason,
  };

  const logFile = join(RALPH_LOG_DIR, "ralph-sessions.jsonl");
  const existingLog = await Bun.file(logFile).text().catch(() => "");
  await Bun.write(logFile, existingLog + JSON.stringify(sessionEndEntry) + "\n");

  // ============================================================================
  // TELEMETRY TRACKING
  // ============================================================================
  // Track agent session telemetry by detecting custom agents from events.jsonl
  // Agents are detected from instruction headers or task tool calls in Copilot's
  // session state directory.
  // IMPORTANT: This runs BEFORE Ralph loop check to ensure telemetry is captured
  // for all sessions, not just Ralph loop sessions.

  if (await isTelemetryEnabled()) {
    // Detect agents from Copilot session events.jsonl
    const detectedAgents = await detectCopilotAgents();

    // Write telemetry event with detected agents
    await writeSessionEvent("copilot", detectedAgents);

    // Spawn upload process
    await spawnUploadProcess();
  }

  // Check if Ralph loop is active and parse state
  const state = parseRalphState();

  if (!state || !state.active) {
    // No active loop - clean exit
    try {
      unlinkSync(RALPH_CONTINUE_FILE);
    } catch {
      // File may not exist
    }
    process.exit(0);
  }

  const iteration = state.iteration;
  const maxIterations = state.maxIterations;
  const featureListPath = state.featureListPath;
  const prompt = state.prompt;

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

  // Check 3: Completion promise detected
  // Note: Completion promise detection is handled by the OpenCode plugin or external orchestrator
  // The stop hook focuses on max_iterations and feature-list completion checks

  // Update state and spawn next session (or complete)
  if (shouldContinue) {
    // Increment iteration for next run
    const nextIteration = iteration + 1;

    // Update state file using YAML frontmatter format
    writeRalphState({
      ...state,
      iteration: nextIteration,
    });

    // Keep continue flag for status checking (optional)
    await Bun.write(RALPH_CONTINUE_FILE, prompt);

    console.error(`Ralph loop: Iteration ${iteration} complete. Spawning iteration ${nextIteration}...`);

    // Get current working directory for the spawned process
    const currentDir = process.cwd();

    // Escape prompt for shell (replace single quotes)
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    // Spawn new copilot-cli session in background (detached, survives hook exit)
    // - nohup: prevents SIGHUP when parent exits
    // - sleep 2: brief delay to let current session fully close
    // - Redirects to log file for debugging
    const spawnLogFile = join(RALPH_LOG_DIR, `ralph-spawn-${nextIteration}.log`);

    Bun.spawn(["bash", "-c", `
      sleep 2
      cd '${currentDir}'
      echo '${escapedPrompt}' | copilot --allow-all-tools --allow-all-paths
    `], {
      stdout: Bun.file(spawnLogFile),
      stderr: Bun.file(spawnLogFile),
      stdin: "ignore",
    });

    console.error(`Ralph loop: Spawned background process for iteration ${nextIteration}`);
  } else {
    // Loop complete - clean up
    try {
      unlinkSync(RALPH_CONTINUE_FILE);
    } catch {
      // File may not exist
    }

    // Archive state file in YAML frontmatter format
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

    await Bun.write(archiveFile, archiveContent);

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
  const iterationEndEntry = {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    event: "ralph_iteration_end",
    iteration,
    shouldContinue,
    stopReason,
  };

  const existingLogFinal = await Bun.file(logFile).text().catch(() => "");
  await Bun.write(logFile, existingLogFinal + JSON.stringify(iterationEndEntry) + "\n");

  // Output is ignored for sessionEnd
  process.exit(0);
}

main();
