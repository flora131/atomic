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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Project-local directories to search for agent definition files.
 * These paths are relative to the project root.
 * Files in these directories override user-global agents with the same name.
 */
export const AGENT_DISCOVERY_PATHS = [
  ".claude/agents",
  ".opencode/agents",
  ".github/agents",
  ".atomic/agents",
] as const;

/**
 * User-global directories to search for agent definition files.
 * These paths use ~ to represent the user's home directory.
 * Project-local agents take precedence over user-global agents.
 */
export const GLOBAL_AGENT_PATHS = [
  "~/.claude/agents",
  "~/.opencode/agents",
  "~/.copilot/agents",
  "~/.atomic/agents",
] as const;

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
 * Discovered agent file with path and source information.
 */
export interface DiscoveredAgentFile {
  /** Full path to the agent markdown file */
  path: string;
  /** Source type for conflict resolution */
  source: AgentSource;
  /** Filename without extension (used as fallback name) */
  filename: string;
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

// ============================================================================
// BUILTIN AGENTS
// ============================================================================

/**
 * Built-in agent definitions.
 *
 * These agents are always available and provide core functionality.
 * They can be overridden by project-local or user-global agents with the same name.
 */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: "codebase-analyzer",
    description:
      "Analyzes codebase implementation details. Call when you need to find detailed information about specific components.",
    tools: ["Glob", "Grep", "NotebookRead", "Read", "LS", "Bash"],
    model: "opus",
    prompt: `You are a codebase analysis specialist. Your role is to analyze and explain code implementation details with precision and depth.

## Your Capabilities

You have access to the following tools:
- **Glob**: Find files by pattern (e.g., "**/*.ts", "src/components/**/*.tsx")
- **Grep**: Search for text patterns in files
- **NotebookRead**: Read Jupyter notebook files
- **Read**: Read file contents
- **LS**: List directory contents
- **Bash**: Execute shell commands for additional analysis

## Analysis Process

When analyzing code, follow this systematic approach:

### 1. Understand the Request
- Clarify what specific aspect of the code the user wants analyzed
- Identify the scope: single file, module, or entire codebase

### 2. Gather Context
- Use Glob to find relevant files
- Use Grep to search for related code patterns
- Read the main files involved

### 3. Analyze Structure
- Identify the main components and their responsibilities
- Map out the module/class hierarchy
- Document public interfaces and APIs

### 4. Trace Data Flow
- Follow data from input to output
- Identify transformations and side effects
- Note state management patterns

### 5. Identify Patterns
- Recognize design patterns in use (Factory, Observer, Strategy, etc.)
- Note architectural patterns (MVC, MVVM, Clean Architecture, etc.)
- Highlight any anti-patterns or code smells

### 6. Document Dependencies
- List external dependencies and their purposes
- Identify internal module dependencies
- Note circular dependencies if any

### 7. Provide Insights
- Summarize how the code works
- Highlight key algorithms and their complexity
- Suggest potential improvements if relevant

## Output Format

Structure your analysis clearly:

1. **Overview**: Brief summary of what the code does
2. **Architecture**: High-level structure and organization
3. **Key Components**: Detailed breakdown of important parts
4. **Data Flow**: How data moves through the system
5. **Dependencies**: External and internal dependencies
6. **Patterns**: Design patterns and conventions used
7. **Notable Details**: Any interesting or important observations

## Guidelines

- Be thorough but concise
- Use code references with file:line format (e.g., src/utils/parser.ts:42)
- Explain technical concepts when they might not be obvious
- Focus on the "why" behind implementation choices, not just the "what"
- If you find issues or potential improvements, note them objectively`,
    source: "builtin",
  },
];

/**
 * Get a builtin agent by name.
 *
 * @param name - Agent name to look up
 * @returns AgentDefinition if found, undefined otherwise
 */
export function getBuiltinAgent(name: string): AgentDefinition | undefined {
  const lowerName = name.toLowerCase();
  return BUILTIN_AGENTS.find(
    (agent) => agent.name.toLowerCase() === lowerName
  );
}

// ============================================================================
// FRONTMATTER PARSING
// ============================================================================

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Extracts the frontmatter section (between --- delimiters) and the
 * body content (everything after the frontmatter).
 *
 * @param content - Raw markdown file content
 * @returns Parsed frontmatter and body, or null if invalid format
 */
