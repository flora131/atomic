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
 *   atomic config set <key> <value> Set configuration value
 *   atomic update                   Self-update to latest version
 *   atomic uninstall                Remove atomic installation
 *   atomic --version                Show version
 *   atomic --help                   Show help
 */

import { spawn } from "child_process";
import { Command } from "@commander-js/extra-typings";
import { VERSION } from "./version";
import { COLORS } from "./utils/colors";
import { AGENT_CONFIG, type AgentKey } from "./config";
import { initCommand } from "./commands/init";
import { configCommand } from "./commands/config";
import { updateCommand } from "./commands/update";
import { uninstallCommand } from "./commands/uninstall";
import { chatCommand } from "./commands/chat";
import { cleanupWindowsLeftoverFiles } from "./utils/cleanup";
import { handleTelemetryUpload, isTelemetryEnabledSync } from "./telemetry";

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

  // Add chat command for interactive chat with coding agents
  program
    .command("chat")
    .description("Start an interactive chat session with a coding agent")
    .option(
      "-a, --agent <name>",
      `Agent to chat with (${agentChoices})`,
      "claude"
    )
    .option("-w, --workflow", "Enable graph workflow mode", false)
    .option(
      "-t, --theme <name>",
      "UI theme (dark, light)",
      "dark"
    )
    .option("-m, --model <name>", "Model to use for the chat session")
    .option("--max-iterations <n>", "Maximum iterations for workflow mode", "100")
    .argument("[prompt...]", "Initial prompt to send (opens interactive session with prompt)")
    .addHelpText(
      "after",
      `
Examples:
  $ atomic chat                              Start chat with Claude (default)
  $ atomic chat -a opencode                  Start chat with OpenCode
  $ atomic chat -a copilot --workflow        Start workflow-enabled chat with Copilot
  $ atomic chat --theme light                Start chat with light theme
  $ atomic chat -w --max-iterations 50       Start workflow with iteration limit
  $ atomic chat "fix the typecheck errors"   Start chat with an initial prompt
  $ atomic chat -a claude "refactor utils"   Start chat with agent and prompt

Slash Commands (in workflow mode):
  /workflow - Start the Atomic workflow
  /theme    - Switch theme (dark/light)
  /help     - Show available commands`
    )
    .action(async (promptParts: string[], localOpts) => {
      // Validate agent choice
      const validAgents = Object.keys(AGENT_CONFIG);
      if (!validAgents.includes(localOpts.agent)) {
        console.error(`${COLORS.red}Error: Unknown agent '${localOpts.agent}'${COLORS.reset}`);
        console.error(`Valid agents: ${agentChoices}`);
        process.exit(1);
      }

      // Validate theme choice
      if (localOpts.theme !== "dark" && localOpts.theme !== "light") {
        console.error(`${COLORS.red}Error: Invalid theme '${localOpts.theme}'${COLORS.reset}`);
        console.error("Valid themes: dark, light");
        process.exit(1);
      }

      const prompt = promptParts.length > 0 ? promptParts.join(" ") : undefined;
      const exitCode = await chatCommand({
        agentType: localOpts.agent as "claude" | "opencode" | "copilot",
        workflow: localOpts.workflow,
        theme: localOpts.theme as "dark" | "light",
        model: localOpts.model,
        maxIterations: parseInt(localOpts.maxIterations, 10),
        initialPrompt: prompt,
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

// Run the CLI
main();
