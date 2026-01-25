#!/usr/bin/env bun

/**
 * Claude Code Stop Hook - Telemetry Tracking
 *
 * This hook is called when a Claude Code session ends.
 * It extracts Atomic slash commands from the session transcript
 * and logs an agent_session telemetry event.
 *
 * Reference: Spec Section 5.3.3
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

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
    const stateContent = (await Bun.file(stateFile).json()) as any;
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
      const stateContent = (await Bun.file(stateFile).json()) as any;
      return stateContent?.anonymousId || null;
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
    const result = await $`atomic --version`.text();
    return result.trim().replace(/^atomic v/, "") || "unknown";
  } catch {
    return "unknown";
  }
}

// Extract Atomic commands from JSONL transcript
// CRITICAL: Only extracts from string content in user messages (user-typed commands)
// Array content in user messages means skill instructions were loaded - we ignore these
// Usage: extractCommands("transcript JSONL content")
// Output: comma-separated list of found commands
function extractCommands(transcript: string): string {
  const foundCommands: string[] = [];

  // Process each line (JSONL format - one JSON object per line)
  const lines = transcript.split("\n");
  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);

      // Extract type from JSON (skip if not user message)
      const msgType = parsed?.type;
      if (msgType !== "user") continue;

      // Check content type - only process string content (user-typed commands)
      // Array content = skill instructions loaded, which contain command references we should ignore
      const content = parsed?.message?.content;
      if (typeof content !== "string") continue;

      // Extract text content from user message (string content only)
      const text = content;
      if (!text) continue;

      // Find all commands in this user message
      for (const cmd of ATOMIC_COMMANDS) {
        // Escape special regex characters
        const escapedCmd = cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // Count occurrences (for usage frequency tracking)
        const regex = new RegExp(`(^|[\\s]|[^\\w/_-])${escapedCmd}([\\s]|$|[^\\w_-])`, "g");
        const matches = text.match(regex);
        const count = matches ? matches.length : 0;

        // Add command once for each occurrence
        for (let i = 0; i < count; i++) {
          foundCommands.push(cmd);
        }
      }
    } catch {
      // Skip invalid JSON lines
      continue;
    }
  }

  // Return commands (comma-separated, preserving duplicates for frequency tracking)
  return foundCommands.join(",");
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

// Write an agent session event to the telemetry events file
// Source of truth: src/utils/telemetry/telemetry-file-io.ts appendEvent()
// Keep synchronized when changing event structure or file writing logic
//
// Arguments:
//   agentType: "claude", "opencode", or "copilot"
//   commands: comma-separated list of commands (e.g., "/commit,/create-gh-pr")
//   sessionStartedAt: ISO timestamp when session started (unused, kept for parity)
//
// Returns: true on success, false on failure
async function writeSessionEvent(agentType: string, commandsStr: string, _sessionStartedAt?: string): Promise<boolean> {
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
  await Bun.write(eventsFile, (await Bun.file(eventsFile).text().catch(() => "")) + JSON.stringify(eventJson) + "\n");

  return true;
}

// Spawn background upload process
// Usage: spawnUploadProcess()
async function spawnUploadProcess(): Promise<void> {
  try {
    // Check if atomic command exists
    await $`command -v atomic`.quiet();
    // Spawn in background
    $`nohup atomic --upload-telemetry > /dev/null 2>&1 &`.quiet().nothrow();
  } catch {
    // atomic not available, skip
  }
}

// Main execution
async function main(): Promise<void> {
  // Read hook input from stdin
  // Claude Code passes JSON with session information including transcript_path
  const input = await Bun.stdin.text();

  // Parse input fields
  let transcriptPath: string | undefined;
  let sessionStartedAt: string | undefined;

  try {
    const parsed = JSON.parse(input);
    transcriptPath = parsed?.transcript_path || undefined;
    sessionStartedAt = parsed?.session_started_at || undefined;
  } catch {
    process.exit(0);
  }

  // Early exit if no transcript available
  if (!transcriptPath || !existsSync(transcriptPath)) {
    process.exit(0);
  }

  // Read transcript content
  let transcript: string;
  try {
    transcript = await Bun.file(transcriptPath).text();
  } catch {
    transcript = "";
  }

  // Early exit if transcript is empty
  if (!transcript) {
    process.exit(0);
  }

  // Extract commands from transcript
  const commands = extractCommands(transcript);

  // Write session event (helper handles telemetry enabled check)
  if (commands) {
    await writeSessionEvent("claude", commands, sessionStartedAt);

    // Spawn upload process
    // Atomic file operations prevent duplicate uploads even if multiple processes spawn
    await spawnUploadProcess();
  }

  // Exit successfully (don't block session end)
  process.exit(0);
}

main();
