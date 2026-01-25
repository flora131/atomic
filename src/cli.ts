#!/usr/bin/env bun
/**
 * Atomic CLI - Configuration management for coding agents
 *
 * Built with Commander.js for robust argument parsing and type-safe options.
 *
 * Usage:
 *   atomic                          Interactive setup (same as 'atomic init')
 *   atomic init                     Interactive setup with agent selection
 *   atomic init -a <agent>          Setup specific agent (skip selection)
 *   atomic run <agent> [args...]    Run agent with arguments
 *   atomic config set <key> <value> Set configuration value
 *   atomic update                   Self-update to latest version
 *   atomic uninstall                Remove atomic installation
 *   atomic ralph setup -a <agent>   Start Ralph loop
 *   atomic ralph stop -a <agent>    Stop Ralph loop
 *   atomic --version                Show version
 *   atomic --help                   Show help
 */

import { Command } from "@commander-js/extra-typings";
import { VERSION } from "./version";
import { COLORS } from "./utils/colors";

/**
 * Create and configure the main CLI program
 *
 * This function sets up the Commander.js program with:
 * - Program metadata (name, description, version)
 * - Global options available to all commands
 * - Custom error output with colored messages
 *
 * Commands are added separately in subsequent features.
 */
export function createProgram() {
  const program = new Command()
    .name("atomic")
    .description("Configuration management CLI for coding agents")
    .version(VERSION, "-v, --version", "Show version number")

    // Global options available to all commands
    .option("-f, --force", "Overwrite all config files including CLAUDE.md/AGENTS.md")
    .option("-y, --yes", "Auto-confirm all prompts (non-interactive mode)")
    .option("--no-banner", "Skip ASCII banner display")
    .option("--upload-telemetry", "Upload telemetry events (internal use)")

    // Configure error output with colors
    .configureOutput({
      writeErr: (str) => {
        // Use colored output for errors
        process.stderr.write(`${COLORS.yellow}${str}${COLORS.reset}`);
      },
      outputError: (str, write) => {
        // Format error messages with color
        write(`${COLORS.yellow}${str}${COLORS.reset}`);
      },
    })

    // Show help hint on unknown commands
    .showHelpAfterError("(Run 'atomic --help' for usage information)");

  // Hide the --upload-telemetry option from help output
  // It's an internal flag used for spawning background telemetry uploads
  const uploadTelemetryOption = program.options.find(
    (opt) => opt.long === "--upload-telemetry"
  );
  if (uploadTelemetryOption) {
    uploadTelemetryOption.hidden = true;
  }

  return program;
}

// Create the program instance for use by main() and tests
export const program = createProgram();
