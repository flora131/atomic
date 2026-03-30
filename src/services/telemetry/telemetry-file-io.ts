import { existsSync, appendFileSync } from "fs";
import { join } from "path";
import { getBinaryDataDir } from "@/services/config/config-path.ts";
import { withLock } from "@/services/system/file-lock.ts";
import { ensureDirSync } from "@/services/system/copy.ts";
import type { TelemetryEvent, AgentType } from "@/services/telemetry/types.ts";

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
 * Uses file locking via withLock() for concurrent write safety,
 * with OS-level O_APPEND as a fallback guarantee.
 * Fails silently to ensure telemetry never breaks operation.
 *
 * @param event - The event object to append
 * @param agentType - Optional agent type for file isolation
 */
export async function appendEvent(event: TelemetryEvent, agentType?: AgentType | null): Promise<void> {
  try {
    const dataDir = getBinaryDataDir();

    // Ensure data directory exists before writing
    if (!existsSync(dataDir)) {
      ensureDirSync(dataDir);
    }

    const eventsPath = getEventsFilePath(agentType);
    const line = JSON.stringify(event) + "\n";

    await withLock(eventsPath, () => {
      appendFileSync(eventsPath, line, "utf-8");
    });
  } catch {
    // Fail silently - telemetry should never break the application
  }
}
