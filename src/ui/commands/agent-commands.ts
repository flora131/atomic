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
 * Frontmatter structure parsed from agent markdown files.
 *
 * Different SDKs use slightly different frontmatter formats:
 * - Claude Code: tools as string array, model as "sonnet"|"opus"|"haiku"
 * - OpenCode: tools as Record<string, boolean>, model as "provider/model"
 * - Copilot: tools as string array, model as string
 *
 * This interface supports all formats for normalization into AgentDefinition.
 *
 * @example Claude Code format:
 * ```yaml
 * ---
 * name: codebase-analyzer
 * description: Analyzes code
 * tools:
 *   - Glob
 *   - Grep
 * model: opus
 * ---
 * ```
 *
 * @example OpenCode format:
 * ```yaml
 * ---
 * name: codebase-analyzer
 * description: Analyzes code
 * tools:
 *   glob: true
 *   grep: true
 *   write: false
 * model: anthropic/claude-3-opus
 * mode: subagent
 * ---
 * ```
 */
export interface AgentFrontmatter {
  /**
   * Agent name.
   * - Claude: Explicit name field
   * - OpenCode: Derived from filename if not specified
   * - Copilot: Explicit name field
   */
  name?: string;

  /**
   * Human-readable description of the agent's purpose.
   * Required by all SDKs.
   */
  description: string;

  /**
   * Tools the agent can use.
   * - Claude: string[] - array of tool names
   * - OpenCode: Record<string, boolean> - tool names as keys, enabled/disabled as values
   * - Copilot: string[] - array of tool names
   */
  tools?: string[] | Record<string, boolean>;

  /**
   * Model to use for the agent.
   * - Claude: "sonnet" | "opus" | "haiku"
   * - OpenCode: "provider/model" format (e.g., "anthropic/claude-3-sonnet")
   * - Copilot: string model identifier
   */
  model?: string;

  /**
   * OpenCode-specific: Agent mode.
   * - "subagent": Runs as a sub-agent (default for discovered agents)
   * - "primary": Runs as the primary agent
   * Only used by OpenCode SDK; ignored by other SDKs.
   */
  mode?: "subagent" | "primary";
}

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
