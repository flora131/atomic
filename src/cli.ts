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
 *   atomic workflow verify          Verify all workflows
 *   atomic workflow verify <path>   Verify a specific workflow file
 *   atomic update                   Self-update to latest version
 *   atomic uninstall                Remove atomic installation
 *   atomic --version                Show version
 *   atomic --help                   Show help
 */

import { Command } from "@commander-js/extra-typings";
import { VERSION } from "@/version.ts";
import { COLORS } from "@/theme/colors.ts";
import { AGENT_CONFIG, type AgentKey } from "@/services/config/index.ts";

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
        })

        // Enable positional options for subcommands that use passThroughOptions
        .enablePositionalOptions();

    // Build agent choices string for help text
    const agentChoices = Object.keys(AGENT_CONFIG).join(", ");

    // Add init command
    program
        .command("init")
        .description("Interactive setup with agent selection")
        .option(
            "-a, --agent <name>",
            `Pre-select agent to configure (${agentChoices})`,
        )
        .action(async (localOpts) => {
            const globalOpts = program.opts();
            const { initCommand } = await import("@/commands/cli/init.ts");

            await initCommand({
                showBanner: globalOpts.banner !== false,
                preSelectedAgent: localOpts.agent as AgentKey | undefined,
                force: globalOpts.force,
                yes: globalOpts.yes,
            });
        });

    // Add chat command (default command when no subcommand is provided)
    program
        .command("chat", { isDefault: true })
        .description("Start an interactive chat session with a coding agent")
        .option("-a, --agent <name>", `Agent to chat with (${agentChoices})`)
        .option("-w, --workflow", "Enable graph workflow mode", false)
        .option("-t, --theme <name>", "UI theme (dark, light)", "dark")
        .option("-m, --model <name>", "Model to use for the chat session")
        .option(
            "--max-iterations <number>",
            "Maximum conductor graph traversal steps (default: 100)",
            (val: string) => {
                const n = Number.parseInt(val, 10);
                if (Number.isNaN(n) || n < 1) {
                    throw new Error(`--max-iterations must be a positive integer, got "${val}"`);
                }
                return n;
            },
        )
        .option(
            "--additional-instructions <text>",
            "Append additional instructions to the default chat system prompt",
        )
        .argument(
            "[prompt...]",
            "Initial prompt to send (opens interactive session with prompt)",
        )
        .addHelpText(
            "after",
            `
Examples:
  $ atomic chat -a claude                   Start chat with Claude
  $ atomic chat -a opencode                  Start chat with OpenCode
  $ atomic chat -a copilot --workflow        Start workflow-enabled chat with Copilot
  $ atomic chat -a claude --theme light      Start chat with light theme
  $ atomic chat -a claude --additional-instructions "Be concise" "review this patch"
  $ atomic chat -a claude "fix the typecheck errors"
  $ atomic chat -a claude "refactor utils"   Start chat with agent and prompt

Slash Commands (in workflow mode):
  /workflow - Start the Atomic workflow
  /theme    - Switch theme (dark/light)
  /help     - Show available commands`,
        )
        .action(async (promptParts: string[], localOpts) => {
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

            const prompt =
                promptParts.length > 0 ? promptParts.join(" ") : undefined;
            const { chatCommand } = await import("@/commands/cli/chat.ts");
            const exitCode = await chatCommand({
                agentType: agentType as "claude" | "opencode" | "copilot",
                workflow: localOpts.workflow,
                theme: localOpts.theme as "dark" | "light",
                model: localOpts.model,
                maxIterations: localOpts.maxIterations,
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

    // Add hidden command for internal telemetry upload (used by background process)
    program
        .command("upload-telemetry", { hidden: true })
        .description("Upload telemetry events (internal use)")
        .action(async () => {
            const { handleTelemetryUpload } =
                await import("@/services/telemetry/telemetry-upload.ts");
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
 * Reference: specs/2026-01-22-phase-6-telemetry-upload-backend.md Section 5.5
 */
export async function spawnTelemetryUpload(): Promise<void> {
    // Prevent recursive spawns - if this is already an upload process, don't spawn another
    if (process.env.ATOMIC_TELEMETRY_UPLOAD === "1") {
        return;
    }

    // Check if telemetry is enabled (lazy-load to avoid pulling in telemetry at startup)
    let enabled = false;
    try {
        const { isTelemetryEnabledSync } = await import("@/services/telemetry/index.ts");
        enabled = isTelemetryEnabledSync();
    } catch {
        return;
    }
    if (!enabled) {
        return;
    }

    try {
        // Build the spawn argv for the upload-telemetry hidden command.
        // In compiled binaries, process.argv[1] is the $bunfs virtual-FS path
        // to the bundled entry (e.g. "B:/~BUN/root/src/cli.js"). Passing it as
        // a user argument to the re-spawned binary would add a phantom arg that
        // prevents Commander from finding the upload-telemetry command.  The
        // binary already embeds its entry — just pass the command directly.
        const scriptPath = process.argv[1] ?? "atomic";
        const isBunfsEntry = /[\\/]\$bunfs[\\/]|^[Bb]:[\\/]~BUN[\\/]/.test(scriptPath);
        const spawnArgv = isBunfsEntry
            ? [process.execPath, "upload-telemetry"]
            : [process.execPath, scriptPath, "upload-telemetry"];

        // Spawn detached process that outlives parent
        const child = Bun.spawn(
            spawnArgv,
            {
                detached: true,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
                env: { ...process.env, ATOMIC_TELEMETRY_UPLOAD: "1" },
            },
        );

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
    try {
        // Clean up leftover Windows files from previous uninstall/update operations
        // This is a no-op on non-Windows platforms.
        // Runs inside try/catch so a failure in the dynamic import or cleanup
        // never surfaces as an unhandled rejection.
        if (process.platform === "win32") {
            const { cleanupWindowsLeftoverFiles } = await import("@/services/system/cleanup.ts");
            await cleanupWindowsLeftoverFiles();
        }

        // Parse and execute the command
        // Commander.js handles all argument parsing including the hidden upload-telemetry command
        await program.parseAsync();

        // Spawn telemetry upload after successful command execution
        await spawnTelemetryUpload();
    } catch (error) {
        // Handle errors with colored output
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${COLORS.red}Error: ${message}${COLORS.reset}`);

        // Spawn telemetry upload even on error
        await spawnTelemetryUpload();

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
