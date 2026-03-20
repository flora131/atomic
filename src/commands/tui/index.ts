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
} from "@/commands/tui/registry.ts";

// ============================================================================
// IMPORTS FOR LOCAL USE
// ============================================================================

import { globalRegistry } from "@/commands/tui/registry.ts";
import { registerBuiltinCommands } from "@/commands/tui/builtin-commands.ts";
import {
    registerWorkflowCommands,
    loadWorkflowsFromDisk,
} from "@/commands/tui/workflow-commands/index.ts";
import { discoverAndRegisterDiskSkills } from "@/commands/tui/skill-commands.ts";
import { registerAgentCommands } from "@/commands/tui/agent-commands.ts";
import type { ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import { startProviderDiscoverySessionCache } from "@/services/config/provider-discovery-cache.ts";

// ============================================================================
// RE-EXPORTS FROM COMMAND MODULES
// ============================================================================

export {
    // Built-in commands (help, theme, clear, compact)
    // Note: /status removed - progress tracked via research/progress.txt instead
    registerBuiltinCommands,
    builtinCommands,
    themeCommand,
    clearCommand,
} from "@/commands/tui/builtin-commands.ts";

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
} from "@/commands/tui/workflow-commands/index.ts";

export {
    // Disk skill discovery
    discoverAndRegisterDiskSkills,
    type SkillSource,
    type DiscoveredSkillFile,
    type DiskSkillDefinition,
} from "@/commands/tui/skill-commands.ts";

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
export interface InitializeCommandsOptions {
    providerDiscoveryPlan?: ProviderDiscoveryPlan;
    loadWorkflowsFromDiskFn?: () => Promise<void>;
    discoverAndRegisterDiskSkillsFn?: (
        providerDiscoveryPlan?: ProviderDiscoveryPlan,
    ) => Promise<void>;
    registerAgentCommandsFn?: (
        providerDiscoveryPlan?: ProviderDiscoveryPlan,
    ) => Promise<void>;
}

export async function initializeCommandsAsync(
    options: InitializeCommandsOptions = {},
): Promise<number> {
    startProviderDiscoverySessionCache({
        startupPlan: options.providerDiscoveryPlan,
    });

    const loadWorkflows =
        options.loadWorkflowsFromDiskFn ?? loadWorkflowsFromDisk;
    const discoverDiskSkills =
        options.discoverAndRegisterDiskSkillsFn ??
        discoverAndRegisterDiskSkills;
    const registerAgents =
        options.registerAgentCommandsFn ?? registerAgentCommands;

    const beforeCount = globalRegistry.size();

    // Register built-in commands first
    registerBuiltinCommands();

    // Load workflows from disk before registering workflow commands
    await loadWorkflows();
    registerWorkflowCommands();

    // Discover and register disk-based skills from .claude/skills/, .github/skills/, etc.
    // Disk skills use project > user priority
    await discoverDiskSkills(options.providerDiscoveryPlan);

    // Discover and register agent commands from .claude/agents/*.md etc.
    // Disk agents override builtins with the same name (project > builtin priority)
    await registerAgents(options.providerDiscoveryPlan);

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

    // Find the first whitespace boundary (space or newline) after the command name
    const wsIndex = withoutSlash.search(/[\s]/);

    if (wsIndex === -1) {
        // No whitespace - entire string is the command name
        return {
            isCommand: true,
            name: withoutSlash.toLowerCase(),
            args: "",
            raw: input,
        };
    }

    // Split at first whitespace
    const name = withoutSlash.slice(0, wsIndex).toLowerCase();
    const args = withoutSlash.slice(wsIndex + 1).trim();

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
