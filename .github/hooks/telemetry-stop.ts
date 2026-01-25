#!/usr/bin/env bun

/**
 * Telemetry Stop Hook - Session End Handler
 *
 * Handles sessionEnd: reads accumulated commands from temp file,
 * detects Copilot agents, writes telemetry event, cleans up, and spawns upload.
 */

import { existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

// Temp file path (must match telemetry-session.ts)
const TEMP_FILE = ".github/telemetry-session-commands.tmp";

// ============================================================================
// TELEMETRY HELPERS
// ============================================================================

function getTelemetryDataDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData/Local");
    return join(appData, "atomic");
  }
  const xdgData = process.env.XDG_DATA_HOME || join(process.env.HOME || "", ".local/share");
  return join(xdgData, "atomic");
}

function getEventsFilePath(agentType: string): string {
  return join(getTelemetryDataDir(), `telemetry-events-${agentType}.jsonl`);
}

function getTelemetryStatePath(): string {
  return join(getTelemetryDataDir(), "telemetry.json");
}

async function isTelemetryEnabled(): Promise<boolean> {
  if (process.env.ATOMIC_TELEMETRY === "0" || process.env.DO_NOT_TRACK === "1") {
    return false;
  }
  const stateFile = getTelemetryStatePath();
  if (!existsSync(stateFile)) return false;
  try {
    const state = (await Bun.file(stateFile).json()) as Record<string, unknown>;
    return state?.enabled === true && state?.consentGiven === true;
  } catch {
    return false;
  }
}

async function getAnonymousId(): Promise<string | null> {
  const stateFile = getTelemetryStatePath();
  if (!existsSync(stateFile)) return null;
  try {
    const state = (await Bun.file(stateFile).json()) as Record<string, unknown>;
    return (state?.anonymousId as string) || null;
  } catch {
    return null;
  }
}

async function getAtomicVersion(): Promise<string> {
  try {
    const proc = Bun.spawn(["atomic", "--version"], { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim().replace(/^atomic v/, "") || "unknown";
  } catch {
    return "unknown";
  }
}

function getPlatform(): string {
  const p = process.platform;
  return p === "darwin" || p === "linux" || p === "win32" ? p : "unknown";
}

// ============================================================================
// TEMP FILE OPERATIONS
// ============================================================================

async function readAccumulatedCommands(): Promise<string[]> {
  if (!existsSync(TEMP_FILE)) return [];
  try {
    const content = await Bun.file(TEMP_FILE).text();
    return content.split("\n").filter((line) => line.trim());
  } catch {
    return [];
  }
}

function clearTempFile(): void {
  if (existsSync(TEMP_FILE)) {
    try {
      unlinkSync(TEMP_FILE);
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// COPILOT AGENT DETECTION
// ============================================================================

function findLatestDirectory(parentDir: string): string | null {
  if (!existsSync(parentDir)) return null;
  try {
    let latestDir: string | null = null;
    let latestMtime = 0;
    for (const entry of readdirSync(parentDir)) {
      const fullPath = join(parentDir, entry);
      try {
        const stats = statSync(fullPath);
        if (stats.isDirectory() && stats.mtimeMs > latestMtime) {
          latestMtime = stats.mtimeMs;
          latestDir = fullPath;
        }
      } catch {
        continue;
      }
    }
    return latestDir;
  } catch {
    return null;
  }
}

async function detectCopilotAgents(): Promise<string[]> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const copilotStateDir = join(homeDir, ".copilot/session-state");
  if (!existsSync(copilotStateDir)) return [];

  const latestSession = findLatestDirectory(copilotStateDir);
  if (!latestSession) return [];

  const eventsFile = join(latestSession, "events.jsonl");
  if (!existsSync(eventsFile)) return [];

  const foundAgents: string[] = [];
  try {
    const content = await Bun.file(eventsFile).text();
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const eventType = parsed?.type as string | undefined;

        // Method 1: task tool calls with agent_type
        if (eventType === "assistant.message") {
          const toolRequests = (parsed?.data as Record<string, unknown>)?.toolRequests as Array<Record<string, unknown>> | undefined;
          if (toolRequests) {
            for (const req of toolRequests) {
              if (req?.name === "task") {
                const agentType = (req?.arguments as Record<string, unknown>)?.agent_type as string | undefined;
                if (agentType && existsSync(`.github/agents/${agentType}.md`)) {
                  foundAgents.push(`/${agentType}`);
                }
              }
            }
          }
        }

        // Method 2: tool.execution_complete with agent_name
        if (eventType === "tool.execution_complete") {
          const props = ((parsed?.data as Record<string, unknown>)?.toolTelemetry as Record<string, unknown>)?.properties as Record<string, unknown> | undefined;
          const agentName = props?.agent_name as string | undefined;
          if (agentName && existsSync(`.github/agents/${agentName}.md`)) {
            foundAgents.push(`/${agentName}`);
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return foundAgents;
}

// ============================================================================
// EVENT WRITING & UPLOAD
// ============================================================================

async function writeSessionEvent(commands: string[]): Promise<boolean> {
  if (!(await isTelemetryEnabled()) || commands.length === 0) return true;

  const anonymousId = await getAnonymousId();
  if (!anonymousId) return false;

  const eventJson = {
    anonymousId,
    eventId: randomUUID(),
    sessionId: randomUUID(),
    eventType: "agent_session",
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    agentType: "copilot",
    commands,
    commandCount: commands.length,
    platform: getPlatform(),
    atomicVersion: await getAtomicVersion(),
    source: "session_hook",
  };

  const eventsFile = getEventsFilePath("copilot");
  const eventsDir = dirname(eventsFile);
  if (!existsSync(eventsDir)) mkdirSync(eventsDir, { recursive: true });

  const existing = await Bun.file(eventsFile).text().catch(() => "");
  await Bun.write(eventsFile, existing + JSON.stringify(eventJson) + "\n");
  return true;
}

function spawnUploadProcess(): void {
  try {
    const isWindows = process.platform === "win32";
    const child = spawn(isWindows ? "atomic.exe" : "atomic", ["upload-telemetry"], {
      detached: true,
      stdio: "ignore",
      shell: isWindows,
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Ignore
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  if (!(await isTelemetryEnabled())) {
    clearTempFile();
    process.exit(0);
  }

  const accumulatedCommands = await readAccumulatedCommands();
  const detectedAgents = await detectCopilotAgents();
  const allCommands = [...accumulatedCommands, ...detectedAgents];

  if (allCommands.length > 0) {
    await writeSessionEvent(allCommands);
    spawnUploadProcess();
  }

  clearTempFile();
  process.exit(0);
}

main();
