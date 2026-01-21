/**
 * Run agent command - Spawn and run a configured agent
 */

import { join } from "path";

import { AGENT_CONFIG, isValidAgent, type AgentKey } from "../config";
import { getCommandPath } from "../utils/detect";
import { pathExists } from "../utils/copy";
import { initCommand } from "./init";

/**
 * Sanitize user input for safe display in error messages
 * Prevents log injection via ANSI escape sequences or control characters
 */
function sanitizeForDisplay(input: string): string {
  // Remove ANSI escape sequences and control characters
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 50);
}

/**
 * Run a specific agent by key
 *
 * This function handles the complete lifecycle of running an agent:
 * 1. Validates the agent key against known agents
 * 2. Auto-runs setup (init) if config folder doesn't exist
 * 3. Verifies the agent command is installed
 * 4. Spawns the agent process with provided arguments
 *
 * @param agentKey The agent key (e.g., "claude", "opencode", "copilot")
 * @param agentArgs Additional arguments to pass to the agent
 * @returns Exit code from the agent process
 *
 * @example
 * // Run Claude Code with no additional arguments
 * await runAgentCommand("claude");
 *
 * @example
 * // Run Claude Code with a prompt
 * await runAgentCommand("claude", ["fix the bug in auth"]);
 *
 * @example
 * // Run OpenCode with flags
 * await runAgentCommand("opencode", ["--resume"]);
 *
 * @example
 * // Pass agent's own help flag
 * await runAgentCommand("claude", ["--help"]);
 */
interface RunAgentOptions {
  /** Force overwrite of preserved files during auto-init */
  force?: boolean;
}

export async function runAgentCommand(
  agentKey: string,
  agentArgs: string[] = [],
  options: RunAgentOptions = {}
): Promise<number> {
  const isDebug = process.env.DEBUG === "1";

  if (isDebug) {
    console.error(`[atomic:debug] Running agent: ${agentKey}`);
    console.error(`[atomic:debug] Agent args: ${JSON.stringify(agentArgs)}`);
  }

  // Validate agent key
  if (!isValidAgent(agentKey)) {
    const validKeys = Object.keys(AGENT_CONFIG).join(", ");
    const sanitizedKey = sanitizeForDisplay(agentKey);
    console.error(`Error: Unknown agent '${sanitizedKey}'`);
    console.error(`Valid agents: ${validKeys}`);
    return 1;
  }

  const agent = AGENT_CONFIG[agentKey as AgentKey];

  // Check if config folder exists
  const configFolder = join(process.cwd(), agent.folder);
  if (!(await pathExists(configFolder))) {
    // Config not found - run init with pre-selected agent
    // Banner and intro will display first, then the not found message
    await initCommand({
      preSelectedAgent: agentKey as AgentKey,
      showBanner: true,
      configNotFoundMessage: `${agent.folder} not found. Running setup...`,
      force: options.force,
    });
  }

  // Resolve the command path (handles Windows .cmd/.exe extensions)
  const cmdPath = getCommandPath(agent.cmd);
  if (!cmdPath) {
    console.error(`Error: ${agent.name} is not installed.`);
    console.error(`Install it from: ${agent.install_url}`);
    return 1;
  }

  if (isDebug) {
    console.error(`[atomic:debug] Resolved command path: ${cmdPath}`);
  }

  // Build the command with flags and user-provided arguments
  // Replace "." with actual cwd for flags like --add-dir
  const flags = agent.additional_flags.map((flag) =>
    flag === "." ? process.cwd() : flag
  );
  const cmd = [cmdPath, ...flags, ...agentArgs];

  if (isDebug) {
    console.error(`[atomic:debug] Spawning command: ${cmd.join(" ")}`);
  }

  // Spawn the agent process
  const proc = Bun.spawn(cmd, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    cwd: process.cwd(),
  });

  // Wait for the process to exit
  const exitCode = await proc.exited;
  return exitCode;
}
