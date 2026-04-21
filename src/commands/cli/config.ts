/**
 * Config command - Manage Atomic CLI configuration
 *
 * Usage: atomic config set <key> <value>
 *
 * Currently supported:
 *   atomic config set telemetry true|false
 *   atomic config set scm github|azure-devops|sapling
 */

import { log } from "@clack/prompts";
import {
  setScmProvider,
  setTelemetryEnabled,
} from "../../services/config/settings.ts";
import { SCM_PROVIDERS, isScmProvider } from "../../services/config/atomic-config.ts";

const SUPPORTED_KEYS = ["telemetry", "scm"] as const;

/**
 * Execute the config command
 */
export async function configCommand(
  subcommand: string | undefined,
  key: string | undefined,
  value: string | undefined
): Promise<number> {
  if (!subcommand) {
    log.error("Missing subcommand. Usage: atomic config set <key> <value>");
    return 1;
  }

  if (subcommand !== "set") {
    log.error(`Unknown subcommand: ${subcommand}. Only 'set' is supported.`);
    return 1;
  }

  if (!key) {
    log.error("Missing key. Usage: atomic config set <key> <value>");
    return 1;
  }

  if (!(SUPPORTED_KEYS as readonly string[]).includes(key)) {
    log.error(
      `Unknown config key: ${key}. Supported keys: ${SUPPORTED_KEYS.join(", ")}.`,
    );
    return 1;
  }

  if (!value) {
    log.error(`Missing value. Usage: atomic config set ${key} <value>`);
    return 1;
  }

  if (key === "telemetry") {
    if (value !== "true" && value !== "false") {
      log.error(`Invalid value: ${value}. Must be 'true' or 'false'.`);
      return 1;
    }

    const enabled = value === "true";
    await setTelemetryEnabled(enabled);
    log.success(`Telemetry has been ${enabled ? "enabled" : "disabled"}.`);
    return 0;
  }

  // key === "scm"
  if (!isScmProvider(value)) {
    log.error(
      `Invalid value: ${value}. Must be one of: ${SCM_PROVIDERS.join(", ")}.`,
    );
    return 1;
  }

  await setScmProvider(value);
  log.success(
    `Source control provider set to ${value}. The GitHub and Azure DevOps MCP servers in .claude/settings.json and .opencode/opencode.json will be reconciled on the next 'atomic chat' or 'atomic workflow' run.`,
  );
  return 0;
}
