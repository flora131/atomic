/**
 * Telemetry upload module for sending buffered events to Azure App Insights
 *
 * Provides:
 * - readEventsFromJSONL() for parsing local event buffer
 * - filterStaleEvents() for 30-day cleanup
 * - emitEventsToAppInsights() for OpenTelemetry log emission
 * - handleTelemetryUpload() as the main entry point for --upload-telemetry flag
 *
 * Reference: specs/phase-6-telemetry-upload-backend.md
 */

import { existsSync, readFileSync, unlinkSync, renameSync, readdirSync } from "fs";
import { join } from "path";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { useAzureMonitor, shutdownAzureMonitor } from "@azure/monitor-opentelemetry";
import { getEventsFilePath } from "./telemetry-cli";
import { isTelemetryEnabledSync } from "./telemetry";
import { getBinaryDataDir } from "../config-path";
import { handleTelemetryError } from "./telemetry-errors";
import type {
  TelemetryEvent,
  AtomicCommandEvent,
  CliCommandEvent,
  AgentSessionEvent,
} from "./types";

/**
 * Configuration constants for telemetry upload
 * Reference: specs/phase-6-telemetry-upload-backend.md Section 5.4
 */
export const TELEMETRY_UPLOAD_CONFIG = {
  batch: {
    maxEvents: 100, // Segment standard
  },
  storage: {
    maxEventAge: 2592000000, // 30 days in milliseconds
  },
} as const;

/**
 * Default Azure Application Insights connection string
 *
 * This is safe to commit to the public repository because:
 * - Azure App Insights connection strings are write-only (ingestion only, no read access)
 * - This is industry-standard practice (same as Google Analytics, Segment, Mixpanel, etc.)
 * - Connection string only allows sending telemetry data, not querying or viewing it
 * - Access to view data requires Azure Portal authentication with separate credentials
 *
 * Can be overridden via APPLICATIONINSIGHTS_CONNECTION_STRING env var for:
 * - Testing against different environments
 * - Key rotation without code changes
 *
 * Reference: specs/phase-6-telemetry-upload-backend.md Section 5.2
 */
const DEFAULT_CONNECTION_STRING =
  "InstrumentationKey=a37b0072-f282-44a4-9c9f-3b8517ab3984;IngestionEndpoint=https://westus2-2.in.applicationinsights.azure.com/;LiveEndpoint=https://westus2.livediagnostics.monitor.azure.com/;ApplicationId=6d2a02dd-79ff-4f0e-a593-57fb8a1673da";

/**
 * Get the Application Insights connection string.
 * Checks for environment variable override first, falls back to default.
 */
function getConnectionString(): string {
  return process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || DEFAULT_CONNECTION_STRING;
}

/**
 * Result type for upload operations
 */
export interface UploadResult {
  success: boolean;
  eventsUploaded: number;
  eventsSkipped: number; // Stale events older than 30 days
  error?: string;
}

/**
 * Read and parse telemetry events from the local JSONL buffer file.
 *
 * @param filePath - Optional path to the JSONL file (defaults to getEventsFilePath())
 * @returns Array of valid TelemetryEvent objects (invalid lines are skipped)
 */
export function readEventsFromJSONL(filePath?: string): TelemetryEvent[] {
  const eventsPath = filePath ?? getEventsFilePath();

  // Return empty array if file doesn't exist
  if (!existsSync(eventsPath)) {
    return [];
  }

  try {
    const content = readFileSync(eventsPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const events: TelemetryEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as TelemetryEvent;

        // Validate required fields exist
        if (
          typeof parsed.anonymousId === "string" &&
          typeof parsed.eventId === "string" &&
          typeof parsed.eventType === "string" &&
          typeof parsed.timestamp === "string" &&
          typeof parsed.platform === "string" &&
          typeof parsed.atomicVersion === "string" &&
          typeof parsed.source === "string"
        ) {
          events.push(parsed);
        }
      } catch {
        // Skip invalid JSON lines - graceful degradation
        continue;
      }
    }

    return events;
  } catch {
    // Return empty array on any file read error
    return [];
  }
}

/**
 * Filter out stale events that are older than 30 days.
 *
 * @param events - Array of telemetry events
 * @returns Object containing valid events and count of stale events removed
 */
