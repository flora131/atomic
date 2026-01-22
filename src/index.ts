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
import { configCommand } from "./commands/config";
import { initCommand } from "./commands/init";
import { runAgentCommand } from "./commands/run-agent";
import { updateCommand } from "./commands/update";
import { uninstallCommand } from "./commands/uninstall";
import { AGENT_CONFIG, type AgentKey } from "./config";
import {
  detectMissingSeparatorArgs,
  extractAgentArgs,
  extractAgentName,
  hasForceFlag,
  hasYesFlag,
  isAgentRunMode,
  isInitWithSeparator,
} from "./utils/arg-parser";
import { cleanupWindowsLeftoverFiles } from "./utils/cleanup";
import { COLORS } from "./utils/colors";
import { VERSION } from "./version";

/**
 * Show help message
 */
function showHelp(): void {
  const agents = Object.keys(AGENT_CONFIG).join(", ");

  console.log(`
atomic - Configuration management for coding agents

USAGE:
  atomic                             Interactive setup (same as 'atomic init')
  atomic init                        Interactive setup with agent selection
  atomic init --agent <name>         Setup specific agent (skip selection)
  atomic --agent <name> [-- args...] Run agent with arguments (auto-setup if needed)
  atomic config set telemetry <true|false>  Enable/disable telemetry
  atomic update                      Self-update to latest version (binary installs only)
  atomic uninstall                   Remove atomic installation (binary installs only)
  atomic --version                   Show version
  atomic --help                      Show this help

COMMANDS:
  init        Setup configuration files for a coding agent
  config      Manage configuration (e.g., telemetry settings)
  update      Self-update atomic to the latest version (binary installs)
  uninstall   Remove atomic installation (binary installs)

GENERAL OPTIONS:
  -a, --agent <name>    Agent name: ${agents}
  -f, --force           Overwrite all config files including CLAUDE.md/AGENTS.md
  -y, --yes             Auto-confirm all prompts (non-interactive mode)
  -v, --version         Show version number
  -h, --help            Show this help
  --no-banner           Skip ASCII banner display
  --                    Separator: args after this go to the agent

UNINSTALL OPTIONS:
  --dry-run             Preview what would be removed without removing
  --keep-config         Keep configuration data, only remove binary

Available agents: ${agents}

EXAMPLES:
  atomic                                    # Start interactive setup
  atomic init -a claude                     # Setup Claude Code directly
  atomic -a claude                          # Run Claude Code (setup if needed)
  atomic -a claude -- "fix the bug"         # Run Claude Code with a prompt
  atomic update                             # Update to latest version
  atomic uninstall                          # Uninstall atomic
  atomic uninstall --dry-run                # Preview uninstall without removing
  atomic uninstall --keep-config            # Uninstall but keep config files
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Clean up leftover Windows files from previous uninstall/update operations
  // This is a no-op on non-Windows platforms
  await cleanupWindowsLeftoverFiles();

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
      const forceFlag = hasForceFlag(rawArgs);
      const yesFlag = hasYesFlag(rawArgs);
      const exitCode = await runAgentCommand(agentName, agentArgs, { force: forceFlag, yes: yesFlag });
      process.exit(exitCode);
    }

    const { values, positionals } = parseArgs({
      args: rawArgs,
      options: {
        agent: { type: "string", short: "a" },
        force: { type: "boolean", short: "f" },
        yes: { type: "boolean", short: "y" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        "no-banner": { type: "boolean" },
        // Uninstall command options
        "keep-config": { type: "boolean" },
        "dry-run": { type: "boolean" },
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
        // atomic init [--agent name] [--force] [--yes] → init with optional pre-selection
        await initCommand({
          showBanner: !values["no-banner"],
          preSelectedAgent: values.agent as AgentKey | undefined,
          force: values.force as boolean | undefined,
          yes: values.yes as boolean | undefined,
        });
        break;

      case "update":
        // atomic update - upgrade to latest version
        await updateCommand();
        break;

      case "uninstall":
        // atomic uninstall [--dry-run] [--yes] [--keep-config]
        await uninstallCommand({
          dryRun: values["dry-run"] as boolean | undefined,
          yes: values.yes as boolean | undefined,
          keepConfig: values["keep-config"] as boolean | undefined,
        });
        break;

      case "config":
        // atomic config set <key> <value>
        await configCommand(positionals[1], positionals[2], positionals[3]);
        break;

      case undefined:
        // atomic [--force] [--yes] → full interactive init (unchanged behavior)
        await initCommand({
          showBanner: !values["no-banner"],
          force: values.force as boolean | undefined,
          yes: values.yes as boolean | undefined,
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
