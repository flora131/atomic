#!/usr/bin/env bun
/**
 * Atomic CLI - Configuration management for coding agents
 *
 * Built with Commander.js for robust argument parsing and type-safe options.
 *
 * Usage:
 *   atomic chat -a <agent>                    Start interactive chat with an agent
 *   atomic chat session list                  List running chat/workflow sessions
 *   atomic chat session connect <id>          Attach to a session
 *   atomic workflow list                      List available workflows
 *   atomic workflow session list              List running sessions
 *   atomic workflow session connect <id>      Attach to a session
 *   atomic session list                       List all running sessions
 *   atomic session connect [id]               Interactive session picker
 *   atomic session kill [id]                  Kill a session (or all when no id)
 *   atomic config set <key> <value>           Set configuration value
 *   atomic --version                          Show version
 *   atomic --help                             Show help
 */

import { Command } from "@commander-js/extra-typings";
import { VERSION } from "./version.ts";
import { COLORS } from "./theme/colors.ts";
import { AGENT_CONFIG, type AgentKey } from "./services/config/index.ts";
import { SUPPORTED_SHELLS, type Shell } from "./completions/index.ts";

// ─── Session subcommand factory ─────────────────────────────────────────────

/**
 * Build a `session` subcommand group with `list` and `connect` children.
 * Reused under `chat`, `workflow`, and at the top level.
 */
/** Commander collect helper: accumulates repeated `-a` values into an array. */
function collectAgent(value: string, previous: string[]): string[] {
    return [...previous, value];
}

function addSessionSubcommand(parent: Command, scope: "chat" | "workflow" | "all" = "all") {
    const sessionCmd = parent
        .command("session")
        .description("Manage running tmux sessions");

    sessionCmd
        .command("list")
        .description("List running sessions on the atomic tmux socket")
        .option(
            "-a, --agent <name>",
            `Filter by agent backend (${Object.keys(AGENT_CONFIG).join(", ")}); repeatable`,
            collectAgent,
            [] as string[],
        )
        .action(async (localOpts) => {
            const { sessionListCommand } = await import("./commands/cli/session.ts");
            const exitCode = await sessionListCommand(localOpts.agent, scope);
            process.exit(exitCode);
        });

    sessionCmd
        .command("connect")
        .description("Attach to a running session (interactive picker when no id given)")
        .argument("[session_id]", "Session name to connect to")
        .option(
            "-a, --agent <name>",
            `Filter picker by agent backend (${Object.keys(AGENT_CONFIG).join(", ")}); repeatable`,
            collectAgent,
            [] as string[],
        )
        .action(async (sessionId, localOpts) => {
            if (sessionId) {
                const { sessionConnectCommand } = await import("./commands/cli/session.ts");
                const exitCode = await sessionConnectCommand(sessionId);
                process.exit(exitCode);
            } else {
                const { sessionPickerCommand } = await import("./commands/cli/session.ts");
                const exitCode = await sessionPickerCommand(localOpts.agent, scope);
                process.exit(exitCode);
            }
        });

    sessionCmd
        .command("kill")
        .description("Kill a running session (omit id to kill all)")
        .argument("[session_id]", "Session name to kill (omit to kill all)")
        .option(
            "-a, --agent <name>",
            `Filter by agent backend (${Object.keys(AGENT_CONFIG).join(", ")}); repeatable`,
            collectAgent,
            [] as string[],
        )
        .action(async (sessionId, localOpts) => {
            const { sessionKillCommand } = await import("./commands/cli/session.ts");
            const exitCode = await sessionKillCommand(sessionId, localOpts.agent, scope);
            process.exit(exitCode);
        });

    return sessionCmd;
}

// ─── Program ────────────────────────────────────────────────────────────────

/**
 * Create and configure the main CLI program
 */