export function filterStaleEvents(events: TelemetryEvent[]): {
  valid: TelemetryEvent[];
  staleCount: number;
} {
  const now = Date.now();
  const cutoffTime = now - TELEMETRY_UPLOAD_CONFIG.storage.maxEventAge;

  const valid: TelemetryEvent[] = [];
  let staleCount = 0;

  for (const event of events) {
    const eventTime = Date.parse(event.timestamp);
    if (eventTime >= cutoffTime) {
      valid.push(event);
    } else {
      staleCount++;
    }
  }

  return { valid, staleCount };
}

/**
 * Find all telemetry event files in the data directory.
 * Looks for agent-specific files matching telemetry-events-{agent}.jsonl pattern.
 *
 * @returns Array of absolute paths to event files
 */
export function findAllEventFiles(): string[] {
  const dataDir = getBinaryDataDir();

  // Return empty array if directory doesn't exist
  if (!existsSync(dataDir)) {
    return [];
  }

  try {
    const files = readdirSync(dataDir);
    const eventFiles: string[] = [];

    for (const file of files) {
      // Match telemetry-events-{agent}.jsonl pattern
      if (file.startsWith("telemetry-events-") && file.endsWith(".jsonl")) {
        eventFiles.push(join(dataDir, file));
      }
    }

    return eventFiles;
  } catch (error) {
    handleTelemetryError(error, "findAllEventFiles");
    return [];
  }
}

/**
 * Split events into batches of the configured maximum size.
 *
 * @param events - Array of telemetry events
 * @param batchSize - Maximum events per batch (defaults to config value)
 * @returns Array of event batches
 */
