#!/usr/bin/env bun
/**
 * Atomic CLI - Configuration management for coding agents
 *
 * Usage:
 *   atomic                     Interactive setup (same as 'atomic init')
 *   atomic init                Interactive setup with agent selection
 *   atomic init --agent <n>    Setup specific agent (skip selection)
 *   atomic --agent <n>         Run agent (auto-setup if needed)
 *   atomic --version           Show version
 *   atomic --help              Show help
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
  atomic                        Interactive setup (same as 'atomic init')
  atomic init                   Interactive setup with agent selection
  atomic init --agent <name>    Setup specific agent (skip selection)
  atomic --agent <name>         Run agent (auto-setup if needed)
  atomic --version              Show version
  atomic --help                 Show this help

Options:
  -a, --agent <name>    Agent name: ${agents}
  -v, --version         Show version number
  -h, --help            Show this help
  --no-banner           Skip ASCII banner display

Available agents: ${agents}

Examples:
  atomic                        # Start interactive setup
  atomic init -a claude-code    # Setup Claude Code directly (short form)
  atomic init --agent opencode  # Setup OpenCode directly (long form)
  atomic -a claude-code         # Run Claude Code (setup if needed, short form)
  atomic --agent claude-code    # Run Claude Code (setup if needed, long form)
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const { values, positionals } = parseArgs({
      args: Bun.argv.slice(2),
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

    // Handle positional commands FIRST (before --agent)
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
        // No positional command
        if (typeof values.agent === "string") {
          // atomic --agent [name] → run with conditional init
          const exitCode = await runAgentCommand(values.agent);
          process.exit(exitCode);
        }
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
