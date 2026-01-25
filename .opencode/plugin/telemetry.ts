import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "fs"
import { join } from "path"
import { spawn, execSync } from "child_process"

/**
 * Telemetry Plugin for OpenCode
 *
 * Tracks Atomic slash commands used during OpenCode sessions.
 * Writes agent_session events to the telemetry buffer file when sessions end.
 *
 * Detection Strategy:
 * 1. Primary: command.execute.before hook - receives command name directly
 * 2. Fallback: chat.message hook - detects commands in agent responses
 *
 * OpenCode Hooks Used:
 * - command.execute.before: Intercept slash commands before expansion
 * - chat.message: Process expanded message content (fallback detection)
 *
 * OpenCode Event Types Used:
 * - session.created: New session initialized
 * - session.status: Session execution status (idle/busy/retry)
 * - session.deleted: Session removed
 *
 * Reference: Spec Section 5.3.3
 * OpenCode Docs: https://opencode.ai/docs/plugins/
 *
 * NOTE: This plugin is self-contained with all dependencies inlined.
 * This is necessary because the plugin runs separately from the Atomic CLI binary.
 */

// ============================================================================
// Inlined Types (from src/utils/telemetry/types.ts)
// ============================================================================

/** Agent types supported by Atomic */
type AgentType = "claude" | "opencode" | "copilot"

/** Persistent telemetry state stored in telemetry.json */
interface TelemetryState {
  enabled: boolean
  consentGiven: boolean
  anonymousId: string
  createdAt: string
  rotatedAt: string
}

/** Event logged when an agent session ends */
interface AgentSessionEvent {
  anonymousId: string
  eventId: string
  sessionId: string
  eventType: "agent_session"
  timestamp: string
  agentType: AgentType
  commands: string[]
  commandCount: number
  platform: NodeJS.Platform
  atomicVersion: string
  source: "session_hook"
}

// ============================================================================
// Inlined Constants (from src/utils/telemetry/constants.ts)
// ============================================================================

/**
 * List of all Atomic slash commands that are tracked.
 * Includes both short and fully-qualified (namespace:command) forms.
 *
 * IMPORTANT: This list is duplicated in:
 * - src/utils/telemetry/constants.ts (source of truth)
 * - bin/telemetry-helper.sh (ATOMIC_COMMANDS array)
 *
 * Tests in atomic-commands-sync.test.ts verify synchronization.
 */
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
] as const

// Plugin version - used when CLI version is not available
const PLUGIN_VERSION = "opencode-plugin"

// ============================================================================
// Inlined Utilities (from src/utils/config-path.ts, src/utils/detect.ts)
// ============================================================================

/** Check if running on Windows */
function isWindows(): boolean {
  return process.platform === "win32"
}

/**
 * Get the data directory for Atomic installations.
 * Follows XDG Base Directory spec on Unix, uses LOCALAPPDATA on Windows.
 * - Unix: $XDG_DATA_HOME/atomic or ~/.local/share/atomic
 * - Windows: %LOCALAPPDATA%\atomic
 */
function getBinaryDataDir(): string {
  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local")
    return join(localAppData, "atomic")
  }
  const xdgDataHome = process.env.XDG_DATA_HOME || join(process.env.HOME || "", ".local", "share")
  return join(xdgDataHome, "atomic")
}

// ============================================================================
// Inlined Error Handling (from src/utils/telemetry/telemetry-errors.ts)
// ============================================================================

const DEBUG_MODE = process.env.ATOMIC_TELEMETRY_DEBUG === "1"

/**
 * Handle telemetry errors with consistent silent-by-default behavior.
 * Enables debug logging when ATOMIC_TELEMETRY_DEBUG=1 is set.
 */
function handleTelemetryError(error: unknown, context: string): void {
  if (DEBUG_MODE) {
    console.error(`[Telemetry Debug: ${context}]`, error)
  }
  // Otherwise, silent - telemetry must never break user workflows
}

