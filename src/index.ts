#!/usr/bin/env bun
/**
 * Atomic CLI - Configuration management for coding agents
 *
 * Usage:
 *   atomic              Interactive setup (same as 'atomic init')
 *   atomic init         Interactive setup with banner
 *   atomic --agent <n>  Run agent directly
 *   atomic --version    Show version
 *   atomic --help       Show help
 */

import { parseArgs } from "util";
import { initCommand } from "./commands/init";
import { runAgentCommand } from "./commands/run-agent";
import { AGENT_CONFIG } from "./config";
import { VERSION } from "./version";

/**
 * Show help message
 */
function showHelp(): void {
  const agents = Object.keys(AGENT_CONFIG).join(", ");

  console.log(`
atomic - Configuration management for coding agents

Usage:
  atomic              Interactive setup (same as 'atomic init')
  atomic init         Interactive setup with banner
  atomic --agent <n>  Run agent directly (skips banner)
  atomic --version    Show version
  atomic --help       Show this help

Options:
  -a, --agent <name>  Run a specific agent
  -v, --version       Show version number
  -h, --help          Show help
  --no-banner         Skip banner display in init

Available agents: ${agents}

Examples:
  atomic                    # Start interactive setup
  atomic init               # Same as above
  atomic --agent claude-code  # Run Claude Code directly
  atomic -a opencode        # Run opencode directly
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

    // Handle --agent
    if (typeof values.agent === "string") {
      const exitCode = await runAgentCommand(values.agent);
      process.exit(exitCode);
    }

    // Handle positional commands
    const command = positionals[0];

    switch (command) {
      case undefined:
      case "init":
        await initCommand({
          showBanner: !values["no-banner"],
        });
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
