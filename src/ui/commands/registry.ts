/**
 * Command Registry for Chat UI
 *
 * Provides a centralized registry for slash commands in the chat interface.
 * Commands can be registered, searched, and executed through this system.
 *
 * Reference: Feature 1 - Create CommandRegistry class and CommandDefinition interface
 */

import type { Session, ModelDisplayInfo } from "../../sdk/types.ts";
import type { AgentType, ModelOperations } from "../../models";
import type { TodoItem } from "../../sdk/tools/todo-write.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result returned when streaming completes via `streamAndWait`.
 */
export interface StreamResult {
  /** The accumulated text content from the streaming response */
  content: string;
  /** Whether the stream was interrupted (e.g., Ctrl+C / ESC) */
  wasInterrupted: boolean;
}

/**
 * State available to commands during execution.
 * Provides access to session, UI state, and helper methods.
 */
/**
 * Options for spawning a sub-agent.
 */
export interface SpawnSubagentOptions {
  /** Display name for the sub-agent in the tree view (e.g., "codebase-analyzer") */
  name?: string;
  /** System prompt for the sub-agent */
  systemPrompt: string;
  /** Initial message/task for the sub-agent */
  message: string;
  /** Tools available to the sub-agent (inherits all if omitted) */
  tools?: string[];
  /** Model to use (sonnet, opus, haiku) */
  model?: "sonnet" | "opus" | "haiku";
}

/**
 * Result from sub-agent execution.
 */
export interface SpawnSubagentResult {
  /** Whether the sub-agent completed successfully */
  success: boolean;
  /** Output/response from the sub-agent */
  output: string;
  /** Error message if failed */
  error?: string;
}

/**
 * State available to commands during execution.
 * Provides access to session, UI state, and helper methods.
 */
export interface CommandContext {
  /** Active session for agent communication (may be null before first message) */
  session: Session | null;
  /** Current UI state (messages, streaming status, etc.) */
  state: CommandContextState;
  /** Helper to add a message to the chat */
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  /** Helper to set streaming state */
  setStreaming: (streaming: boolean) => void;
  /**
   * Send a message through the normal message flow (creates session if needed).
   * Use this for commands that need to invoke agent interactions.
   */
  sendMessage: (content: string) => void;
  /**
   * Send a message to the agent without displaying it as a user message in the chat.
   * Use this for commands that need to invoke agent interactions silently (e.g., skill prompts).
   */
  sendSilentMessage: (content: string) => void;
  /**
   * Spawn a sub-agent with specific configuration.
   * Use this for commands that need to delegate tasks to specialized agents.
   *
   * @param options - Configuration for the sub-agent
   * @returns Promise with the sub-agent execution result
   */
  spawnSubagent: (options: SpawnSubagentOptions) => Promise<SpawnSubagentResult>;
  /**
   * Send a message and wait for the streaming response to complete.
   * Returns the accumulated content and whether it was interrupted.
   * Use this for multi-step workflows that need sequential coordination.
   */
  streamAndWait: (prompt: string) => Promise<StreamResult>;
  /**
   * Clear the current context window (destroy SDK session, clear messages).
   * Preserves todoItems across the clear.
   */
  clearContext: () => Promise<void>;
  /**
   * Update the task list UI with new items.
   */
  setTodoItems: (items: TodoItem[]) => void;
  /**
   * Update workflow state from a command handler.
   */
  updateWorkflowState: (update: Partial<CommandContextState>) => void;
  /** The type of agent currently in use (claude, opencode, copilot) */
  agentType?: AgentType;
  /** Model operations interface for listing, setting, and resolving models */
  modelOps?: ModelOperations;
  /** Resolve current model display info (name + tier) from the SDK client */
  getModelDisplayInfo?: () => Promise<ModelDisplayInfo>;
  /** Get system tools tokens from the client (pre-session fallback) */
  getClientSystemToolsTokens?: () => number | null;
}

/**
 * Feature progress information for workflow status.
 */
export interface FeatureProgressState {
  /** Number of completed features */
  completed: number;
  /** Total number of features */
  total: number;
  /** Name of the current feature being worked on */
  currentFeature?: string;
}

/**
 * UI state passed to commands.
 */
