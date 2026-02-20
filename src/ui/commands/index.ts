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
  type FeatureProgressState,
} from "./registry.ts";

// ============================================================================
// IMPORTS FOR LOCAL USE
// ============================================================================

import { globalRegistry } from "./registry.ts";
import { registerBuiltinCommands } from "./builtin-commands.ts";
import { registerWorkflowCommands, loadWorkflowsFromDisk } from "./workflow-commands.ts";
import { discoverAndRegisterDiskSkills } from "./skill-commands.ts";
import { registerAgentCommands } from "./agent-commands.ts";

// ============================================================================
// RE-EXPORTS FROM COMMAND MODULES
// ============================================================================

export {
  // Built-in commands (help, theme, clear, compact)
  // Note: /status removed - progress tracked via research/progress.txt instead
  registerBuiltinCommands,
  builtinCommands,
  helpCommand,
  themeCommand,
  clearCommand,
} from "./builtin-commands.ts";

export {
  // Workflow commands
  registerWorkflowCommands,
  workflowCommands,
  getWorkflowMetadata,
  loadWorkflowsFromDisk,
  getAllWorkflows,
  discoverWorkflowFiles,
  getWorkflowCommands,
  saveTasksToActiveSession,
  type WorkflowMetadata,
} from "./workflow-commands.ts";

export {
  // Disk skill discovery
  discoverAndRegisterDiskSkills,
  type SkillSource,
  type DiscoveredSkillFile,
  type DiskSkillDefinition,
} from "./skill-commands.ts";

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize all commands asynchronously, including dynamic workflow loading.
 *
 * This function loads workflows from:
 * - .atomic/workflows/ (local project workflows - highest priority)
 * - ~/.atomic/workflows/ (global user workflows)
 * - Built-in workflows (lowest priority)
 *
 * @returns The number of commands registered
 */
export async function initializeCommandsAsync(): Promise<number> {
  const beforeCount = globalRegistry.size();

  // Register built-in commands first
  registerBuiltinCommands();

  // Load workflows from disk before registering workflow commands
  await loadWorkflowsFromDisk();
  registerWorkflowCommands();

  // Discover and register disk-based skills from .claude/skills/, .github/skills/, etc.
  // Disk skills use project > user priority
  await discoverAndRegisterDiskSkills();

  // Discover and register agent commands from .claude/agents/*.md etc.
  // Disk agents override builtins with the same name (project > builtin priority)
  await registerAgentCommands();

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
 * parseSlashCommand("/ralph Build a feature")
 * // { isCommand: true, name: "ralph", args: "Build a feature", raw: "/ralph Build a feature" }
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