export function parseMarkdownFrontmatter(
  content: string
): { frontmatter: Record<string, unknown>; body: string } | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const yamlContent = match[1] ?? "";
  const body = match[2] ?? "";

  // Parse simple YAML (key: value pairs, arrays, and objects)
  const frontmatter: Record<string, unknown> = {};

  const lines = yamlContent.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      i++;
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    // Check if this is an array or object (value is empty and next lines are indented)
    if (!value && i + 1 < lines.length) {
      const nextLine = lines[i + 1]!;
      const isArrayItem = nextLine.match(/^\s+- /);
      const isObjectItem = nextLine.match(/^\s+\w+:/);

      if (isArrayItem) {
        // Parse array
        const arr: string[] = [];
        i++;
        while (i < lines.length) {
          const arrLine = lines[i]!;
          const arrMatch = arrLine.match(/^\s+- (.+)$/);
          if (arrMatch) {
            arr.push(arrMatch[1]!.trim());
            i++;
          } else if (arrLine.trim() === "" || !arrLine.startsWith(" ")) {
            break;
          } else {
            i++;
          }
        }
        frontmatter[key] = arr;
        continue;
      } else if (isObjectItem) {
        // Parse object (for OpenCode tools format)
        const obj: Record<string, boolean> = {};
        i++;
        while (i < lines.length) {
          const objLine = lines[i]!;
          const objMatch = objLine.match(/^\s+(\w+):\s*(true|false)$/);
          if (objMatch) {
            obj[objMatch[1]!] = objMatch[2] === "true";
            i++;
          } else if (objLine.trim() === "" || !objLine.startsWith(" ")) {
            break;
          } else {
            i++;
          }
        }
        frontmatter[key] = obj;
        continue;
      }
    }

    // Simple string/number value
    if (value) {
      // Try to parse as boolean
      if (value === "true") {
        frontmatter[key] = true;
      } else if (value === "false") {
        frontmatter[key] = false;
      } else {
        // Try to parse as number
        const numValue = Number(value);
        frontmatter[key] = Number.isNaN(numValue) ? value : numValue;
      }
    }

    i++;
  }

  return { frontmatter, body };
}

/**
 * Normalize model string to AgentModel type.
 *
 * Handles different SDK model formats:
 * - Claude: "sonnet", "opus", "haiku"
 * - OpenCode: "anthropic/claude-3-sonnet", "anthropic/claude-3-opus", etc.
 * - Copilot: Various model strings
 *
 * @param model - Raw model string from frontmatter
 * @returns Normalized AgentModel or undefined if not mappable
 */
export function normalizeModel(model: string | undefined): AgentModel | undefined {
  if (!model) {
    return undefined;
  }

  const lowerModel = model.toLowerCase();

  // Direct matches
  if (lowerModel === "sonnet" || lowerModel === "opus" || lowerModel === "haiku") {
    return lowerModel;
  }

  // OpenCode format: "provider/model-name"
  if (lowerModel.includes("sonnet")) {
    return "sonnet";
  }
  if (lowerModel.includes("opus")) {
    return "opus";
  }
  if (lowerModel.includes("haiku")) {
    return "haiku";
  }

  // Default to sonnet for unknown models
  return undefined;
}

/**
 * Normalize tools from different SDK formats to string array.
 *
 * - Claude/Copilot: string[] → pass through
 * - OpenCode: Record<string, boolean> → extract enabled tool names
 *
 * @param tools - Tools in either array or object format
 * @returns Normalized string array of tool names
 */
export function normalizeTools(
  tools: string[] | Record<string, boolean> | undefined
): string[] | undefined {
  if (!tools) {
    return undefined;
  }

  if (Array.isArray(tools)) {
    return tools;
  }

  // OpenCode format: { toolName: true/false }
  // Only include tools that are enabled (true)
  return Object.entries(tools)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

/**
 * Parse agent frontmatter and normalize to AgentDefinition.
 *
 * Handles different SDK frontmatter formats (Claude, OpenCode, Copilot)
 * and normalizes them into a consistent AgentDefinition structure.
 *
 * @param frontmatter - Parsed frontmatter object
 * @param body - Markdown body content (becomes the prompt)
 * @param source - Source type for this agent
 * @param filename - Filename without extension (fallback for name)
 * @returns Normalized AgentDefinition
 */
export function parseAgentFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
  source: AgentSource,
  filename: string
): AgentDefinition {
  // Extract name: use frontmatter.name or derive from filename
  const name = (frontmatter.name as string | undefined) || filename;

  // Extract description: required field
  const description =
    (frontmatter.description as string | undefined) || `Agent: ${name}`;

  // Normalize tools from Claude array or OpenCode object format
  const rawTools = frontmatter.tools as
    | string[]
    | Record<string, boolean>
    | undefined;
  const tools = normalizeTools(rawTools);

  // Normalize model from various SDK formats
  const rawModel = frontmatter.model as string | undefined;
  const model = normalizeModel(rawModel);

  // Use the body content as the system prompt
  const prompt = body.trim();

  return {
    name,
    description,
    tools,
    model,
    prompt,
    source,
  };
}

// ============================================================================
// AGENT DISCOVERY
// ============================================================================

/**
 * Expand tilde (~) in path to home directory.
 *
 * @param path - Path that may contain ~
 * @returns Expanded path with ~ replaced by home directory
 */
export function expandTildePath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

/**
 * Determine agent source based on discovery path.
 *
 * @param discoveryPath - The path where the agent was discovered
 * @returns AgentSource type for conflict resolution
 */