// ============================================================================
// Inlined File I/O (from src/utils/telemetry/telemetry-file-io.ts)
// ============================================================================

/**
 * Get path to telemetry-events-{agent}.jsonl file.
 */
function getEventsFilePath(agentType?: AgentType | null): string {
  const agent = agentType || "atomic"
  return join(getBinaryDataDir(), `telemetry-events-${agent}.jsonl`)
}

/**
 * Append an event to the telemetry events JSONL file.
 * Uses atomic append-only writes for concurrent safety.
 * Fails silently to ensure telemetry never breaks operation.
 */
function appendEvent(event: AgentSessionEvent, agentType?: AgentType | null): void {
  try {
    const dataDir = getBinaryDataDir()

    // Ensure data directory exists before writing
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    const eventsPath = getEventsFilePath(agentType)
    const line = JSON.stringify(event) + "\n"

    // appendFileSync relies on OS-level O_APPEND atomicity for concurrent safety
    appendFileSync(eventsPath, line, "utf-8")
  } catch {
    // Fail silently - telemetry should never break the application
  }
}

// ============================================================================
// Plugin-specific Telemetry Functions
// ============================================================================

/**
 * Get path to telemetry.json state file
 */
function getTelemetryStatePath(): string {
  return join(getBinaryDataDir(), "telemetry.json")
}

/**
 * Check if telemetry is enabled
 */
function isTelemetryEnabled(): boolean {
  // Check environment variables
  if (process.env.ATOMIC_TELEMETRY === "0") return false
  if (process.env.DO_NOT_TRACK === "1") return false

  // Check telemetry state file
  const statePath = getTelemetryStatePath()
  if (!existsSync(statePath)) return false

  try {
    const state: TelemetryState = JSON.parse(readFileSync(statePath, "utf-8"))
    return state.enabled === true && state.consentGiven === true
  } catch {
    return false
  }
}

/**
 * Get anonymous ID from telemetry state
 */
function getAnonymousId(): string | null {
  const statePath = getTelemetryStatePath()
  if (!existsSync(statePath)) return null

  try {
    const state: TelemetryState = JSON.parse(readFileSync(statePath, "utf-8"))
    return state.anonymousId || null
  } catch {
    return null
  }
}

/**
 * Normalize command name to match ATOMIC_COMMANDS format.
 * Handles both "command-name" and "/command-name" formats.
 */
function normalizeCommandName(commandName: string): string | null {
  const withSlash = commandName.startsWith("/") ? commandName : `/${commandName}`
  return ATOMIC_COMMANDS.includes(withSlash as any) ? withSlash : null
}

/**
 * Extract Atomic commands from message text.
 * Counts all occurrences to track actual usage frequency.
 */
function extractCommands(text: string): string[] {
  const found: string[] = []

  for (const cmd of ATOMIC_COMMANDS) {
    // Escape special regex characters
    const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // Match command at word boundaries
    const regex = new RegExp(`(?:^|\\s|[^\\w/])${escaped}(?:\\s|$|[^\\w-:])`, "g")
    // Count all occurrences of this command (for usage frequency tracking)
    const matches = text.match(regex)
    if (matches) {
      for (let i = 0; i < matches.length; i++) {
        found.push(cmd)
      }
    }
  }

  return found
}

/**
 * Create an AgentSessionEvent with all required fields.
 */
function createSessionEvent(agentType: AgentType, commands: string[], anonymousId: string): AgentSessionEvent {
  const sessionId = crypto.randomUUID()

  return {
    anonymousId,
    eventId: sessionId,
    sessionId,
    eventType: "agent_session",
    timestamp: new Date().toISOString(),
    agentType,
    commands,
    commandCount: commands.length,
    platform: process.platform,
    atomicVersion: PLUGIN_VERSION,
    source: "session_hook",
  }
}

