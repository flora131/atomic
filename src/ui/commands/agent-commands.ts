/**
 * Agent Commands for Chat UI
 *
 * Defines interfaces and utilities for managing sub-agents that can be invoked
 * via slash commands. Agents are specialized prompts with specific tool access
 * and model configurations.
 *
 * Agents can be defined as:
 * - Builtins: Embedded in the codebase (e.g., codebase-analyzer, debugger)
 * - Project: Defined in .claude/agents, .opencode/agents, etc.
 * - User: Defined in ~/.claude/agents, ~/.opencode/agents, etc.
 * - Atomic: Defined in .atomic/agents or ~/.atomic/agents
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Source of an agent definition.
 * - builtin: Embedded in the codebase
 * - project: Defined in project-local agent directories
 * - user: Defined in user-global agent directories
 * - atomic: Defined in .atomic/agents directories
 */
export type AgentSource = "builtin" | "project" | "user" | "atomic";

/**
 * Model options for agent execution.
 * Maps to the underlying SDK's model selection.
 */
export type AgentModel = "sonnet" | "opus" | "haiku";

/**
 * Agent definition interface.
 *
 * Defines a sub-agent that can be invoked via a slash command.
 * Each agent has a specific purpose, tool access, and system prompt.
 *
 * @example
 * ```typescript
 * const analyzerAgent: AgentDefinition = {
 *   name: "codebase-analyzer",
 *   description: "Analyzes codebase implementation details",
 *   tools: ["Glob", "Grep", "Read", "LS", "Bash"],
 *   model: "opus",
 *   prompt: "You are a codebase analysis specialist...",
 *   source: "builtin",
 * };
 * ```
 */
export interface AgentDefinition {
  /**
   * Unique identifier for the agent.
   * Becomes the slash command name (e.g., "codebase-analyzer" -> /codebase-analyzer).
   * Should be lowercase with hyphens for word separation.
   */
  name: string;

  /**
   * Human-readable description of when to use this agent.
   * Displayed in help text and autocomplete suggestions.
   */
  description: string;

  /**
   * List of tools the agent is allowed to use.
   * If omitted, the agent inherits all available tools.
   * Use this to restrict agent capabilities for safety or focus.
   *
   * @example ["Glob", "Grep", "Read", "LS", "Bash"]
   */
  tools?: string[];

  /**
   * Model override for this agent.
   * If omitted, uses the default model from the session.
   * - "sonnet": Balanced performance and cost
   * - "opus": Highest capability, higher cost
   * - "haiku": Fastest, lowest cost
   */
  model?: AgentModel;

  /**
   * System prompt content for the agent.
   * Defines the agent's behavior, expertise, and instructions.
   * Should be comprehensive and specific to the agent's purpose.
   */
  prompt: string;

  /**
   * Source of this agent definition.
   * Used for conflict resolution (project overrides user, etc.).
   */
  source: AgentSource;
}