export function createProgram() {
    const program = new Command()
        .name("atomic")
        .description("Configuration management CLI for coding agents")
        .version(VERSION, "-v, --version", "Show version number")
        // Required so subcommands (workflow list, session connect) can define
        // their own options without the parent absorbing them first.
        .enablePositionalOptions()

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

    // ── Chat command (default) ──────────────────────────────────────────────
    const chatCmd = program
        .command("chat", { isDefault: true })
        .description("Start an interactive chat session with a coding agent")
        .option("-a, --agent <name>", `Agent to chat with (${agentChoices})`)
        .allowUnknownOption()
        .allowExcessArguments(true)
        .enablePositionalOptions()
        .passThroughOptions()
        .addHelpText(
            "after",
            `
All arguments after -a <agent> are forwarded to the native agent CLI.

Examples:
  $ atomic chat -a claude                           Start Claude interactively
  $ atomic chat -a copilot                          Start Copilot interactively
  $ atomic chat -a opencode                         Start OpenCode interactively
  $ atomic chat -a claude "fix the bug"             Claude with initial prompt
  $ atomic chat session list                        List running sessions
  $ atomic chat session connect <id>                Attach to a session
  $ atomic chat session kill [id]                   Kill a chat session (or all)`,
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

    // Chat session subcommands: atomic chat session list / connect
    addSessionSubcommand(chatCmd, "chat");

    // ── Workflow command ─────────────────────────────────────────────────────
    //
    // Three shapes:
    //   1. `atomic workflow -a <agent>`                 — interactive picker
    //   2. `atomic workflow -n <name> -a <agent> ...`   — named run
    //   3. `atomic workflow list [-a <agent>]`          — list workflows
    //
    // `allowUnknownOption` + `allowExcessArguments` let unknown flags and
    // positional tokens land in `cmd.args`, forwarded as `passthroughArgs`
    // so the command layer can parse them against the workflow's schema.
    const workflowCmd = program
        .command("workflow")
        .description("Run a multi-session agent workflow")
        .option("-n, --name <name>", "Workflow name (matches directory under .atomic/workflows/<name>/)")
        .option("-a, --agent <name>", `Agent to use (${agentChoices})`)
        .option("-d, --detach", "Start the workflow in the background without attaching (auto-enabled when launched from inside an atomic chat/workflow session to avoid hijacking it). Attach later with 'atomic workflow session connect <id>'.")
        .allowUnknownOption()
        .allowExcessArguments(true)
        .enablePositionalOptions()
        .passThroughOptions()
        .addHelpText(
            "after",
            `
Examples:
  $ atomic workflow list                            List available workflows
  $ atomic workflow list -a claude                  List Claude workflows only
  $ atomic workflow -a claude                       Open the interactive picker
  $ atomic workflow -n ralph -a claude "fix bug"    Run a free-form workflow
  $ atomic workflow -n gen-spec -a claude --research_doc=notes.md --focus=standard
                                                    Run a structured-input workflow
  $ atomic workflow -n ralph -a claude -d "fix bug" Run detached in the background
  $ atomic workflow session list                    List running sessions
  $ atomic workflow session connect <id>            Attach to a session
  $ atomic workflow session kill [id]               Kill a workflow session (or all)`,
        )
        .action(async (localOpts, cmd) => {
            const { workflowCommand } = await import("./commands/cli/workflow.ts");
            const exitCode = await workflowCommand({
                name: localOpts.name,
                agent: localOpts.agent,
                detach: localOpts.detach,
                passthroughArgs: cmd.args,
            });
            process.exit(exitCode);
        });

    // Workflow list subcommand: atomic workflow list [-a <agent>]
    workflowCmd
        .command("list")
        .description("List available workflows")
        .option("-a, --agent <name>", `Filter by agent (${agentChoices})`)
        .action(async (localOpts) => {
            const { workflowCommand } = await import("./commands/cli/workflow.ts");
            const exitCode = await workflowCommand({
                list: true,
                agent: localOpts.agent,
            });
            process.exit(exitCode);
        });

    // Workflow session subcommands: atomic workflow session list / connect
    addSessionSubcommand(workflowCmd, "workflow");

    // ── Top-level session command ───────────────────────────────────────────
    addSessionSubcommand(program);

    // ── Config command ──────────────────────────────────────────────────────
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

    // ── Internal: footer renderer (spawned inside agent tmux windows) ──────
    program
        .command("_footer", { hidden: true })
        .description("Internal: render the attached-mode footer for an agent window")
        .requiredOption("--name <name>", "Agent window name")
        .action(async (opts: { name: string }) => {
            const { footerCommand } = await import("./commands/cli/footer.tsx");
            const exitCode = await footerCommand(opts.name);
            process.exit(exitCode);
        });

    // ── Completions command ────────────────────────────────────────────────
    program
        .command("completions")
        .description("Output shell completion script")
        .argument("<shell>", `Shell type (${SUPPORTED_SHELLS.join(", ")})`)
        .addHelpText(
            "after",
            `
Install completions for your shell:

  Bash   eval "$(atomic completions bash)"     # add to ~/.bashrc
  Zsh    eval "$(atomic completions zsh)"      # add to ~/.zshrc
  Fish   atomic completions fish | source      # or save to ~/.config/fish/completions/atomic.fish
  PowerShell  atomic completions powershell | Invoke-Expression  # add to $PROFILE`,
        )
        .action(async (shell) => {
            if (!SUPPORTED_SHELLS.includes(shell as Shell)) {
                console.error(
                    `${COLORS.red}Error: Unknown shell '${shell}'${COLORS.reset}`,
                );
                console.error(`Supported shells: ${SUPPORTED_SHELLS.join(", ")}`);
                process.exit(1);
            }
            const { completionsCommand } = await import("./commands/cli/completions.ts");
            const exitCode = completionsCommand(shell as Shell);
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
            argv.includes("-h") ||
            argv[0] === "completions" ||
            argv[0] === "_footer";

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
