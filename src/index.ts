#!/usr/bin/env bun
/**
 * Atomic CLI - Configuration management for coding agents
 *
 * Usage:
 *   atomic                          Interactive setup (same as 'atomic init')
 *   atomic init                     Interactive setup with agent selection
 *   atomic init --agent <n>         Setup specific agent (skip selection)
 *   atomic --agent <n> [-- args...] Run agent with arguments (auto-setup if needed)
 *   atomic --version                Show version
 *   atomic --help                   Show help
 */

import { parseArgs } from "util";
import { initCommand } from "./commands/init";
import { runAgentCommand } from "./commands/run-agent";
import { AGENT_CONFIG, type AgentKey } from "./config";
import { extractAgentArgs, extractAgentName, isAgentRunMode } from "./utils/arg-parser";
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
  atomic --agent <name> [-- args...] Run agent with arguments (auto-setup if needed)
  atomic --version                   Show version
  atomic --help                      Show this help

Options:
  -a, --agent <name>    Agent name: ${agents}
  -v, --version         Show version number
  -h, --help            Show this help
  --no-banner           Skip ASCII banner display
  --                    Separator: args after this go to the agent

Available agents: ${agents}

Examples:
  atomic                                    # Start interactive setup
  atomic init -a claude-code                # Setup Claude Code directly
  atomic -a claude-code                     # Run Claude Code (setup if needed)
  atomic -a claude-code -- "fix the bug"    # Run Claude Code with a prompt
  atomic -a opencode -- --resume            # Run OpenCode with --resume flag
  atomic -a claude-code -- --help           # Show Claude Code's help (not atomic's)
`);
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
      if (!agentName) {
        // Agent flag present but no agent name (e.g., "atomic -a" without value)
        console.error("Error: --agent/-a flag requires an agent name");
        console.error(`Valid agents: ${Object.keys(AGENT_CONFIG).join(", ")}`);
        console.error("\nUsage: atomic --agent <name> [-- args...]");
        process.exit(1);
      }
      const agentArgs = extractAgentArgs(rawArgs);
      const exitCode = await runAgentCommand(agentName, agentArgs);
      process.exit(exitCode);
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