export interface CommandContextState {
  /** Whether a response is currently streaming */
  isStreaming: boolean;
  /** Current message count */
  messageCount: number;
  /** Whether a workflow is active */
  workflowActive?: boolean;
  /** Current workflow type */
  workflowType?: string | null;
  /** Initial prompt for the workflow */
  initialPrompt?: string | null;
  /** Current node being executed in the workflow */
  currentNode?: string | null;
  /** Current iteration number (1-based) */
  iteration?: number;
  /** Maximum number of iterations */
  maxIterations?: number;
  /** Feature progress information */
  featureProgress?: FeatureProgressState | null;
  /** Whether spec approval is pending */
  pendingApproval?: boolean;
  /** Whether spec was approved */
  specApproved?: boolean;
  /** Feedback from spec rejection */
  feedback?: string | null;
  /** Ralph-specific workflow configuration */
  ralphConfig?: {
    userPrompt: string | null;
    resumeSessionId?: string;
    sessionId?: string;
  };
}

/**
 * Result returned from command execution.
 */
export interface CommandResult {
  /** Whether the command executed successfully */
  success: boolean;
  /** Optional message to display in chat */
  message?: string;
  /** Optional state updates to apply */
  stateUpdate?: Partial<CommandContextState>;
  /** If true, clear all messages from the chat */
  clearMessages?: boolean;
  /** If true, destroy the current session and reset it (a new session will be created on next message) */
  destroySession?: boolean;
  /** If true, exit the application */
  shouldExit?: boolean;
  /** If true, show the interactive model selector dialog */
  showModelSelector?: boolean;
  /** Theme to switch to: "dark", "light", or "toggle" */
  themeChange?: "dark" | "light" | "toggle";
  /** Compaction summary text (stored for Ctrl+O history display) */
  compactionSummary?: string;
  /** Skill name if a skill was loaded (triggers SkillLoadIndicator) */
  skillLoaded?: string;
  /** Error message if skill content failed to load */
  skillLoadError?: string;
  /** If true, show the MCP server overlay/dialog */
  showMcpOverlay?: boolean;
  /** MCP server list to display via McpServerListIndicator */
  mcpServers?: import("../../sdk/types.ts").McpServerConfig[];
  /** Display name for the model (used to update the header after /model command) */
  modelDisplayName?: string;
  /** Context usage info to display via ContextInfoDisplay */
  contextInfo?: ContextDisplayInfo;
}

/** Context window usage display data */
export interface ContextDisplayInfo {
  model: string;
  tier: string;
  maxTokens: number;
  /** Pre-message context: system prompt + tool defs + agents + skills + MCP + memory */
  systemTools: number;
  /** Conversation content (all user + assistant messages) */
  messages: number;
  /** Remaining available capacity */
  freeSpace: number;
  /** Autocompact buffer reservation */
  buffer: number;
}

/**
 * Command category for grouping and display.
 */
export type CommandCategory = "builtin" | "workflow" | "skill" | "agent" | "custom";

/**
 * Definition of a slash command.
 */
export interface CommandDefinition {
  /** Primary command name (without leading slash) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Command category for grouping */
  category: CommandCategory;
  /** Function to execute the command */
  execute: (args: string, context: CommandContext) => CommandResult | Promise<CommandResult>;
  /** Alternative names for the command */
  aliases?: string[];
  /** Whether to hide from autocomplete list */
  hidden?: boolean;
  /** Hint text showing expected arguments (e.g., "[model]", "PROMPT [--yolo]") */
  argumentHint?: string;
}

// ============================================================================
// COMMAND REGISTRY CLASS
// ============================================================================

/**
 * Registry for managing slash commands.
 *
 * Provides methods to register, retrieve, and search commands.
 * Supports aliases and category-based organization.
 *
 * @example
 * ```typescript
 * const registry = new CommandRegistry();
 *
 * registry.register({
 *   name: "help",
 *   description: "Show available commands",
 *   category: "builtin",
 *   execute: () => ({ success: true, message: "Help text..." }),
 * });
 *
 * const helpCommand = registry.get("help");
 * const matches = registry.search("he");
 * ```
 */
export class CommandRegistry {
  /** Map of command names to definitions */
  private commands: Map<string, CommandDefinition> = new Map();

  /** Map of aliases to primary command names */
  private aliases: Map<string, string> = new Map();

