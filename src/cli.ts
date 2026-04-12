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
 *   atomic --version                Show version
 *   atomic --help                   Show help
 */

import { Command } from "@commander-js/extra-typings";
import { VERSION } from "./version.ts";
import { COLORS } from "./theme/colors.ts";
import { AGENT_CONFIG, type AgentKey, SCM_CONFIG, type SourceControlType } from "./services/config/index.ts";

/**
 * Create and configure the main CLI program
 */
export function createProgram() {
    const program = new Command()
        .name("atomic")
        .description("Configuration management CLI for coding agents")
        .version(VERSION, "-v, --version", "Show version number")

        // Global options available to all commands
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
            const { initCommand } = await import("./commands/cli/init.ts");

            await initCommand({
                showBanner: globalOpts.banner !== false,
                preSelectedAgent: localOpts.agent as AgentKey | undefined,
                preSelectedScm: localOpts.scm as SourceControlType | undefined,
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

            const { chatCommand } = await import("./commands/cli/chat.ts");
            const exitCode = await chatCommand({
                agentType: agentType as AgentKey,
                passthroughArgs,
            });

            process.exit(exitCode);
        });

    // Add workflow command
    //
    // Two shapes are supported behind a single command:
    //   1. `atomic workflow -a <agent>`                 — interactive picker
    //   2. `atomic workflow -n <name> -a <agent> ...`   — named run with
    //       either a positional prompt (free-form workflows) or
    //       `--<field>=<value>` flags (structured-input workflows).
    //
    // `allowUnknownOption` + `allowExcessArguments` give us both: unknown
    // flags and positional tokens land in `cmd.args`, which we forward
    // as `passthroughArgs` so the command layer can parse them against
    // the workflow's declared schema.
    program
        .command("workflow")
        .description("Run a multi-session agent workflow")
        .option("-n, --name <name>", "Workflow name (matches directory under .atomic/workflows/<name>/)")
        .option("-a, --agent <name>", `Agent to use (${agentChoices})`)
        .option("-l, --list", "List available workflows")
        .allowUnknownOption()
        .allowExcessArguments(true)
        .addHelpText(
            "after",
            `
Examples:
  $ atomic workflow -l                              List available workflows
  $ atomic workflow -a claude                       Open the interactive picker
  $ atomic workflow -n ralph -a claude "fix bug"    Run a free-form workflow
  $ atomic workflow -n gen-spec -a claude --research_doc=notes.md --focus=standard
                                                    Run a structured-input workflow`,
        )
        .action(async (localOpts, cmd) => {
            const { workflowCommand } = await import("./commands/cli/workflow.ts");
            const exitCode = await workflowCommand({
                name: localOpts.name,
                agent: localOpts.agent,
                list: localOpts.list,
                passthroughArgs: cmd.args,
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
            const { configCommand } = await import("./commands/cli/config.ts");
            const exitCode = await configCommand("set", key, value);
            process.exit(exitCode);
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
        // Sync tooling deps and global skills on first launch after install
        // or upgrade. Runs at most once per version bump (gated on a marker
        // file under ~/.atomic). Skipped for `--version` / `--help` so info
        // paths stay instant.
        const argv = process.argv.slice(2);
        const isInfoCommand =
            argv.includes("--version") ||
            argv.includes("-v") ||
            argv.includes("--help") ||
            argv.includes("-h");

        if (!isInfoCommand) {
            const { autoSyncIfStale } = await import("./services/system/auto-sync.ts");
            await autoSyncIfStale();
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
if (import.meta.main) {
    await main();
}
