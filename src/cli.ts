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
 *   atomic run <agent>              Run agent without arguments
 *   atomic run <agent> [args...]    Run agent with arguments
 *   atomic config set <key> <value> Set configuration value
 *   atomic update                   Self-update to latest version
 *   atomic uninstall                Remove atomic installation
 *   atomic ralph setup -a <agent>   Start Ralph loop
 *   atomic ralph stop -a <agent>    Stop Ralph loop
 *   atomic --version                Show version
 *   atomic --help                   Show help
 */

import { spawn } from "child_process";
import { Command, Argument, InvalidArgumentError } from "@commander-js/extra-typings";
import { VERSION } from "./version";
import { COLORS } from "./utils/colors";
import { AGENT_CONFIG, type AgentKey } from "./config";
import { initCommand } from "./commands/init";
import { runAgentCommand } from "./commands/run-agent";
import { configCommand } from "./commands/config";
import { updateCommand } from "./commands/update";
import { uninstallCommand } from "./commands/uninstall";
import { ralphSetup, ralphStop } from "./commands/ralph";
import { cleanupWindowsLeftoverFiles } from "./utils/cleanup";
import { isTelemetryEnabledSync } from "./utils/telemetry";
import { handleTelemetryUpload } from "./utils/telemetry/telemetry-upload";

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

    // Configure error output with colors
    .configureOutput({
      writeErr: (str) => {
        // Use colored output for errors
        process.stderr.write(`${COLORS.red}${str}${COLORS.reset}`);
      },
      outputError: (str, write) => {
        // Format error messages with color
        write(`${COLORS.red}${str}${COLORS.reset}`);
      },
    })

    // Show help hint on unknown commands
    .showHelpAfterError("(Run 'atomic --help' for usage information)")

    // Enable positional options for subcommands that use passThroughOptions
    .enablePositionalOptions();

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
  // passThroughOptions() allows arguments after <agent> to pass through without requiring --
  program
    .command("run")
    .description("Run a coding agent")
    .addArgument(
      new Argument("<agent>", "Agent to run").choices(
        Object.keys(AGENT_CONFIG) as AgentKey[]
      )
    )
    .argument("[args...]", "Arguments to pass to the agent")
    .passThroughOptions() // Options after <agent> are passed through to the agent
    .addHelpText(
      "after",
      `
Examples:
  $ atomic run claude                      Run Claude Code interactively
  $ atomic run claude /commit "fix bug"    Run with a slash command
  $ atomic run claude --help               Show agent's help
  $ atomic run opencode /research-codebase Research the codebase`
    )
    .action(async (agent: AgentKey, args: string[]) => {
      const globalOpts = program.opts();

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

  // Add ralph command for self-referential development loops
  const ralphCmd = program
    .command("ralph")
    .description("Self-referential development loop for Claude Code");

  /**
   * Parse and validate --max-iterations argument
   * Throws InvalidArgumentError for Commander.js error handling
   */
  function parseIterations(value: string): number {
    if (!/^\d+$/.test(value)) {
      throw new InvalidArgumentError("Must be a positive integer or 0");
    }
    return parseInt(value, 10);
  }

  // Add 'setup' subcommand to ralph
  ralphCmd
    .command("setup")
    .description("Initialize and start a Ralph loop")
    .requiredOption("-a, --agent <name>", "Agent to use (currently only 'claude' is supported)")
    .argument("[prompt...]", "Initial prompt to start the loop")
    .option("--max-iterations <n>", "Maximum iterations before auto-stop (default: unlimited)", parseIterations)
    .option("--completion-promise <text>", "Promise phrase to signal completion")
    .option("--feature-list <path>", "Path to feature list JSON", "research/feature-list.json")
    .addHelpText(
      "after",
      `
Examples:
  $ atomic ralph setup -a claude                       Use default prompt, run until all features pass
  $ atomic ralph setup -a claude --max-iterations 20   Limit to 20 iterations
  $ atomic ralph setup -a claude Build a todo API --completion-promise 'DONE' --max-iterations 20
  $ atomic ralph setup -a claude Refactor cache layer  Custom prompt, runs forever

Stopping:
  Loop exits when any condition is met:
  - --max-iterations limit reached
  - --completion-promise detected in output (as <promise>TEXT</promise>)
  - All features in --feature-list are passing (when max_iterations = 0)`
    )
    .action(async (promptParts: string[], localOpts) => {
      // Validate agent is 'claude' (only supported agent for ralph)
      if (localOpts.agent !== "claude") {
        console.error(`${COLORS.red}Error: Ralph loop currently only supports 'claude' agent${COLORS.reset}`);
        console.error(`You provided: ${localOpts.agent}`);
        console.error("\n(Run 'atomic ralph setup --help' for usage information)");
        process.exit(1);
      }

      // Pass options directly to ralphSetup (Commander.js handles all parsing)
      const exitCode = await ralphSetup({
        prompt: promptParts,
        maxIterations: localOpts.maxIterations,
        completionPromise: localOpts.completionPromise,
        featureList: localOpts.featureList,
      });
      process.exit(exitCode);
    });

  // Add 'stop' subcommand to ralph
  ralphCmd
    .command("stop")
    .description("Stop hook handler (called automatically by hooks)")
    .requiredOption("-a, --agent <name>", "Agent to use (currently only 'claude' is supported)")
    .action(async (localOpts) => {
      // Validate agent is 'claude' (only supported agent for ralph)
      if (localOpts.agent !== "claude") {
        console.error(`${COLORS.red}Error: Ralph loop currently only supports 'claude' agent${COLORS.reset}`);
        console.error(`You provided: ${localOpts.agent}`);
        console.error("\n(Run 'atomic ralph stop --help' for usage information)");
        process.exit(1);
      }

      await ralphStop();
    });

  // Add hidden command for internal telemetry upload (used by background process)
  program
    .command("upload-telemetry", { hidden: true })
    .description("Upload telemetry events (internal use)")
    .action(async () => {
      await handleTelemetryUpload();
    });

  return program;
}

// Create the program instance for use by main() and tests
export const program = createProgram();

/**
 * Spawn a detached background process to upload telemetry events.
 * Uses fire-and-forget pattern - parent process exits immediately.
 *
 * Reference: specs/phase-6-telemetry-upload-backend.md Section 5.5
 */
function spawnTelemetryUpload(): void {
  // Prevent recursive spawns - if this is already an upload process, don't spawn another
  if (process.env.ATOMIC_TELEMETRY_UPLOAD === "1") {
    return;
  }

  // Check if telemetry is enabled (sync check to avoid blocking)
  if (!isTelemetryEnabledSync()) {
    return;
  }

  try {
    // Get the script path, with fallback for edge cases
    const scriptPath = process.argv[1] ?? "atomic";

    // Spawn detached process that outlives parent
    const child = spawn(process.execPath, [scriptPath, "upload-telemetry"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ATOMIC_TELEMETRY_UPLOAD: "1" },
    });

    // Allow parent to exit without waiting for child
    if (child.unref) {
      child.unref();
    }
  } catch {
    // Fail silently - telemetry upload should never break the CLI
  }
}

/**
 * Main entry point for the CLI
 *
 * Handles:
 * - Windows leftover file cleanup
 * - Telemetry upload spawning
 * - Error handling with colored output
 */
async function main(): Promise<void> {
  // Clean up leftover Windows files from previous uninstall/update operations
  // This is a no-op on non-Windows platforms
  await cleanupWindowsLeftoverFiles();

  try {
    // Parse and execute the command
    // Commander.js handles all argument parsing including the hidden upload-telemetry command
    await program.parseAsync();

    // Spawn telemetry upload after successful command execution
    spawnTelemetryUpload();
  } catch (error) {
    // Handle errors with colored output
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${COLORS.red}Error: ${message}${COLORS.reset}`);

    // Spawn telemetry upload even on error
    spawnTelemetryUpload();

    process.exit(1);
  }
}

// Only run CLI when executed directly, not when imported
if (import.meta.main) {
  main();
}
