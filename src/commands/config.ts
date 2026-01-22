/**
 * Config command - Manage Atomic CLI configuration
 *
 * Usage: atomic config set <key> <value>
 *
 * Currently supported:
 *   atomic config set telemetry true|false
 */

import { log } from "@clack/prompts";
import { setTelemetryEnabled } from "../utils/telemetry";

/**
 * Execute the config command
 *
 * @param subcommand - The config subcommand (currently only 'set' is supported)
 * @param key - The configuration key (currently only 'telemetry' is supported)
 * @param value - The value to set
 *
 * @example
 * ```ts
 * // Enable telemetry
 * await configCommand('set', 'telemetry', 'true');
 *
 * // Disable telemetry
 * await configCommand('set', 'telemetry', 'false');
 * ```
 */
export async function configCommand(
  subcommand: string | undefined,
  key: string | undefined,
  value: string | undefined
): Promise<void> {
  // Validate subcommand
  if (!subcommand) {
    log.error("Missing subcommand. Usage: atomic config set <key> <value>");
    process.exit(1);
  }

  if (subcommand !== "set") {
    log.error(`Unknown subcommand: ${subcommand}. Only 'set' is supported.`);
    process.exit(1);
  }

  // Validate key
  if (!key) {
    log.error("Missing key. Usage: atomic config set <key> <value>");
    process.exit(1);
  }

  if (key !== "telemetry") {
    log.error(`Unknown config key: ${key}. Only 'telemetry' is supported.`);
    process.exit(1);
  }

  // Validate value
  if (!value) {
    log.error("Missing value. Usage: atomic config set telemetry <true|false>");
    process.exit(1);
  }

  if (value !== "true" && value !== "false") {
    log.error(`Invalid value: ${value}. Must be 'true' or 'false'.`);
    process.exit(1);
  }

  // Set telemetry enabled/disabled
  const enabled = value === "true";
  setTelemetryEnabled(enabled);

  log.success(`Telemetry has been ${enabled ? "enabled" : "disabled"}.`);
}
