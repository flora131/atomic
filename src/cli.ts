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
 *   atomic config set <key> <value> Set configuration value
 *   atomic workflow verify          Verify all workflows
 *   atomic workflow verify <path>   Verify a specific workflow file
 *   atomic list agents              List discovered agent definitions
 *   atomic ls agents                Alias for list agents
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
        .option("-f, --force", "Overwrite all config files")
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
        .option("-p, --prompt <text>", "Initial prompt to send")
        .option("-t, --theme <name>", "UI theme (dark, light)", "dark")
        .option("-m, --model <name>", "Model to use for the chat session")
        .option(
            "--additional-instructions <text>",
            "Append extra instructions to the enhanced system prompt",
        )
        .addHelpText(
            "after",
            `
Examples:
  $ atomic chat -a claude                   Start chat with Claude
  $ atomic chat -a opencode                  Start chat with OpenCode
  $ atomic chat -a copilot                   Start chat with Copilot
  $ atomic chat -a claude --theme light      Start chat with light theme
  $ atomic chat -a claude -p "fix the typecheck errors"
  $ atomic chat -a claude --additional-instructions "Be concise" -p "review this patch"

Slash Commands:
  /theme    - Switch theme (dark/light)
  /help     - Show available commands`,
        )
        .action(async (localOpts) => {
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

            // Validate theme choice
            if (localOpts.theme !== "dark" && localOpts.theme !== "light") {
                console.error(
                    `${COLORS.red}Error: Invalid theme '${localOpts.theme}'${COLORS.reset}`,
                );
                console.error("Valid themes: dark, light");
                process.exit(1);
            }

            const prompt = localOpts.prompt || undefined;
            const { chatCommand } = await import("@/commands/cli/chat.ts");
            const exitCode = await chatCommand({
                agentType: agentType as "claude" | "opencode" | "copilot",
                theme: localOpts.theme as "dark" | "light",
                model: localOpts.model,
                initialPrompt: prompt,
                additionalInstructions: localOpts.additionalInstructions,
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

    // Add list command for inspecting project resources
    const listCmd = program
        .command("list")
        .alias("ls")
        .description("List project resources (agents, workflows)");

    listCmd
        .command("agents")
        .description("List all discovered agent definitions (project + global)")
        .action(async () => {
            const { listAgentsCommand } = await import("@/commands/cli/list.ts");
            await listAgentsCommand();
        });

    // Add workflow command for verification and management
    const workflowCmd = program
        .command("workflow")
        .description("Manage and verify workflows");

    workflowCmd
        .command("verify")
        .description("Run structural verification on workflows")
        .argument("[path]", "Path to a specific workflow .ts file to verify")
        .action(async (path?: string) => {
            const { workflowVerifyCommand } = await import("@/commands/cli/workflow.ts");
            await workflowVerifyCommand(path);
        });

    return program;
}

// Create the program instance for use by main() and tests
export const program = createProgram();

/**
 * Main entry point for the CLI
 *
 * Handles:
 * - Windows leftover file cleanup
 * - Error handling with colored output
 */
async function main(): Promise<void> {
    try {
        // Clean up leftover Windows files from previous uninstall/update operations
        // This is a no-op on non-Windows platforms.
        // Runs inside try/catch so a failure in the dynamic import or cleanup
        // never surfaces as an unhandled rejection.
        if (process.platform === "win32") {
            const { cleanupWindowsLeftoverFiles } = await import("@/services/system/cleanup.ts");
            await cleanupWindowsLeftoverFiles();
        }

        // Ensure config data directory exists for binary installs.
        // Downloads config on first run if the binary was installed without it
        // (e.g., via a devcontainer feature that only copies the binary).
        const skipConfigCommands = new Set(["--version", "-v", "--help", "-h"]);
        const needsConfig = !process.argv.slice(2).some((arg) => skipConfigCommands.has(arg));
        if (needsConfig) {
            const { ensureConfigDataDir } = await import("@/services/config/config-path.ts");
            await ensureConfigDataDir(VERSION);
        }

        // Ensure all required tooling is available before running commands.
        // For binary installs this installs package managers (bun, npm, uv) and
        // CLI tools (playwright-cli, liteparse, cocoindex-code) on first run.
        // Then ensures the workflow SDK version matches the CLI version.
        // Skip for lightweight commands that don't need any of this.
        const skipToolingCommands = new Set(["--version", "-v", "--help", "-h", "uninstall", "config"]);
        const needsTooling = !process.argv.slice(2).some((arg) => skipToolingCommands.has(arg));
        if (needsTooling) {
            const { detectInstallationType, getConfigRoot } = await import("@/services/config/config-path.ts");
            const installType = detectInstallationType();

            const { ensureFirstRunTooling, ToolingSetupError } = await import("@/services/config/first-run-tooling.ts");
            try {
                await ensureFirstRunTooling(VERSION, installType);
            } catch (error) {
                if (error instanceof ToolingSetupError) {
                    console.error(`${COLORS.red}${error.message}${COLORS.reset}`);
                    process.exit(1);
                }
                throw error;
            }

            const { ensureWorkflowSdkVersion } = await import("@/services/config/workflow-package.ts");
            const configRoot = getConfigRoot();
            await ensureWorkflowSdkVersion(VERSION, installType, configRoot);
        }

        // Parse and execute the command
        await program.parseAsync();
    } catch (error) {
        // Handle errors with colored output
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${COLORS.red}Error: ${message}${COLORS.reset}`);

        process.exit(1);
    }
}

// Run the CLI
// Bun compiled binaries (as of Bun ≤ 1.3.x) incorrectly set import.meta.main
// to false even for the primary entrypoint.  Detect compiled-binary mode via the
// $bunfs virtual-filesystem prefix that Bun injects into import.meta.path.
const _isCompiledBinary = /[\\/]\$bunfs[\\/]|^[Bb]:[\\/]~BUN[\\/]/.test(import.meta.path);
if (import.meta.main || _isCompiledBinary) {
    await main();
}
