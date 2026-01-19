/**
 * Run agent command - Spawn and run a configured agent
 */

import { AGENT_CONFIG, isValidAgent, type AgentKey } from "../config";
import { isCommandInstalled } from "../utils/detect";

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
 * @param agentKey The agent key (e.g., "claude-code", "opencode", "copilot-cli")
 * @returns Exit code from the agent process
 */
export async function runAgentCommand(agentKey: string): Promise<number> {
  // Validate agent key
  if (!isValidAgent(agentKey)) {
    const validKeys = Object.keys(AGENT_CONFIG).join(", ");
    const sanitizedKey = sanitizeForDisplay(agentKey);
    console.error(`Error: Unknown agent '${sanitizedKey}'`);
    console.error(`Valid agents: ${validKeys}`);
    return 1;
  }

  const agent = AGENT_CONFIG[agentKey as AgentKey];

  // Check if command is installed
  if (!isCommandInstalled(agent.cmd)) {
    console.error(`Error: ${agent.name} is not installed.`);
    console.error(`Install it from: ${agent.install_url}`);
    return 1;
  }

  // Build the command with flags
  const cmd = [agent.cmd, ...agent.additional_flags];

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
