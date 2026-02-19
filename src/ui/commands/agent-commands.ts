/**
 * Agent Commands for Chat UI
 *
 * Lightweight agent discovery and registration. Agents are discovered from
 * config directories (.claude/agents, .opencode/agents, .github/agents) and
 * registered as @commands. Each SDK's native sub-agent dispatch handles execution.
 *
 * Agents can be defined as:
 * - Project: Defined in .claude/agents, .opencode/agents, .github/agents
 * - User: Defined in ~/.claude/agents, ~/.opencode/agents, ~/.copilot/agents
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";

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
] as const;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Source of an agent definition.
 * - project: Defined in project-local agent directories
 * - user: Defined in user-global agent directories
 */
export type AgentSource = "project" | "user";

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
 * Lightweight agent info — name + description only.
 * SDKs handle tools, model, and prompt natively from their config directories.
 */
export interface AgentInfo {
  /** Unique identifier for the agent (from frontmatter or filename) */
  name: string;
  /** Human-readable description of the agent's purpose */
  description: string;
  /** Source of this agent definition (project or user) */
  source: AgentSource;
  /** Full path to the agent's .md file */
  filePath: string;
}

// ============================================================================
// FRONTMATTER PARSING
// ============================================================================

import { parseMarkdownFrontmatter } from "../../utils/markdown.ts";

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
    return "user";
  }

  // Project-local paths
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
 * Parse lightweight agent info from a discovered file.
 * Only reads name and description from frontmatter — SDKs handle everything else.
 *
 * @param file - Discovered agent file information
 * @returns AgentInfo or null if parsing fails
 */
export function parseAgentInfoLight(file: DiscoveredAgentFile): AgentInfo | null {
  try {
    const content = readFileSync(file.path, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);

    const name = (parsed?.frontmatter?.name as string | undefined) ?? file.filename;
    const description =
      (parsed?.frontmatter?.description as string | undefined) ?? `Agent: ${name}`;

    return {
      name,
      description,
      source: file.source,
      filePath: file.path,
    };
  } catch {
    // Skip files we can't read or parse
    return null;
  }
}

/**
 * Determine if a new agent source should override an existing one.
 *
 * Priority order (highest to lowest):
 * 1. project - Project-local agents (.claude/agents, .opencode/agents, .github/agents)
 * 2. user - User-global agents (~/.claude/agents, ~/.opencode/agents, etc.)
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
    project: 2,
    user: 1,
  };

  return priority[newSource] > priority[existingSource];
}

/**
 * Discover all agents from config directories and return lightweight info.
 *
 * Scans AGENT_DISCOVERY_PATHS (project-local) and GLOBAL_AGENT_PATHS (user-global)
 * for .md files, reads only name + description from frontmatter.
 * Project-local agents take precedence over user-global agents with the same name.
 *
 * @returns Array of AgentInfo objects
 */
export function discoverAgentInfos(): AgentInfo[] {
  const discoveredFiles = discoverAgentFiles();
  const agentMap = new Map<string, AgentInfo>();

  for (const file of discoveredFiles) {
    const info = parseAgentInfoLight(file);
    if (info) {
      const existing = agentMap.get(info.name);
      if (existing) {
        if (shouldAgentOverride(info.source, existing.source)) {
          agentMap.set(info.name, info);
        }
      } else {
        agentMap.set(info.name, info);
      }
    }
  }

  return Array.from(agentMap.values());
}

/**
 * Get a discovered agent by name.
 *
 * @param name - Agent name to look up (case-insensitive)
 * @returns AgentInfo if found, undefined otherwise
 */
export function getDiscoveredAgent(name: string): AgentInfo | undefined {
  const agents = discoverAgentInfos();
  const lowerName = name.toLowerCase();
  return agents.find((agent) => agent.name.toLowerCase() === lowerName);
}

// ============================================================================
// AGENT COMMAND REGISTRATION
// ============================================================================

/**
 * Create a CommandDefinition from an AgentInfo.
 *
 * The execute handler injects a message into the main session,
 * letting the SDK's native sub-agent dispatch handle execution.
 *
 * @param agent - Agent info to convert
 * @returns CommandDefinition for registration
 */
export function createAgentCommand(agent: AgentInfo): CommandDefinition {
  return {
    name: agent.name,
    description: agent.description,
    category: "agent",
    hidden: false,
    argumentHint: "[task]",
    execute: (args: string, context: CommandContext): CommandResult => {
      const task = args.trim() || "Please proceed according to your instructions.";

      // Strongly steer the model to use Task-tool sub-agent dispatch so
      // sub-agent lifecycle events (and tree rendering) are emitted.
      const instruction = `Use the Task tool to invoke the ${agent.name} sub-agent for this exact task: ${task}`;
      context.sendSilentMessage(instruction);

      return { success: true };
    },
  };
}

/**
 * Register all agent commands with the global registry.
 *
 * Discovers agents from config directories and registers them as commands.
 * Project-local agents override user-global agents with the same name.
 *
 * Call this function during application initialization.
 */
export async function registerAgentCommands(): Promise<void> {
  const agents = discoverAgentInfos();

  for (const agent of agents) {
    if (globalRegistry.has(agent.name)) {
      // Only override if discovered agent has higher priority source
      const existing = globalRegistry.get(agent.name);
      if (existing?.category === "agent") {
        globalRegistry.unregister(agent.name);
      } else {
        continue;
      }
    }

    const command = createAgentCommand(agent);
    globalRegistry.register(command);
  }
}