/**
 * Write session event to telemetry file
 */
function writeSessionEvent(agentType: AgentType, commands: string[]): void {
  try {
    if (!isTelemetryEnabled()) {
      return
    }
    if (commands.length === 0) {
      return
    }

    const anonymousId = getAnonymousId()
    if (!anonymousId) {
      return
    }

    const event = createSessionEvent(agentType, commands, anonymousId)
    appendEvent(event, agentType)
  } catch (error) {
    handleTelemetryError(error, "opencode:writeSessionEvent")
  }
}

/**
 * Spawn background upload process
 */
function spawnUpload(): void {
  try {
    let atomicPath: string | null = null

    // Method 1: Check for bun installation (preferred for bun installs)
    // Bun installations are typically at ~/.bun/bin/atomic and are script files
    const bunPath = isWindows()
      ? join(process.env.USERPROFILE || "", ".bun", "bin", "atomic.exe")
      : join(process.env.HOME || "", ".bun", "bin", "atomic")

    if (existsSync(bunPath)) {
      atomicPath = bunPath
    }

    // Method 2: Try to find atomic in PATH (works for both bun and native if in PATH)
    if (!atomicPath) {
      try {
        const whichCommand = isWindows() ? "where atomic" : "which atomic"
        const result = execSync(whichCommand, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
        atomicPath = result.trim().split("\n")[0]
      } catch {
        // Not in PATH
      }
    }

    // Method 3: Fall back to hardcoded native installation path
    if (!atomicPath) {
      const nativePath = isWindows()
        ? join(process.env.USERPROFILE || "", ".local", "bin", "atomic.exe")
        : join(process.env.HOME || "", ".local", "bin", "atomic")

      if (existsSync(nativePath)) {
        atomicPath = nativePath
      }
    }

    // Spawn upload process if we found a binary
    if (atomicPath) {
      const child = spawn(atomicPath, ["--upload-telemetry"], {
        detached: true,
        stdio: "ignore",
      })
      child.unref()
    }
  } catch {
    // Fail silently
  }
}

// Track accumulated commands during session
// Using array (not Set) to preserve duplicates for usage frequency tracking
let sessionCommands: string[] = []

export const TelemetryPlugin: Plugin = async () => {
  return {
    /**
     * HOOK: command.execute.before
     * Primary detection method - intercepts slash commands before expansion
     * Receives the command name directly (e.g., "research-codebase")
     */
    "command.execute.before": async (input) => {
      const commandName = normalizeCommandName(input.command)

      if (commandName) {
        sessionCommands.push(commandName)
      }
    },

    /**
     * HOOK: chat.message
     * Fallback detection for commands mentioned in agent responses
     * E.g., when an agent says "I'll use /commit to save your changes"
     */
    "chat.message": async (_input, output) => {
      for (const part of output.parts) {
        if (part.type === "text" && typeof part.text === "string") {
          // Check if message contains slash commands mentioned in text (agent responses)
          const commands = extractCommands(part.text)
          if (commands.length > 0) {
            sessionCommands.push(...commands)
          }
        }
      }
    },

    /**
     * Handle events for telemetry tracking
     */
    event: async ({ event }) => {
      // Track session start
      if (event.type === "session.created") {
        sessionCommands = []
        return
      }

      // Track session end via status idle (preferred method)
      if (event.type === "session.status") {
        const status = event.properties?.status
        if (status?.type === "idle" && sessionCommands.length > 0) {
          writeSessionEvent("opencode", sessionCommands)
          spawnUpload()
          // Reset for next interaction (but don't clear - session may continue)
          sessionCommands = []
        }
        return
      }

      // Also handle explicit session deletion as cleanup
      if (event.type === "session.deleted") {
        if (sessionCommands.length > 0) {
          writeSessionEvent("opencode", sessionCommands)
          spawnUpload()
        }
        sessionCommands = []
        return
      }
    },
  }
}