export function splitIntoBatches(
  events: TelemetryEvent[],
  batchSize: number = 100
): TelemetryEvent[][] {
  const batches: TelemetryEvent[][] = [];

  for (let i = 0; i < events.length; i += batchSize) {
    batches.push(events.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Initialize the OpenTelemetry SDK with Azure Monitor configuration.
 *
 * @param connectionString - Azure App Insights connection string
 */
function initializeOpenTelemetry(connectionString: string): void {
  useAzureMonitor({
    azureMonitorExporterOptions: {
      connectionString,
    },
    enableLiveMetrics: false, // Disable for CLI apps (designed for servers)
  });
}

/**
 * Flush all pending telemetry and gracefully shutdown the SDK.
 * Critical for CLI apps to ensure data is sent before process exits.
 */
async function flushAndShutdown(): Promise<void> {
  try {
    await shutdownAzureMonitor();
  } catch {
    // Log warning but don't throw - graceful degradation
    // In a CLI context, we silently continue
  }
}

/**
 * Emit telemetry events to Azure App Insights via OpenTelemetry Logs API.
 *
 * @param events - Array of telemetry events to emit
 */
function emitEventsToAppInsights(events: TelemetryEvent[]): void {
  const logger = logs.getLogger("atomic-telemetry");

  for (const event of events) {
    // Type-safe attribute extraction
    const atomicCommandEvent = event as AtomicCommandEvent;
    const cliOrSessionEvent = event as CliCommandEvent | AgentSessionEvent;
    const sessionEvent = event as AgentSessionEvent;

    // Build attributes object, excluding null values for type safety
    const attributes: Record<string, string | number | boolean> = {
      // Required attribute for App Insights custom event routing
      "microsoft.custom_event.name": event.eventType,
      // Common fields
      anonymous_id: event.anonymousId,
      event_id: event.eventId,
      timestamp: event.timestamp,
      platform: event.platform,
      version: event.atomicVersion,
      source: event.source,
    };

    // Add event-specific fields if present
    if (atomicCommandEvent.command !== undefined) {
      attributes.command = atomicCommandEvent.command;
    }
    if (cliOrSessionEvent.commands !== undefined) {
      attributes.commands = cliOrSessionEvent.commands.join(",");
    }
    if (cliOrSessionEvent.commandCount !== undefined) {
      attributes.command_count = cliOrSessionEvent.commandCount;
    }
    if (event.agentType !== undefined && event.agentType !== null) {
      attributes.agent_type = event.agentType;
    }
    if (atomicCommandEvent.success !== undefined) {
      attributes.success = atomicCommandEvent.success;
    }
    if (sessionEvent.sessionId !== undefined) {
      attributes.session_id = sessionEvent.sessionId;
    }

    logger.emit({
      body: event.eventType,
      severityNumber: SeverityNumber.INFO,
      attributes,
    });
  }
}

/**
 * Main entry point for telemetry upload.
 * Called by the --upload-telemetry hidden CLI flag.
 *
 * Flow:
 * 1. Check if telemetry is enabled
 * 2. Find all telemetry event files (all agents + legacy)
 * 3. Claim ownership of files using atomic rename
 * 4. Read events from all claimed files
 * 5. Filter out stale events (>30 days old)
 * 6. Initialize OpenTelemetry SDK
 * 7. Emit events via Logs API
 * 8. Flush and shutdown SDK
 * 9. Delete all claimed files on success
 *
 * @returns Upload result with success status and counts
 */
export async function handleTelemetryUpload(): Promise<UploadResult> {
  const uploadId = crypto.randomUUID().slice(0, 8);

  // Check if telemetry is enabled
  if (!isTelemetryEnabledSync()) {
    return {
      success: true,
      eventsUploaded: 0,
      eventsSkipped: 0,
    };
  }

  // Find all telemetry event files (agent-specific + legacy)
  const eventFiles = findAllEventFiles();

  // Return early if no files to process
  if (eventFiles.length === 0) {
    return {
      success: true,
      eventsUploaded: 0,
      eventsSkipped: 0,
    };
  }

  // Claim ownership of all event files using atomic rename
  // This prevents race conditions where multiple upload processes read the same events
  const claimedFiles: string[] = [];
  const claimedPaths = new Map<string, string>(); // original -> claimed

  for (const originalPath of eventFiles) {
    const claimedPath = `${originalPath}.uploading.${uploadId}`;
    try {
      // Try to claim the file by renaming it (atomic operation)
      // Only ONE process can successfully rename - others will fail and skip this file
      renameSync(originalPath, claimedPath);
      claimedFiles.push(claimedPath);
      claimedPaths.set(claimedPath, originalPath);
    } catch {
      // File doesn't exist or another process already claimed it - skip
      continue;
    }
  }

  // Return early if no files were successfully claimed
  if (claimedFiles.length === 0) {
    return {
      success: true,
      eventsUploaded: 0,
      eventsSkipped: 0,
    };
  }

  // From this point forward, we have exclusive ownership of the claimed files
  try {
    // Read events from all claimed files
    let allEvents: TelemetryEvent[] = [];
    for (const claimedPath of claimedFiles) {
      const fileEvents = readEventsFromJSONL(claimedPath);
      allEvents = allEvents.concat(fileEvents);
    }

    // Return early if no events to upload
    if (allEvents.length === 0) {
      // Delete all claimed files since they're empty
      for (const claimedPath of claimedFiles) {
        try {
          unlinkSync(claimedPath);
        } catch {
          // Ignore deletion errors
        }
      }
      return {
        success: true,
        eventsUploaded: 0,
        eventsSkipped: 0,
      };
    }

    // Filter out stale events
    const { valid: validEvents, staleCount } = filterStaleEvents(allEvents);

    // Return early if no valid events after filtering
    if (validEvents.length === 0) {
      // Delete all claimed files since all events were stale
      for (const claimedPath of claimedFiles) {
        try {
          unlinkSync(claimedPath);
        } catch {
          // Ignore deletion errors
        }
      }
      return {
        success: true,
        eventsUploaded: 0,
        eventsSkipped: staleCount,
      };
    }

    // Initialize OpenTelemetry SDK with connection string (env var override or default)
    initializeOpenTelemetry(getConnectionString());

    // Split into batches and emit
    const batches = splitIntoBatches(validEvents);
    let totalEmitted = 0;

    for (const batch of batches) {
      emitEventsToAppInsights(batch);
      totalEmitted += batch.length;
    }

    // Flush and shutdown to ensure data is sent
    await flushAndShutdown();

    // Delete all claimed files on success
    for (const claimedPath of claimedFiles) {
      try {
        unlinkSync(claimedPath);
      } catch {
        // Ignore deletion errors
      }
    }

    return {
      success: true,
      eventsUploaded: totalEmitted,
      eventsSkipped: staleCount,
    };
  } catch (error) {
    // Graceful degradation - return failure result but don't throw

    // Try to restore all claimed files back to original paths on error
    // This ensures events aren't lost if upload fails
    for (const claimedPath of claimedFiles) {
      const originalPath = claimedPaths.get(claimedPath);
      if (originalPath) {
        try {
          renameSync(claimedPath, originalPath);
        } catch {
          // If we can't restore, the events are lost, but we still fail gracefully
        }
      }
    }

    return {
      success: false,
      eventsUploaded: 0,
      eventsSkipped: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}