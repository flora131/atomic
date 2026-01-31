/**
 * Telemetry Configuration Module
 *
 * Provides centralized configuration loading for telemetry collection,
 * respecting user consent and environment variables.
 *
 * Reference: Feature 25 - Implement consent-based telemetry collection with DO_NOT_TRACK support
 */

import * as os from "os";
import * as path from "path";
import type { TelemetryCollectorConfig } from "./types.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Core telemetry configuration interface.
 *
 * This is an alias for the collector config interface, focused on
 * the essential configuration fields for telemetry consent management.
 */
export interface TelemetryConfig {
  /** Whether telemetry collection is enabled */
  enabled: boolean;

  /** Path for local JSONL log files */
  localLogPath: string;

  /** Azure Application Insights connection key (optional) */
  appInsightsKey?: string;
}

/**
 * Options for loading telemetry configuration.
 */
export interface LoadTelemetryConfigOptions {
  /**
   * Override the enabled state.
   * If not provided, determined by environment variables.
   */
  enabled?: boolean;

  /**
   * Override the log path.
   * If not provided, uses platform-specific default.
   */
  localLogPath?: string;

  /**
   * Override the App Insights key.
   * If not provided, uses ATOMIC_APP_INSIGHTS_KEY env var.
   */
  appInsightsKey?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Environment variable names for telemetry configuration.
 */
export const TELEMETRY_ENV_VARS = {
  /** Standard "Do Not Track" environment variable */
  DO_NOT_TRACK: "DO_NOT_TRACK",
  /** Atomic-specific telemetry toggle */
  ATOMIC_TELEMETRY: "ATOMIC_TELEMETRY",
  /** Azure Application Insights connection key */
  ATOMIC_APP_INSIGHTS_KEY: "ATOMIC_APP_INSIGHTS_KEY",
  /** CI environment indicator */
  CI: "CI",
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the platform-specific data directory.
 *
 * Follows platform conventions:
 * - Windows: %APPDATA%
 * - macOS: ~/Library/Application Support
 * - Linux: $XDG_DATA_HOME or ~/.local/share
 *
 * @returns Platform-specific data directory path
 */
export function getPlatformDataDir(): string {
  const platform = os.platform();

  if (platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }

  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }

  // Linux and other Unix-like systems
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

/**
 * Get the default telemetry log path.
 *
 * Returns {dataDir}/atomic/telemetry based on platform conventions.
 *
 * @returns Default telemetry log directory path
 */
export function getDefaultTelemetryLogPath(): string {
  return path.join(getPlatformDataDir(), "atomic", "telemetry");
}

/**
 * Check if telemetry is enabled based on environment variables.
 *
 * Respects the following environment variables:
 * - DO_NOT_TRACK=1 - Standard "Do Not Track" signal (disables telemetry)
 * - ATOMIC_TELEMETRY=0 - Atomic-specific opt-out (disables telemetry)
 * - CI=true - Typically disables telemetry in CI environments
 *
 * @returns true if telemetry should be enabled, false otherwise
 *
 * @example
 * ```typescript
 * // Check if telemetry is enabled
 * if (isTelemetryEnabled()) {
 *   collector.track("event.name", properties);
 * }
 * ```
 */
export function isTelemetryEnabled(): boolean {
  // Check DO_NOT_TRACK standard (https://consoledonottrack.com/)
  if (process.env[TELEMETRY_ENV_VARS.DO_NOT_TRACK] === "1") {
    return false;
  }

  // Check ATOMIC_TELEMETRY env var
  if (process.env[TELEMETRY_ENV_VARS.ATOMIC_TELEMETRY] === "0") {
    return false;
  }

  // Check CI environment (typically don't want telemetry in CI)
  if (process.env[TELEMETRY_ENV_VARS.CI] === "true") {
    return false;
  }

  return true;
}

/**
 * Get the Application Insights key from environment.
 *
 * @returns Application Insights key or undefined if not set
 */
export function getAppInsightsKey(): string | undefined {
  const key = process.env[TELEMETRY_ENV_VARS.ATOMIC_APP_INSIGHTS_KEY];
  return key && key.trim() !== "" ? key : undefined;
}

// ============================================================================
// MAIN CONFIGURATION LOADER
// ============================================================================

/**
 * Load telemetry configuration from environment and defaults.
 *
 * This function provides a centralized way to load telemetry configuration,
 * respecting user consent via environment variables and providing
 * sensible platform-specific defaults.
 *
 * **Opt-Out Methods:**
 * - Set `DO_NOT_TRACK=1` (standard "Do Not Track" signal)
 * - Set `ATOMIC_TELEMETRY=0` (Atomic-specific opt-out)
 * - Running in CI environments (`CI=true`) disables telemetry by default
 *
 * **Configuration:**
 * - Set `ATOMIC_APP_INSIGHTS_KEY` to enable Azure Application Insights reporting
 *
 * @param options - Optional overrides for configuration values
 * @returns Complete telemetry configuration
 *
 * @example
 * ```typescript
 * // Load default configuration
 * const config = loadTelemetryConfig();
 *
 * // Load with overrides
 * const customConfig = loadTelemetryConfig({
 *   enabled: true, // Force enable for testing
 *   localLogPath: "/custom/path",
 * });
 *
 * // Use with collector
 * const collector = createTelemetryCollector(config);
 * ```
 */
export function loadTelemetryConfig(
  options: LoadTelemetryConfigOptions = {}
): TelemetryConfig {
  // Determine enabled state (options override environment)
  const enabled = options.enabled ?? isTelemetryEnabled();

  // Determine log path (options override default)
  const localLogPath = options.localLogPath ?? getDefaultTelemetryLogPath();

  // Determine App Insights key (options override environment)
  const appInsightsKey = options.appInsightsKey ?? getAppInsightsKey();

  return {
    enabled,
    localLogPath,
    appInsightsKey,
  };
}

/**
 * Convert TelemetryConfig to TelemetryCollectorConfig.
 *
 * This function converts the core TelemetryConfig to the full
 * TelemetryCollectorConfig expected by the collector, adding
 * default values for batch size and flush interval.
 *
 * @param config - Core telemetry configuration
 * @param options - Additional collector options
 * @returns Full collector configuration
 */
export function toCollectorConfig(
  config: TelemetryConfig,
  options: Partial<Omit<TelemetryCollectorConfig, keyof TelemetryConfig>> = {}
): TelemetryCollectorConfig {
  return {
    ...config,
    ...options,
  };
}

/**
 * Create a descriptive summary of the telemetry configuration.
 *
 * Useful for logging or displaying to users what telemetry settings are active.
 *
 * @param config - Telemetry configuration to describe
 * @returns Human-readable configuration summary
 */
export function describeTelemetryConfig(config: TelemetryConfig): string {
  const lines: string[] = [
    `Telemetry: ${config.enabled ? "enabled" : "disabled"}`,
    `Log path: ${config.localLogPath}`,
  ];

  if (config.appInsightsKey) {
    lines.push("App Insights: configured");
  }

  return lines.join("\n");
}

/**
 * Check if telemetry was disabled by a specific environment variable.
 *
 * Useful for providing feedback to users about why telemetry is disabled.
 *
 * @returns Object indicating which env var disabled telemetry, or null if enabled
 */
export function getTelemetryDisabledReason(): {
  envVar: string;
  value: string;
} | null {
  if (process.env[TELEMETRY_ENV_VARS.DO_NOT_TRACK] === "1") {
    return { envVar: TELEMETRY_ENV_VARS.DO_NOT_TRACK, value: "1" };
  }

  if (process.env[TELEMETRY_ENV_VARS.ATOMIC_TELEMETRY] === "0") {
    return { envVar: TELEMETRY_ENV_VARS.ATOMIC_TELEMETRY, value: "0" };
  }

  if (process.env[TELEMETRY_ENV_VARS.CI] === "true") {
    return { envVar: TELEMETRY_ENV_VARS.CI, value: "true" };
  }

  return null;
}
