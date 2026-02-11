/**
 * Unified Telemetry Collector Implementation
 *
 * Provides JSONL local logging and Azure Application Insights integration
 * for cross-SDK event tracking.
 *
 * Reference: Feature 22 - Implement UnifiedTelemetryCollector
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import type {
  TelemetryCollector,
  TelemetryCollectorConfig,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryProperties,
  FlushResult,
} from "./types.ts";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default batch size before auto-flush */
const DEFAULT_BATCH_SIZE = 100;

/** Default flush interval in milliseconds (30 seconds) */
const DEFAULT_FLUSH_INTERVAL_MS = 30000;

/** Azure Application Insights ingestion endpoint */
const APP_INSIGHTS_ENDPOINT = "https://dc.services.visualstudio.com/v2/track";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a UUID v4.
 */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generation
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a stable anonymous ID from machine characteristics.
 *
 * Uses hostname, username, and platform to create a consistent
 * identifier that persists across sessions but cannot identify
 * the user personally.
 */
export function generateAnonymousId(): string {
  const machineInfo = [
    os.hostname(),
    os.userInfo().username,
    os.platform(),
    os.arch(),
  ].join("-");

  const hash = crypto.createHash("sha256").update(machineInfo).digest("hex");

  // Format as UUID-like string for consistency
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

/**
 * Get the default telemetry log path for the current platform.
 */
export function getDefaultLogPath(): string {
  const platform = os.platform();

  let dataDir: string;
  if (platform === "win32") {
    dataDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  } else if (platform === "darwin") {
    dataDir = path.join(os.homedir(), "Library", "Application Support");
  } else {
    dataDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  }

  return path.join(dataDir, "atomic", "telemetry");
}

/**
 * Check if telemetry should be enabled based on environment variables.
 */
export function shouldEnableTelemetry(): boolean {
  // Check DO_NOT_TRACK standard (https://consoledonottrack.com/)
  if (process.env.DO_NOT_TRACK === "1") {
    return false;
  }

  // Check ATOMIC_TELEMETRY env var
  if (process.env.ATOMIC_TELEMETRY === "0") {
    return false;
  }

  // Check CI environment (typically don't want telemetry in CI)
  if (process.env.CI === "true") {
    return false;
  }

  return true;
}

// ============================================================================
// UNIFIED TELEMETRY COLLECTOR
// ============================================================================

/**
 * Unified telemetry collector implementation.
 *
 * Features:
 * - Buffered event collection with configurable batch size
 * - Automatic flushing at intervals
 * - JSONL local logging for offline analysis
 * - Azure Application Insights integration for cloud analytics
 * - Respects DO_NOT_TRACK and ATOMIC_TELEMETRY environment variables
 *
 * @example
 * ```typescript
 * const collector = new UnifiedTelemetryCollector({
 *   enabled: true,
 *   localLogPath: "/path/to/logs",
 *   appInsightsKey: "your-key",
 * });
 *
 * collector.track("sdk.session.created", { agentType: "claude" });
 * await collector.shutdown();
 * ```
 */
export class UnifiedTelemetryCollector implements TelemetryCollector {
  private events: TelemetryEvent[] = [];
  private config: Required<TelemetryCollectorConfig>;
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;

  constructor(config: Partial<TelemetryCollectorConfig> = {}) {
    // Build complete config with defaults
    this.config = {
      enabled: config.enabled ?? shouldEnableTelemetry(),
      localLogPath: config.localLogPath ?? getDefaultLogPath(),
      appInsightsKey: config.appInsightsKey ?? process.env.ATOMIC_APP_INSIGHTS_KEY ?? "",
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      anonymousId: config.anonymousId ?? generateAnonymousId(),
    };

    // Start auto-flush interval if enabled
    if (this.config.enabled && this.config.flushIntervalMs > 0) {
      this.startFlushInterval();
    }
  }

  /**
   * Start the automatic flush interval.
   */
  private startFlushInterval(): void {
    if (this.flushIntervalId) {
      return;
    }

    this.flushIntervalId = setInterval(() => {
      if (this.events.length > 0) {
        void this.flush();
      }
    }, this.config.flushIntervalMs);

    // Unref to not keep process alive just for telemetry
    if (this.flushIntervalId.unref) {
      this.flushIntervalId.unref();
    }
  }

  /**
   * Stop the automatic flush interval.
   */
  private stopFlushInterval(): void {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }
  }

  /**
   * Track a telemetry event.
   */
  track(
    eventType: TelemetryEventType,
    properties: TelemetryProperties = {},
    options?: {
      sessionId?: string;
      executionId?: string;
    }
  ): void {
    if (!this.config.enabled || this.isShuttingDown) {
      return;
    }

    // Enrich properties with standard fields
    const enrichedProperties: TelemetryProperties = {
      ...properties,
      platform: properties.platform ?? os.platform(),
      nodeVersion: properties.nodeVersion ?? process.version,
      anonymousId: properties.anonymousId ?? this.config.anonymousId,
    };

    const event: TelemetryEvent = {
      eventId: generateUUID(),
      timestamp: new Date().toISOString(),
      eventType,
      properties: enrichedProperties,
    };

    if (options?.sessionId) {
      event.sessionId = options.sessionId;
    }

    if (options?.executionId) {
      event.executionId = options.executionId;
    }

    this.events.push(event);

    // Auto-flush if batch size reached
    if (this.events.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  /**
   * Flush all buffered events to storage and remote.
   */
  async flush(): Promise<FlushResult> {
    if (this.events.length === 0) {
      return {
        eventCount: 0,
        localLogSuccess: true,
        remoteSuccess: true,
      };
    }

    // Take events from buffer
    const eventsToFlush = [...this.events];
    this.events = [];

    let localLogSuccess = true;
    let remoteSuccess = true;
    let error: string | undefined;

    // Write to local JSONL log
    try {
      await this.writeToLocalLog(eventsToFlush);
    } catch (err) {
      localLogSuccess = false;
      error = err instanceof Error ? err.message : String(err);
    }

    // Send to Application Insights if configured
    if (this.config.appInsightsKey) {
      try {
        await this.sendToAppInsights(eventsToFlush);
      } catch (err) {
        remoteSuccess = false;
        if (!error) {
          error = err instanceof Error ? err.message : String(err);
        }
      }
    }

    const result: FlushResult = {
      eventCount: eventsToFlush.length,
      localLogSuccess,
      remoteSuccess,
    };

    if (error) {
      result.error = error;
    }

    return result;
  }

  /**
   * Write events to local JSONL log file.
   */
  private async writeToLocalLog(events: TelemetryEvent[]): Promise<void> {
    if (!this.config.localLogPath) {
      return;
    }

    // Ensure directory exists
    await fs.mkdir(this.config.localLogPath, { recursive: true });

    // Generate filename with date
    const date = new Date().toISOString().split("T")[0];
    const filename = `telemetry-${date}.jsonl`;
    const filepath = path.join(this.config.localLogPath, filename);

    // Write events as JSONL (one JSON object per line)
    const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";

    await fs.appendFile(filepath, lines, "utf-8");
  }

  /**
   * Send events to Azure Application Insights.
   */
  private async sendToAppInsights(events: TelemetryEvent[]): Promise<void> {
    if (!this.config.appInsightsKey) {
      return;
    }

    // Convert events to Application Insights format
    const telemetryItems = events.map((event) => ({
      name: "Microsoft.ApplicationInsights.Event",
      time: event.timestamp,
      iKey: this.config.appInsightsKey,
      tags: {
        "ai.user.id": this.config.anonymousId,
        "ai.operation.id": event.sessionId ?? event.eventId,
      },
      data: {
        baseType: "EventData",
        baseData: {
          ver: 2,
          name: event.eventType,
          properties: {
            eventId: event.eventId,
            sessionId: event.sessionId,
            executionId: event.executionId,
            ...event.properties,
          },
        },
      },
    }));

    // Send to Application Insights endpoint
    const response = await fetch(APP_INSIGHTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(telemetryItems),
    });

    if (!response.ok) {
      throw new Error(`App Insights request failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Check if telemetry collection is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current event buffer count.
   */
  getBufferSize(): number {
    return this.events.length;
  }

  /**
   * Get the collector configuration.
   */
  getConfig(): TelemetryCollectorConfig {
    return { ...this.config };
  }

  /**
   * Shutdown the collector, flushing remaining events.
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    // Stop auto-flush
    this.stopFlushInterval();

    // Flush remaining events
    if (this.events.length > 0) {
      await this.flush();
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new telemetry collector with the given configuration.
 */
export function createTelemetryCollector(
  config?: Partial<TelemetryCollectorConfig>
): TelemetryCollector {
  return new UnifiedTelemetryCollector(config);
}

/**
 * Create a no-op telemetry collector for testing or disabled scenarios.
 */
export function createNoopCollector(): TelemetryCollector {
  return {
    track: () => {},
    flush: async () => ({
      eventCount: 0,
      localLogSuccess: true,
      remoteSuccess: true,
    }),
    isEnabled: () => false,
    shutdown: async () => {},
    getBufferSize: () => 0,
    getConfig: () => ({ enabled: false }),
  };
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let globalCollector: TelemetryCollector | null = null;

/**
 * Get or create the global telemetry collector instance.
 */
export function getGlobalCollector(): TelemetryCollector {
  if (!globalCollector) {
    globalCollector = createTelemetryCollector();
  }
  return globalCollector;
}

/**
 * Set the global telemetry collector instance.
 * Useful for testing or custom configurations.
 */
export function setGlobalCollector(collector: TelemetryCollector): void {
  globalCollector = collector;
}

/**
 * Reset the global collector (for testing).
 */
export function resetGlobalCollector(): void {
  globalCollector = null;
}
