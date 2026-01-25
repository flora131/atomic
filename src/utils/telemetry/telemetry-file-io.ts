import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { getBinaryDataDir } from "../config-path";
import type { TelemetryEvent, AgentType } from "./types";

/**
 * Low-level file I/O operations for telemetry.
 * Extracted to single source to avoid duplication between telemetry-cli.ts and telemetry-session.ts.
 */

/**
 * Get path to telemetry-events-{agent}.jsonl file.
 *
 * @param agentType - Optional agent type for file isolation (defaults to "atomic" for agent-agnostic events)
 * @returns Absolute path to telemetry-events-{agent}.jsonl in the data directory
 */
export function getEventsFilePath(agentType?: AgentType | null): string {
  const agent = agentType || "atomic";
  return join(getBinaryDataDir(), `telemetry-events-${agent}.jsonl`);
}

/**
 * Append an event to the telemetry events JSONL file.
 * Uses atomic append-only writes for concurrent safety.
 * Fails silently to ensure telemetry never breaks operation.
 *
 * @param event - The event object to append
 * @param agentType - Optional agent type for file isolation
 */
export function appendEvent(event: TelemetryEvent, agentType?: AgentType | null): void {
  try {
    const dataDir = getBinaryDataDir();

    // Ensure data directory exists before writing
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const eventsPath = getEventsFilePath(agentType);
    const line = JSON.stringify(event) + "\n";

    // Atomic append-only write
    appendFileSync(eventsPath, line, "utf-8");
  } catch {
    // Fail silently - telemetry should never break the application
  }
}
