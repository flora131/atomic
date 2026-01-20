/**
 * Argument parsing utilities for CLI
 * These functions handle agent run mode detection and argument extraction
 */

/**
 * Check if raw args indicate agent run mode (not init)
 * Returns true if -a/--agent is present WITHOUT the init command
 *
 * @param args - Raw CLI arguments
 * @returns true if in agent run mode
 *
 * @example
 * isAgentRunMode(["-a", "claude-code"])           // true
 * isAgentRunMode(["--agent", "opencode", "--resume"]) // true
 * isAgentRunMode(["init", "-a", "claude-code"])   // false (init mode)
 * isAgentRunMode(["--help"])                       // false (no agent)
 */
export function isAgentRunMode(args: string[]): boolean {
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
 *
 * @param args - Raw CLI arguments
 * @returns The agent name or undefined if not found
 *
 * @example
 * extractAgentName(["-a", "claude-code"])      // "claude-code"
 * extractAgentName(["--agent=opencode"])       // "opencode"
 * extractAgentName(["-a"])                      // undefined (missing value)
 * extractAgentName(["--help"])                  // undefined (no agent flag)
 */
export function extractAgentName(args: string[]): string | undefined {
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
 * Extract agent arguments from raw args
 * Returns everything after the `--` separator
 *
 * The `--` separator is required to pass arguments to the agent.
 * This prevents ambiguity between atomic flags and agent flags.
 *
 * @param args - Raw CLI arguments
 * @returns Array of arguments to pass to the agent (everything after --)
 *
 * @example
 * extractAgentArgs(["-a", "claude-code", "--", "/commit"])
 * // => ["/commit"]
 *
 * @example
 * extractAgentArgs(["-a", "claude-code", "--", "--help"])
 * // => ["--help"] (help flag goes to agent, not atomic)
 *
 * @example
 * extractAgentArgs(["-a", "claude-code"])
 * // => [] (no separator, no args passed to agent)
 */
export function extractAgentArgs(args: string[]): string[] {
  const separatorIndex = args.indexOf("--");

  if (separatorIndex !== -1) {
    return args.slice(separatorIndex + 1);
  }

  return [];
}
