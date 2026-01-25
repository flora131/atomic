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
import { AGENT_CONFIG, isValidAgent, type AgentKey } from "./config";
import { initCommand } from "./commands/init";
import { runAgentCommand } from "./commands/run-agent";
import { configCommand } from "./commands/config";
import { updateCommand } from "./commands/update";
import { uninstallCommand } from "./commands/uninstall";

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
    .showHelpAfterError("(Run 'atomic --help' for usage information)")

    // Enable positional options for subcommands that use passThroughOptions
    .enablePositionalOptions();

  // Hide the --upload-telemetry option from help output
  // It's an internal flag used for spawning background telemetry uploads
  const uploadTelemetryOption = program.options.find(
    (opt) => opt.long === "--upload-telemetry"
  );
  if (uploadTelemetryOption) {
    uploadTelemetryOption.hidden = true;
  }

  // Build agent choices string for help text
  const agentChoices = Object.keys(AGENT_CONFIG).join(", ");

  // Add init command (default command when no subcommand is provided)
  program
    .command("init", { isDefault: true })
    .description("Interactive setup with agent selection")
    .option(
      "-a, --agent <name>",
      `Pre-select agent to configure (${agentChoices})`
    )
    .action(async (localOpts) => {
      const globalOpts = program.opts();

      await initCommand({
        showBanner: globalOpts.banner !== false,
        preSelectedAgent: localOpts.agent as AgentKey | undefined,
        force: globalOpts.force,
        yes: globalOpts.yes,
      });
    });

  // Add run command to execute a specific agent
  // This replaces the legacy `atomic --agent <name>` pattern with `atomic run <agent>`
  program
    .command("run")
    .description("Run a coding agent")
    .argument("<agent>", `Agent to run (${agentChoices})`)
    .argument("[args...]", "Arguments to pass to the agent")
    .passThroughOptions() // Allow unknown options after -- to pass to agent
    .allowUnknownOption() // Don't error on unknown options (they go to agent)
    .action(async (agent: string, args: string[]) => {
      const globalOpts = program.opts();

      // Validate agent name
      if (!isValidAgent(agent)) {
        console.error(`${COLORS.yellow}Error: Unknown agent '${agent}'${COLORS.reset}`);
        console.error(`Valid agents: ${agentChoices}`);
        console.error("\n(Run 'atomic run --help' for usage information)");
        process.exit(1);
      }

      const exitCode = await runAgentCommand(agent, args, {
        force: globalOpts.force,
        yes: globalOpts.yes,
      });

      process.exit(exitCode);
    });

  // Add config command for managing CLI settings
  const configCmd = program
    .command("config")
    .description("Manage atomic configuration");

  // Add 'set' subcommand to config
  configCmd
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "Configuration key (e.g., telemetry)")
    .argument("<value>", "Value to set (e.g., true, false)")
    .action(async (key: string, value: string) => {
      await configCommand("set", key, value);
    });

  // Add update command for self-updating binary installations
  program
    .command("update")
    .description("Self-update to the latest version (binary installs only)")
    .action(async () => {
      await updateCommand();
    });

  // Add uninstall command for removing binary installations
  program
    .command("uninstall")
    .description("Remove atomic installation (binary installs only)")
    .option("--dry-run", "Show what would be removed without removing")
    .option("--keep-config", "Keep configuration data, only remove binary")
    .action(async (localOpts) => {
      const globalOpts = program.opts();

      await uninstallCommand({
        yes: globalOpts.yes,
        dryRun: localOpts.dryRun,
        keepConfig: localOpts.keepConfig,
      });
    });

  return program;
}

// Create the program instance for use by main() and tests
export const program = createProgram();
