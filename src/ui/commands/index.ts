/**
 * Commands Module Index
 *
 * Central entry point for the chat UI command system.
 * Provides command registration, lookup, and execution utilities.
 *
 * Reference: Feature 5 - Create commands module index with initialization function
 */

// ============================================================================
// RE-EXPORTS FROM REGISTRY
// ============================================================================

export {
  // Class
  CommandRegistry,
  // Singleton
  globalRegistry,
  // Types
  type CommandDefinition,
  type CommandContext,
  type CommandContextState,
  type CommandResult,
  type CommandCategory,
} from "./registry.ts";

// ============================================================================
// RE-EXPORTS FROM COMMAND MODULES
// ============================================================================

export {
  // Built-in commands
  registerBuiltinCommands,
  builtinCommands,
  helpCommand,
  statusCommand,
  approveCommand,
  rejectCommand,
  themeCommand,
  clearCommand,
} from "./builtin-commands.ts";

export {
  // Workflow commands
  registerWorkflowCommands,
  workflowCommands,
  WORKFLOW_DEFINITIONS,
  getWorkflowMetadata,
  createWorkflowByName,
  type WorkflowMetadata,
} from "./workflow-commands.ts";

export {
  // Skill commands
  registerSkillCommands,
  skillCommands,
  SKILL_DEFINITIONS,
  getSkillMetadata,
  isRalphSkill,
  getRalphSkills,
  getCoreSkills,
  type SkillMetadata,
} from "./skill-commands.ts";

// ============================================================================
// INITIALIZATION
// ============================================================================

import { globalRegistry } from "./registry.ts";
import { registerBuiltinCommands } from "./builtin-commands.ts";
import { registerWorkflowCommands } from "./workflow-commands.ts";
import { registerSkillCommands } from "./skill-commands.ts";

/**
 * Initialize all commands by registering them with the global registry.
 *
 * This function is idempotent - calling it multiple times is safe.
 * Commands are registered in this order:
 * 1. Built-in commands (help, status, approve, reject, theme, clear)
 * 2. Workflow commands (atomic)
 * 3. Skill commands (commit, research-codebase, etc.)
 *
 * @returns The number of commands registered
 *
 * @example
 * ```typescript
 * import { initializeCommands, globalRegistry } from "./commands";
 *
 * // Initialize at app startup
 * const count = initializeCommands();
 * console.log(`Registered ${count} commands`);
 *
 * // Now commands are available
 * const helpCmd = globalRegistry.get("help");
 * ```
 */
export function initializeCommands(): number {
  const beforeCount = globalRegistry.size();

  // Register all command types
  registerBuiltinCommands();
  registerWorkflowCommands();
  registerSkillCommands();

  const afterCount = globalRegistry.size();
  return afterCount - beforeCount;
}

// ============================================================================
// SLASH COMMAND PARSING
// ============================================================================

/**
 * Result of parsing a slash command input.
 */
export interface ParsedSlashCommand {
  /** Whether the input is a valid slash command */
  isCommand: boolean;
  /** The command name (without leading slash) */
  name: string;
  /** The arguments after the command name */
  args: string;
  /** The raw input string */
  raw: string;
}

/**
 * Parse a slash command from user input.
 *
 * Extracts the command name and arguments from input that starts with "/".
 * Returns isCommand: false if the input doesn't start with "/".
 *
 * @param input - The raw user input string
 * @returns Parsed command information
 *
 * @example
 * ```typescript
 * parseSlashCommand("/help")
 * // { isCommand: true, name: "help", args: "", raw: "/help" }
 *
 * parseSlashCommand("/atomic Build a feature")
 * // { isCommand: true, name: "atomic", args: "Build a feature", raw: "/atomic Build a feature" }
 *
 * parseSlashCommand("Hello world")
 * // { isCommand: false, name: "", args: "", raw: "Hello world" }
 * ```
 */
export function parseSlashCommand(input: string): ParsedSlashCommand {
  const trimmed = input.trim();

  // Check if it starts with /
  if (!trimmed.startsWith("/")) {
    return {
      isCommand: false,
      name: "",
      args: "",
      raw: input,
    };
  }

  // Remove the leading slash
  const withoutSlash = trimmed.slice(1);

  // Split into command name and args
  const spaceIndex = withoutSlash.indexOf(" ");

  if (spaceIndex === -1) {
    // No space - entire string is the command name
    return {
      isCommand: true,
      name: withoutSlash.toLowerCase(),
      args: "",
      raw: input,
    };
  }

  // Split at first space
  const name = withoutSlash.slice(0, spaceIndex).toLowerCase();
  const args = withoutSlash.slice(spaceIndex + 1).trim();

  return {
    isCommand: true,
    name,
    args,
    raw: input,
  };
}

/**
 * Check if an input string is a slash command.
 *
 * @param input - The input string to check
 * @returns True if the input starts with "/"
 */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith("/");
}

/**
 * Get the command name prefix from partial input.
 *
 * Used for autocomplete - extracts the partial command name
 * from input like "/hel" -> "hel".
 *
 * @param input - The partial input string
 * @returns The command prefix (empty string if not a command)
 */
export function getCommandPrefix(input: string): string {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    return "";
  }

  // Remove leading slash
  const withoutSlash = trimmed.slice(1);

  // If there's a space, it's not a prefix anymore
  if (withoutSlash.includes(" ")) {
    return "";
  }

  return withoutSlash.toLowerCase();
}