export function determineAgentSource(discoveryPath: string): AgentSource {
  // Check if path is in global (user) location
  if (discoveryPath.startsWith("~") || discoveryPath.includes(homedir())) {
    // Global user paths
    if (discoveryPath.includes(".atomic")) {
      return "atomic";
    }
    return "user";
  }

  // Project-local paths
  if (discoveryPath.includes(".atomic")) {
    return "atomic";
  }
  return "project";
}

/**
 * Discover agent files from a single directory path.
 *
 * @param searchPath - Directory path to search (may contain ~)
 * @param source - Source type to assign to discovered agents
 * @returns Array of discovered agent file information
 */
export function discoverAgentFilesInPath(
  searchPath: string,
  source: AgentSource
): DiscoveredAgentFile[] {
  const discovered: DiscoveredAgentFile[] = [];
  const expandedPath = expandTildePath(searchPath);

  if (!existsSync(expandedPath)) {
    return discovered;
  }

  try {
    const files = readdirSync(expandedPath);
    for (const file of files) {
      if (file.endsWith(".md")) {
        const filename = basename(file, ".md");
        discovered.push({
          path: join(expandedPath, file),
          source,
          filename,
        });
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return discovered;
}

/**
 * Discover agent files from all configured search paths.
 *
 * Searches both project-local and user-global agent directories.
 * Returns files with their source information for priority resolution.
 *
 * @returns Array of discovered agent files
 */
export function discoverAgentFiles(): DiscoveredAgentFile[] {
  const discovered: DiscoveredAgentFile[] = [];

  // First, discover from project-local paths (higher priority)
  for (const searchPath of AGENT_DISCOVERY_PATHS) {
    const source = determineAgentSource(searchPath);
    const files = discoverAgentFilesInPath(searchPath, source);
    discovered.push(...files);
  }

  // Then, discover from user-global paths (lower priority)
  for (const searchPath of GLOBAL_AGENT_PATHS) {
    const source = determineAgentSource(searchPath);
    const files = discoverAgentFilesInPath(searchPath, source);
    discovered.push(...files);
  }

  return discovered;
}

/**
 * Parse a single agent file into an AgentDefinition.
 *
 * @param file - Discovered agent file information
 * @returns AgentDefinition or null if parsing fails
 */
export function parseAgentFile(file: DiscoveredAgentFile): AgentDefinition | null {
  try {
    const content = readFileSync(file.path, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);

    if (!parsed) {
      // No frontmatter, treat entire content as prompt with default values
      return {
        name: file.filename,
        description: `Agent: ${file.filename}`,
        prompt: content.trim(),
        source: file.source,
      };
    }

    return parseAgentFrontmatter(
      parsed.frontmatter,
      parsed.body,
      file.source,
      file.filename
    );
  } catch {
    // Skip files we can't read or parse
    return null;
  }
}

/**
 * Discover and parse all agent definitions from disk.
 *
 * Scans AGENT_DISCOVERY_PATHS (project-local) and GLOBAL_AGENT_PATHS (user-global)
 * for .md files, parses their frontmatter and content, and returns normalized
 * AgentDefinition objects.
 *
 * Project-local agents take precedence over user-global agents with the same name.
 *
 * @returns Promise resolving to array of AgentDefinition objects
 */
export async function discoverAgents(): Promise<AgentDefinition[]> {
  const discoveredFiles = discoverAgentFiles();
  const agentMap = new Map<string, AgentDefinition>();

  for (const file of discoveredFiles) {
    const agent = parseAgentFile(file);
    if (agent) {
      // Check for existing agent with same name
      const existing = agentMap.get(agent.name);
      if (existing) {
        // Project-local agents override user-global agents
        // Priority: project > atomic > user
        const shouldOverride = shouldAgentOverride(agent.source, existing.source);
        if (shouldOverride) {
          agentMap.set(agent.name, agent);
        }
      } else {
        agentMap.set(agent.name, agent);
      }
    }
  }

  return Array.from(agentMap.values());
}

/**
 * Determine if a new agent source should override an existing one.
 *
 * Priority order (highest to lowest):
 * 1. project - Project-local agents (.claude/agents, .opencode/agents, .github/agents)
 * 2. atomic - Atomic-specific agents (.atomic/agents)
 * 3. user - User-global agents (~/.claude/agents, ~/.opencode/agents, etc.)
 * 4. builtin - Built-in agents (always lowest priority for discovery)
 *
 * @param newSource - Source of the new agent
 * @param existingSource - Source of the existing agent
 * @returns True if new agent should override existing
 */
export function shouldAgentOverride(
  newSource: AgentSource,
  existingSource: AgentSource
): boolean {
  const priority: Record<AgentSource, number> = {
    project: 4,
    atomic: 3,
    user: 2,
    builtin: 1,
  };

  return priority[newSource] > priority[existingSource];
}
