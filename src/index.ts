#!/usr/bin/env bun
/**
 * Atomic CLI - Configuration management for coding agents
 *
 * Usage:
 *   atomic                          Interactive setup (same as 'atomic init')
 *   atomic init                     Interactive setup with agent selection
 *   atomic init --agent <n>         Setup specific agent (skip selection)
 *   atomic --agent <n> [args...]    Run agent with arguments (auto-setup if needed)
 *   atomic --version                Show version
 *   atomic --help                   Show help
 */

import { parseArgs } from "util";
import { initCommand } from "./commands/init";
import { runAgentCommand } from "./commands/run-agent";
import { AGENT_CONFIG, type AgentKey } from "./config";
import { VERSION } from "./version";

/**
 * Show help message
 */
function showHelp(): void {
  const agents = Object.keys(AGENT_CONFIG).join(", ");

  console.log(`
atomic - Configuration management for coding agents

Usage:
  atomic                             Interactive setup (same as 'atomic init')
  atomic init                        Interactive setup with agent selection
  atomic init --agent <name>         Setup specific agent (skip selection)
  atomic --agent <name> [args...]    Run agent with arguments (auto-setup if needed)
  atomic --version                   Show version
  atomic --help                      Show this help

Options:
  -a, --agent <name>    Agent name: ${agents}
  -v, --version         Show version number
  -h, --help            Show this help
  --no-banner           Skip ASCII banner display

Available agents: ${agents}

Examples:
  atomic                                    # Start interactive setup
  atomic init -a claude-code                # Setup Claude Code directly
  atomic -a claude-code                     # Run Claude Code (setup if needed)
  atomic -a claude-code "fix the bug"       # Run Claude Code with a prompt
  atomic -a opencode --resume               # Run OpenCode with flags
`);
}

/**
 * Extract agent arguments from raw args
 * Returns everything after the agent name when using -a/--agent
 */
function extractAgentArgs(args: string[]): string[] {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    // Handle -a <agent> or --agent <agent>
    if (arg === "-a" || arg === "--agent") {
      // Agent name is next arg, everything after that is for the agent
      return args.slice(i + 2);
    }

    // Handle --agent=<agent> or -a=<agent>
    if (arg.startsWith("--agent=") || arg.startsWith("-a=")) {
      // Everything after this arg is for the agent
      return args.slice(i + 1);
    }
  }

  return [];
}

/**
 * Check if raw args indicate agent run mode (not init)
 * Returns true if -a/--agent is present WITHOUT the init command
 */
function isAgentRunMode(args: string[]): boolean {
  let hasAgent = false;
  let hasInit = false;

  for (const arg of args) {
    if (arg === "init") {
      hasInit = true;
    }
    if (arg === "-a" || arg === "--agent" || arg.startsWith("--agent=") || arg.startsWith("-a=")) {
      hasAgent = true;
    }
  }

  return hasAgent && !hasInit;
}

/**
 * Extract agent name from raw args
 */
function extractAgentName(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    // Handle -a <agent> or --agent <agent>
    if (arg === "-a" || arg === "--agent") {
      return args[i + 1];
    }

    // Handle --agent=<agent> or -a=<agent>
    if (arg.startsWith("--agent=")) {
      return arg.slice(8);
    }
    if (arg.startsWith("-a=")) {
      return arg.slice(3);
    }
  }

  return undefined;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const rawArgs = Bun.argv.slice(2);

    // PRIORITY: If in agent run mode, pass all args after agent name to the agent
    // This ensures flags like --help, -v, etc. go to the agent, not atomic
    if (isAgentRunMode(rawArgs)) {
      const agentName = extractAgentName(rawArgs);
      if (agentName) {
        const agentArgs = extractAgentArgs(rawArgs);
        const exitCode = await runAgentCommand(agentName, agentArgs);
        process.exit(exitCode);
      }
    }

    const { values, positionals } = parseArgs({
      args: rawArgs,
      options: {
        agent: { type: "string", short: "a" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        "no-banner": { type: "boolean" },
      },
      strict: false,
      allowPositionals: true,
    });

    // Handle --version
    if (values.version) {
      console.log(`atomic v${VERSION}`);
      return;
    }

    // Handle --help
    if (values.help) {
      showHelp();
      return;
    }

    // Handle positional commands
    const command = positionals[0];

    switch (command) {
      case "init":
        // atomic init [--agent name] → init with optional pre-selection
        await initCommand({
          showBanner: !values["no-banner"],
          preSelectedAgent: values.agent as AgentKey | undefined,
        });
        break;

      case undefined:
        // atomic → full interactive init (unchanged behavior)
        await initCommand({ showBanner: !values["no-banner"] });
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error("Run 'atomic --help' for usage information.");
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
