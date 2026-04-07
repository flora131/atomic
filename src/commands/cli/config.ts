/**
 * Config command - Manage Atomic CLI configuration
 *
 * Usage: atomic config set <key> <value>
 *
 * Currently supported:
 *   atomic config set telemetry true|false
 */

import { log } from "@clack/prompts";
import { setTelemetryEnabled } from "@/services/config/settings.ts";

/**
 * Execute the config command
 */
export async function configCommand(
  subcommand: string | undefined,
  key: string | undefined,
  value: string | undefined
): Promise<void> {
  if (!subcommand) {
    log.error("Missing subcommand. Usage: atomic config set <key> <value>");
    process.exit(1);
  }

  if (subcommand !== "set") {
    log.error(`Unknown subcommand: ${subcommand}. Only 'set' is supported.`);
    process.exit(1);
  }

  if (!key) {
    log.error("Missing key. Usage: atomic config set <key> <value>");
    process.exit(1);
  }

  if (key !== "telemetry") {
    log.error(`Unknown config key: ${key}. Only 'telemetry' is supported.`);
    process.exit(1);
  }

  if (!value) {
    log.error("Missing value. Usage: atomic config set telemetry <true|false>");
    process.exit(1);
  }

  if (value !== "true" && value !== "false") {
    log.error(`Invalid value: ${value}. Must be 'true' or 'false'.`);
    process.exit(1);
  }

  const enabled = value === "true";
  setTelemetryEnabled(enabled);

  log.success(`Telemetry has been ${enabled ? "enabled" : "disabled"}.`);
}
