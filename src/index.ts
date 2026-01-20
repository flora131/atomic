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
import {
  detectMissingSeparatorArgs,
  extractAgentArgs,
  extractAgentName,
  isAgentRunMode,
  isInitWithSeparator,
} from "./utils/arg-parser";
import { COLORS } from "./utils/colors";
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

    // FAIL FAST: Check for invalid usage of init with -- separator
    // init doesn't support passing args to the agent; use run mode instead
    if (isInitWithSeparator(rawArgs)) {
      const agentName = extractAgentName(rawArgs) || "<agent>";
      const agentArgs = extractAgentArgs(rawArgs);

      const { bold, dim, reset, green, yellow } = COLORS;

      console.error(`${yellow}Error: 'init' command does not support passing arguments to the agent.${reset}`);
      console.error("");
      console.error(`${dim}The 'init' command only sets up configuration files.${reset}`);
      console.error(`${dim}To setup and run the agent with arguments, omit 'init':${reset}`);
      console.error("");
      if (agentArgs.length > 0) {
        const quotedArgs = agentArgs.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
        console.error(`  ${bold}${green}atomic --agent ${agentName} -- ${quotedArgs}${reset}`);
      } else {
        console.error(`  ${bold}${green}atomic --agent ${agentName}${reset}`);
      }
      console.error("");
      console.error(`${dim}This will auto-setup if needed, then run the agent with your arguments.${reset}`);
      process.exit(1);
    }

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

      // FAIL FAST: Validate agent name before checking for suspicious args
      // This gives clearer error messages (e.g., "unknown agent" instead of "missing separator")
      if (!(agentName in AGENT_CONFIG)) {
        const validAgents = Object.keys(AGENT_CONFIG).join(", ");
        console.error(`Error: Unknown agent '${agentName}'`);
        console.error(`Valid agents: ${validAgents}`);
        process.exit(1);
      }

      // FAIL FAST: Check for arguments that look like they should go to the agent
      // but are missing the required `--` separator
      const suspiciousArgs = detectMissingSeparatorArgs(rawArgs);
      if (suspiciousArgs.length > 0) {
        const { bold, dim, reset, green, yellow } = COLORS;

        console.error(`${yellow}Error: Missing '--' separator before agent arguments.${reset}`);
        console.error("");
        console.error(`${dim}It looks like you meant to pass arguments to the agent:${reset}`);
        console.error(`  ${suspiciousArgs.map((a) => `"${a}"`).join(" ")}`);
        console.error("");
        console.error("Try this instead:");
        const quotedArgs = suspiciousArgs.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
        console.error(`  ${bold}${green}atomic --agent ${agentName} -- ${quotedArgs}${reset}`);
        console.error("");
        console.error(`${dim}The '--' separator is required to distinguish atomic flags from agent arguments.${reset}`);
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
