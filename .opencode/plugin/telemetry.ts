import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { spawn } from "child_process"

/**
 * Telemetry Plugin for OpenCode
 *
 * Tracks Atomic slash commands used during OpenCode sessions.
 * Writes agent_session events to the telemetry buffer file when sessions end.
 *
 * Reference: Spec Section 5.3.3
 */

// Atomic commands to track (must match constants.ts)
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

type AgentType = "claude" | "opencode" | "copilot"

interface AgentSessionEvent {
  anonymousId: string
  eventId: string
  sessionId: string
  eventType: "agent_session"
  timestamp: string
  sessionStartedAt: string | null
  agentType: AgentType
  commands: string[]
  commandCount: number
  platform: NodeJS.Platform
  atomicVersion: string
  source: "session_hook"
}

interface TelemetryState {
  enabled: boolean
  anonymousId: string
}

/**
 * Get the telemetry data directory
 * Follows same logic as config-path.ts getBinaryDataDir()
 */
function getTelemetryDataDir(): string {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local")
    return join(localAppData, "atomic")
  }
  const xdgDataHome = process.env.XDG_DATA_HOME || join(process.env.HOME || "", ".local", "share")
  return join(xdgDataHome, "atomic")
}

/**
 * Get path to telemetry-events.jsonl
 */
function getEventsFilePath(): string {
  return join(getTelemetryDataDir(), "telemetry-events.jsonl")
}

/**
 * Get path to telemetry.json state file
 */
function getTelemetryStatePath(): string {
  return join(getTelemetryDataDir(), "telemetry.json")
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
    return state.enabled === true
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
 * Get Atomic version
 */
function getAtomicVersion(): string {
  return "unknown" // Plugin doesn't have easy access to atomic version
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
 * Write session event to telemetry file
 */
function writeSessionEvent(
  agentType: AgentType,
  commands: string[],
  sessionStartedAt: string | null
): void {
  if (!isTelemetryEnabled()) return
  if (commands.length === 0) return

  const anonymousId = getAnonymousId()
  if (!anonymousId) return

  const eventId = crypto.randomUUID()

  const event: AgentSessionEvent = {
    anonymousId,
    eventId,
    sessionId: eventId,
    eventType: "agent_session",
    timestamp: new Date().toISOString(),
    sessionStartedAt,
    agentType,
    commands,
    commandCount: commands.length,
    platform: process.platform,
    atomicVersion: getAtomicVersion(),
    source: "session_hook",
  }

  const eventsPath = getEventsFilePath()
  const eventsDir = dirname(eventsPath)

  try {
    if (!existsSync(eventsDir)) {
      mkdirSync(eventsDir, { recursive: true })
    }
    appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf-8")
  } catch {
    // Fail silently - telemetry should never break plugin
  }
}

/**
 * Spawn background upload process
 */
function spawnUpload(): void {
  try {
    // Find atomic binary
    const atomicPath =
      process.platform === "win32"
        ? join(process.env.USERPROFILE || "", ".local", "bin", "atomic.exe")
        : join(process.env.HOME || "", ".local", "bin", "atomic")

    if (existsSync(atomicPath)) {
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

// Track session start time and accumulated commands
// Using array (not Set) to preserve duplicates for usage frequency tracking
let sessionStartTime: string | null = null
let sessionCommands: string[] = []

export default {
  name: "telemetry",
  version: "1.0.0",
  description: "Tracks Atomic slash command usage for anonymous telemetry",

  create: ({ directory, client }) => ({
    /**
     * Handle events for telemetry tracking
     */
    event: async ({ event }) => {
      // Track session start
      if (event.type === "session.start" || event.type === "session.created") {
        sessionStartTime = new Date().toISOString()
        sessionCommands = []
        return
      }

      // Track commands from messages
      if (event.type === "message.created" || event.type === "message.updated") {
        const content = event.properties?.content
        if (typeof content === "string") {
          const commands = extractCommands(content)
          // Append all commands (including duplicates) for usage frequency tracking
          sessionCommands.push(...commands)
        }
        return
      }

      // Track session end
      if (event.type === "session.end" || event.type === "session.closed") {
        if (sessionCommands.length > 0) {
          writeSessionEvent("opencode", sessionCommands, sessionStartTime)
          spawnUpload()
        }
        // Reset for next session
        sessionStartTime = null
        sessionCommands = []
        return
      }

      // Also check for idle status as session end indicator
      if (event.type === "session.status" && event.properties?.status?.type === "idle") {
        // Don't end the session on idle - wait for explicit session end
        // But we can extract commands from any accumulated messages
        return
      }
    },
  }),
} satisfies Plugin