  /**
   * Register a command with the registry.
   *
   * @param command - Command definition to register
   * @throws Error if command name or alias conflicts with existing registration
   */
  register(command: CommandDefinition): void {
    const name = command.name.toLowerCase();

    // Check for name conflict
    if (this.commands.has(name) || this.aliases.has(name)) {
      throw new Error(`Command name '${name}' is already registered`);
    }

    // Register the command
    this.commands.set(name, command);

    // Register aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        const aliasLower = alias.toLowerCase();

        // Check for alias conflict
        if (this.commands.has(aliasLower) || this.aliases.has(aliasLower)) {
          throw new Error(`Alias '${aliasLower}' conflicts with existing command or alias`);
        }

        this.aliases.set(aliasLower, name);
      }
    }
  }

  /**
   * Unregister a command by name, removing it and its aliases.
   *
   * @param name - Command name to unregister
   * @returns True if the command was found and removed
   */
  unregister(name: string): boolean {
    const key = name.toLowerCase();
    const command = this.commands.get(key);
    if (!command) return false;

    // Remove aliases pointing to this command
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.delete(alias.toLowerCase());
      }
    }

    this.commands.delete(key);
    return true;
  }

  /**
   * Get a command by name or alias.
   *
   * @param nameOrAlias - Command name or alias to look up
   * @returns The command definition, or undefined if not found
   */
  get(nameOrAlias: string): CommandDefinition | undefined {
    const key = nameOrAlias.toLowerCase();

    // Try direct lookup
    const command = this.commands.get(key);
    if (command) {
      return command;
    }

    // Try alias lookup
    const primaryName = this.aliases.get(key);
    if (primaryName) {
      return this.commands.get(primaryName);
    }

    return undefined;
  }

  /**
   * Search for commands matching a prefix.
   *
   * Results are sorted by:
   * 1. Exact matches first
   * 2. Then by category (builtin > workflow > skill > custom)
   * 3. Then alphabetically
   *
   * @param prefix - Prefix to search for (case-insensitive)
   * @returns Array of matching command definitions (excluding hidden commands)
   */
  search(prefix: string): CommandDefinition[] {
    const searchKey = prefix.toLowerCase();
    const matches: CommandDefinition[] = [];
    const seenCommands = new Set<string>();

    // Search command names
    for (const [name, command] of this.commands) {
      if (name.startsWith(searchKey) && !command.hidden) {
        matches.push(command);
        seenCommands.add(name);
      }
    }

    // Search aliases (add if primary command not already matched)
    for (const [alias, primaryName] of this.aliases) {
      if (alias.startsWith(searchKey) && !seenCommands.has(primaryName)) {
        const command = this.commands.get(primaryName);
        if (command && !command.hidden) {
          matches.push(command);
          seenCommands.add(primaryName);
        }
      }
    }

    // Sort results
    return this.sortCommands(matches, searchKey);
  }

  /**
   * Get all visible commands.
   *
   * @returns Array of all non-hidden command definitions
   */
  all(): CommandDefinition[] {
    const commands: CommandDefinition[] = [];

    for (const command of this.commands.values()) {
      if (!command.hidden) {
        commands.push(command);
      }
    }

    // Sort by category then alphabetically
    return this.sortCommands(commands, "");
  }

  /**
   * Check if a command exists.
   *
   * @param nameOrAlias - Command name or alias to check
   * @returns True if the command exists
   */
  has(nameOrAlias: string): boolean {
    return this.get(nameOrAlias) !== undefined;
  }

  /**
   * Get the number of registered commands.
   *
   * @returns Number of commands (not counting aliases)
   */
  size(): number {
    return this.commands.size;
  }

  /**
   * Clear all registered commands.
   */
  clear(): void {
    this.commands.clear();
    this.aliases.clear();
  }

  /**
   * Sort commands by exact match, category priority, then alphabetically.
   */
  private sortCommands(commands: CommandDefinition[], searchKey: string): CommandDefinition[] {
    // Priority: workflow > skill > builtin > custom (per spec section 5.3)
    const categoryPriority: Record<CommandCategory, number> = {
      workflow: 0,
      skill: 1,
      agent: 2,
      builtin: 3,
      custom: 4,
    };

    return commands.sort((a, b) => {
      // Exact match first
      const aExact = a.name.toLowerCase() === searchKey;
      const bExact = b.name.toLowerCase() === searchKey;
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;

      // Then by category priority
      const aPriority = categoryPriority[a.category];
      const bPriority = categoryPriority[b.category];
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
  }
}

// ============================================================================
// GLOBAL REGISTRY SINGLETON
// ============================================================================

/**
 * Global command registry instance.
 *
 * Use this singleton to register and access commands throughout the application.
 *
 * @example
 * ```typescript
 * import { globalRegistry } from "./registry";
 *
 * // Register a command
 * globalRegistry.register({
 *   name: "mycommand",
 *   description: "My custom command",
 *   category: "custom",
 *   execute: () => ({ success: true }),
 * });
 *
 * // Use in chat UI
 * const command = globalRegistry.get("mycommand");
 * if (command) {
 *   await command.execute("args", context);
 * }
 * ```
 */
export const globalRegistry = new CommandRegistry();
