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
 *   atomic init -s <scm>             Setup specific SCM (github, sapling)
 *   atomic chat -a <agent>          Start interactive chat with an agent
 *   atomic config set <key> <value> Set configuration value
 *   atomic update                   Self-update to latest version
 *   atomic uninstall                Remove atomic installation
 *   atomic --version                Show version
 *   atomic --help                   Show help
 */

import { Command } from "@commander-js/extra-typings";
import { VERSION } from "@/version.ts";
import { COLORS } from "@/theme/colors.ts";
import { AGENT_CONFIG, type AgentKey, SCM_CONFIG, type SourceControlType } from "@/services/config/index.ts";

/**
 * Create and configure the main CLI program
 */
export function createProgram() {
    const program = new Command()
        .name("atomic")
        .description("Configuration management CLI for coding agents")
        .version(VERSION, "-v, --version", "Show version number")

        // Global options available to all commands
        .option("-f, --force", "Overwrite all config files")
        .option("-y, --yes", "Auto-confirm all prompts (non-interactive mode)")
        .option("--no-banner", "Skip ASCII banner display")

        // Configure error output with colors
        .configureOutput({
            writeErr: (str) => {
                process.stderr.write(`${COLORS.red}${str}${COLORS.reset}`);
            },
            outputError: (str, write) => {
                write(`${COLORS.red}${str}${COLORS.reset}`);
            },
        });

    // Build agent choices string for help text
    const agentChoices = Object.keys(AGENT_CONFIG).join(", ");
    const scmChoices = Object.keys(SCM_CONFIG).join(", ");

    // Add init command
    program
        .command("init")
        .description("Interactive setup with agent selection")
        .option(
            "-a, --agent <name>",
            `Pre-select agent to configure (${agentChoices})`,
        )
        .option(
            "-s, --scm <name>",
            `Pre-select source control system (${scmChoices})`,
        )
        .action(async (localOpts) => {
            const globalOpts = program.opts();
            const { initCommand } = await import("@/commands/cli/init.ts");

            await initCommand({
                showBanner: globalOpts.banner !== false,
                preSelectedAgent: localOpts.agent as AgentKey | undefined,
                preSelectedScm: localOpts.scm as SourceControlType | undefined,
                force: globalOpts.force,
                yes: globalOpts.yes,
            });
        });

    // Add chat command (default command when no subcommand is provided)
    program
        .command("chat", { isDefault: true })
        .description("Start an interactive chat session with a coding agent")
        .option("-a, --agent <name>", `Agent to chat with (${agentChoices})`)
        .allowUnknownOption()
        .allowExcessArguments(true)
        .addHelpText(
            "after",
            `
All arguments after -a <agent> are forwarded to the native agent CLI.

Examples:
  $ atomic chat -a claude                           Start Claude interactively
  $ atomic chat -a copilot                          Start Copilot interactively
  $ atomic chat -a opencode                         Start OpenCode interactively
  $ atomic chat -a claude "fix the bug"             Claude with initial prompt
  $ atomic chat -a copilot --model gpt-4o           Copilot with custom model
  $ atomic chat -a claude --verbose                 Forward --verbose to claude`,
        )
        .action(async (localOpts, cmd) => {
            const validAgents = Object.keys(AGENT_CONFIG);
            const agentType = localOpts.agent;

            if (!agentType) {
                console.error(
                    `${COLORS.red}Error: Missing agent.${COLORS.reset}`,
                );
                console.error(
                    "Start chat with an explicit provider, for example: atomic chat -a claude",
                );
                process.exit(1);
            }

            // Validate agent choice
            if (!validAgents.includes(agentType)) {
                console.error(
                    `${COLORS.red}Error: Unknown agent '${agentType}'${COLORS.reset}`,
                );
                console.error(`Valid agents: ${agentChoices}`);
                process.exit(1);
            }

            // Collect extra args/options to forward to the native CLI
            const passthroughArgs = cmd.args;

            const { chatCommand } = await import("@/commands/cli/chat.ts");
            const exitCode = await chatCommand({
                agentType: agentType as "claude" | "opencode" | "copilot",
                passthroughArgs,
            });

            process.exit(exitCode);
        });

    // Add workflow command
    program
        .command("workflow")
        .description("Run a multi-session agent workflow")
        .option("-n, --name <name>", "Workflow name (matches directory under .atomic/workflows/<name>/)")
        .option("-a, --agent <name>", `Agent to use (${agentChoices})`)
        .option("-l, --list", "List available workflows")
        .argument("[prompt...]", "Prompt for the workflow")
        .action(async (promptParts, localOpts) => {
            const { workflowCommand } = await import("@/commands/cli/workflow.ts");
            const exitCode = await workflowCommand({
                name: localOpts.name,
                agent: localOpts.agent,
                prompt: promptParts.length > 0 ? promptParts.join(" ") : undefined,
                list: localOpts.list,
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
            const { configCommand } = await import("@/commands/cli/config.ts");
            await configCommand("set", key, value);
        });

    // Add update command for self-updating binary installations
    program
        .command("update")
        .description("Self-update to the latest version (binary installs only)")
        .action(async () => {
            const { updateCommand } = await import("@/commands/cli/update.ts");
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
            const { uninstallCommand } = await import("@/commands/cli/uninstall.ts");

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

/**
 * Main entry point for the CLI
 */
async function main(): Promise<void> {
    try {
        if (process.platform === "win32") {
            const { cleanupWindowsLeftoverFiles } = await import("@/services/system/cleanup.ts");
            await cleanupWindowsLeftoverFiles();
        }

        // Ensure config data directory exists for binary installs.
        const skipConfigCommands = new Set(["--version", "-v", "--help", "-h"]);
        const needsConfig = !process.argv.slice(2).some((arg) => skipConfigCommands.has(arg));
        if (needsConfig) {
            const { ensureConfigDataDir } = await import("@/services/config/config-path.ts");
            await ensureConfigDataDir(VERSION);
        }

        // Parse and execute the command
        await program.parseAsync();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${COLORS.red}Error: ${message}${COLORS.reset}`);
        process.exit(1);
    }
}

// Run the CLI
const _isCompiledBinary = /[\\/]\$bunfs[\\/]|^[Bb]:[\\/]~BUN[\\/]/.test(import.meta.path);
if (import.meta.main || _isCompiledBinary) {
    await main();
}
