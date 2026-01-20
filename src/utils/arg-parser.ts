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
  // Only check for init before the -- separator, since init after
  // the separator is an argument for the agent, not a command
  const separatorIndex = args.indexOf("--");
  const argsBeforeSeparator = separatorIndex === -1 ? args : args.slice(0, separatorIndex);

  const hasInit = argsBeforeSeparator.includes("init");
  const hasAgent = argsBeforeSeparator.some(
    (arg) => arg === "-a" || arg === "--agent" || arg.startsWith("--agent=") || arg.startsWith("-a=")
  );

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
      const value = args[i + 1];
      // Don't treat the separator as an agent name
      if (value && value !== "--") {
        return value;
      }
      return undefined;
    }

    // Handle --agent=<agent> or -a=<agent>
    if (arg.startsWith("--agent=")) {
      const value = arg.slice(8);
      return value || undefined;
    }
    if (arg.startsWith("-a=")) {
      const value = arg.slice(3);
      return value || undefined;
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

/**
 * Check if the init command is being used with a `--` separator.
 * This is invalid because init doesn't support passing args to the agent.
 *
 * @param args - Raw CLI arguments
 * @returns true if init is used with -- separator
 *
 * @example
 * isInitWithSeparator(["init", "-a", "claude-code", "--", "/commit"])
 * // => true (invalid usage)
 *
 * @example
 * isInitWithSeparator(["init", "-a", "claude-code"])
 * // => false (valid usage)
 *
 * @example
 * isInitWithSeparator(["-a", "claude-code", "--", "/commit"])
 * // => false (not init mode)
 */
export function isInitWithSeparator(args: string[]): boolean {
  // Only check for init before the -- separator, since init after
  // the separator is an argument for the agent, not a command
  const separatorIndex = args.indexOf("--");
  const argsBeforeSeparator = separatorIndex === -1 ? args : args.slice(0, separatorIndex);

  const hasInit = argsBeforeSeparator.includes("init");
  const hasSeparator = separatorIndex !== -1;
  return hasInit && hasSeparator;
}

/**
 * Detect arguments that look like they were intended for the agent
 * but are missing the `--` separator.
 *
 * This helps provide a helpful error message when users forget the separator.
 *
 * @param args - Raw CLI arguments
 * @returns Array of suspicious arguments that might be intended for the agent
 *
 * @example
 * detectMissingSeparatorArgs(["-a", "claude-code", "/commit"])
 * // => ["/commit"] (slash command without separator)
 *
 * @example
 * detectMissingSeparatorArgs(["-a", "claude-code", "fix the bug"])
 * // => ["fix the bug"] (prompt without separator)
 *
 * @example
 * detectMissingSeparatorArgs(["-a", "claude-code", "--", "/commit"])
 * // => [] (separator present, no issue)
 */
export function detectMissingSeparatorArgs(args: string[]): string[] {
  const separatorIndex = args.indexOf("--");

  // If separator exists, no problem
  if (separatorIndex !== -1) {
    return [];
  }

  const suspiciousArgs: string[] = [];
  let foundAgentValue = false;
  let skipNext = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    // Skip the value after -a or --agent
    if (skipNext) {
      skipNext = false;
      foundAgentValue = true;
      continue;
    }

    // Track when we've passed the agent flag and its value
    if (arg === "-a" || arg === "--agent") {
      skipNext = true;
      continue;
    }

    // Handle --agent=value or -a=value
    if (arg.startsWith("--agent=") || arg.startsWith("-a=")) {
      foundAgentValue = true;
      continue;
    }

    // Skip known atomic flags
    if (arg === "-v" || arg === "--version" || arg === "-h" || arg === "--help" || arg === "--no-banner") {
      continue;
    }

    // After we've found the agent value, anything else is suspicious
    if (foundAgentValue) {
      // Slash commands are very likely agent arguments
      if (arg.startsWith("/")) {
        suspiciousArgs.push(arg);
        continue;
      }

      // Flags that aren't atomic's own flags
      if (arg.startsWith("-")) {
        suspiciousArgs.push(arg);
        continue;
      }

      // Any other positional argument after the agent name
      // is likely a prompt or argument for the agent
      suspiciousArgs.push(arg);
    }
  }

  return suspiciousArgs;
}
