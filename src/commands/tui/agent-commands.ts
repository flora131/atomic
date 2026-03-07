/**
 * Agent Commands for Chat UI
 *
 * Lightweight agent discovery and registration. Agents are discovered from
 * config directories (.claude/agents, .opencode/agents, .github/agents) and
 * registered as @commands. Each SDK's native sub-agent dispatch handles execution.
 *
 * Agents can be defined as:
 * - Project: Defined in .claude/agents, .opencode/agents, .github/agents
 * - User: Defined in ~/.claude/agents, ~/.opencode/agents, ~/.copilot/agents,
 *   and platform canonical config-home roots for OpenCode/Copilot
 * - Atomic global: Defined in ~/.atomic/.claude/agents, ~/.atomic/.opencode/agents,
 *   ~/.atomic/.copilot/agents
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "@/commands/tui/registry.ts";
import { globalRegistry } from "@/commands/tui/registry.ts";
import {
  getCompatibleDiscoveryRoots,
  resolveDefaultConfigHome,
  type ProviderCompatibilitySelection,
  type ProviderDiscoveryPlan,
} from "@/services/config/provider-discovery-plan.ts";
import {
  collectDefinitionDiscoveryMatches,
  createAllProviderDiscoveryPlans,
  filterDefinitionMatchesByRuntimeCompatibility,
  getCommandIdentifierPatternDescription,
  getRuntimeCompatibilitySelection,
  isValidCommandIdentifier,
  validateDefinitionCompatibility,
  type DefinitionDiscoveryMatch,
} from "@/commands/tui/definition-integrity.ts";
import {
  emitDiscoveryEvent,
  isDiscoveryDebugLoggingEnabled,
} from "@/services/config/discovery-events.ts";

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

const HOME = homedir();
const USER_CONFIG_HOME = resolveDefaultConfigHome({
  homeDir: HOME,
  xdgConfigHome: process.env.XDG_CONFIG_HOME ?? undefined,
  appDataDir: process.env.APPDATA ?? undefined,
  platform: process.platform,
});
const USER_DISCOVERY_ROOTS = [
  HOME,
  USER_CONFIG_HOME,
  join(HOME, ".atomic"),
];

/**
 * User-global directories to search for agent definition files.
 * These paths use ~ to represent the user's home directory.
 * Project-local agents take precedence over user-global agents.
 */
export const GLOBAL_AGENT_PATHS = [
  "~/.claude/agents",
  "~/.opencode/agents",
  "~/.copilot/agents",
  join(USER_CONFIG_HOME, ".opencode", "agents"),
  join(USER_CONFIG_HOME, ".copilot", "agents"),
  "~/.atomic/.claude/agents",
  "~/.atomic/.opencode/agents",
  "~/.atomic/.copilot/agents",
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

interface AgentParseResult {
  info: AgentInfo | null;
  issues: readonly string[];
}

export interface AgentDefinitionIntegrityResult {
  valid: boolean;
  issues: readonly string[];
  discoveryMatches: readonly DefinitionDiscoveryMatch[];
}

interface AgentFileDiscoveryOptions {
  searchPaths?: readonly string[];
}

function buildRuntimeDiscoveryPlanOptions(): {
  projectRoot: string;
  homeDir?: string;
  xdgConfigHome?: string;
  appDataDir?: string;
  platform: NodeJS.Platform;
} {
  const discoveryPlanOptions: {
    projectRoot: string;
    homeDir?: string;
    xdgConfigHome?: string;
    appDataDir?: string;
    platform: NodeJS.Platform;
  } = {
    projectRoot: process.cwd(),
    platform: process.platform,
  };

  if (process.env.HOME) {
    discoveryPlanOptions.homeDir = process.env.HOME;
  }
  if (process.env.XDG_CONFIG_HOME) {
    discoveryPlanOptions.xdgConfigHome = process.env.XDG_CONFIG_HOME;
  }
  if (process.env.APPDATA) {
    discoveryPlanOptions.appDataDir = process.env.APPDATA;
  }

  return discoveryPlanOptions;
}

// ============================================================================
// FRONTMATTER PARSING
// ============================================================================

import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";

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

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

/**
 * Determine agent source based on discovery path.
 *
 * @param discoveryPath - The path where the agent was discovered
 * @returns AgentSource type for conflict resolution
 */
export function determineAgentSource(discoveryPath: string): AgentSource {
  if (discoveryPath.startsWith("~")) {
    return "user";
  }

  const resolvedPath = resolve(discoveryPath);
  if (isPathWithinRoot(process.cwd(), resolvedPath)) {
    return "project";
  }

  if (USER_DISCOVERY_ROOTS.some((rootPath) =>
    isPathWithinRoot(rootPath, resolvedPath)
  )) {
    return "user";
  }

  return "project";
}

export function getRuntimeCompatibleAgentDiscoveryPaths(
  discoveryPlans: readonly ProviderDiscoveryPlan[]
): string[] {
  return collectAgentDiscoveryPaths(
    discoveryPlans,
    getRuntimeCompatibilitySelection,
  );
}

function collectAgentDiscoveryPaths(
  discoveryPlans: readonly ProviderDiscoveryPlan[],
  compatibilityResolver: (
    plan: ProviderDiscoveryPlan,
  ) => ProviderCompatibilitySelection,
): string[] {
  const searchPaths: string[] = [];
  const seen = new Set<string>();

  for (const plan of discoveryPlans) {
    const compatibilitySelection = compatibilityResolver(plan);
    const rootsByDescendingPrecedence = [...getCompatibleDiscoveryRoots(
      plan,
      compatibilitySelection,
    )].reverse();
    for (const root of rootsByDescendingPrecedence) {
      const agentPath = resolve(join(root.resolvedPath, "agents"));
      if (seen.has(agentPath)) {
        continue;
      }

      seen.add(agentPath);
      searchPaths.push(agentPath);
    }
  }

  return searchPaths;
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
  return discoverAgentFilesWithOptions();
}

function discoverAgentFilesWithOptions(
  options: AgentFileDiscoveryOptions = {}
): DiscoveredAgentFile[] {
  const discovered: DiscoveredAgentFile[] = [];
  const searchPaths = options.searchPaths;

  if (searchPaths && searchPaths.length > 0) {
    for (const searchPath of searchPaths) {
      const source = determineAgentSource(searchPath);
      const files = discoverAgentFilesInPath(searchPath, source);
      discovered.push(...files);
    }

    return discovered;
  }

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

function warnSkippedAgentDefinition(
  filePath: string,
  issues: readonly string[],
  options: {
    discoveryMatches?: readonly DefinitionDiscoveryMatch[];
    activeDiscoveryPlans?: readonly ProviderDiscoveryPlan[];
    reason: string;
  },
): void {
  if (issues.length === 0) {
    return;
  }

  const providerTags = new Set(
    (options.activeDiscoveryPlans ?? []).map((plan) => plan.provider),
  );

  if (providerTags.size === 0) {
    for (const match of options.discoveryMatches ?? []) {
      providerTags.add(match.provider);
    }
  }

  for (const provider of providerTags) {
    const providerMatch = options.discoveryMatches?.find(
      (match) => match.provider === provider,
    );
    emitDiscoveryEvent("discovery.definition.skipped", {
      level: "warn",
      tags: {
        provider,
        path: resolve(filePath),
        rootId: providerMatch?.rootId,
        rootTier: providerMatch?.tier,
        rootCompatibility: providerMatch?.compatibility,
      },
      data: {
        kind: "agent",
        reason: options.reason,
        issueCount: issues.length,
        issues,
      },
    });
  }

  if (isDiscoveryDebugLoggingEnabled()) {
    console.warn(
      `[agent-commands] Skipping agent definition at ${filePath}: ${issues.join(" ")}`
    );
  }
}

function emitAgentCompatibilityFilteredEvent(
  filePath: string,
  discoveryMatches: readonly DefinitionDiscoveryMatch[],
  runtimeCompatibleMatches: readonly DefinitionDiscoveryMatch[],
  activeDiscoveryPlans: readonly ProviderDiscoveryPlan[],
): void {
  const runtimeCompatibleMatchKeys = new Set(
    runtimeCompatibleMatches.map(
      (match) => `${match.provider}:${match.rootId}:${match.rootPath}`,
    ),
  );

  for (const activePlan of activeDiscoveryPlans) {
    const providerMatches = discoveryMatches.filter(
      (match) => match.provider === activePlan.provider,
    );
    const providerFilteredMatches = providerMatches.filter(
      (match) =>
        !runtimeCompatibleMatchKeys.has(
          `${match.provider}:${match.rootId}:${match.rootPath}`,
        ),
    );
    const pathContextMatch = providerFilteredMatches[0] ?? providerMatches[0];

    emitDiscoveryEvent("discovery.compatibility.filtered", {
      level: "warn",
      tags: {
        provider: activePlan.provider,
        path: resolve(filePath),
        rootId: pathContextMatch?.rootId,
        rootTier: pathContextMatch?.tier,
        rootCompatibility: pathContextMatch?.compatibility,
      },
      data: {
        kind: "agent",
        runtimeCompatibilitySelection: getRuntimeCompatibilitySelection(activePlan),
        providerMatchCount: providerMatches.length,
        filteredMatchCount: providerFilteredMatches.length,
      },
    });
  }
}

export function validateAgentInfoIntegrity(
  agent: AgentInfo,
  options: {
    discoveryPlans?: readonly ProviderDiscoveryPlan[];
  } = {}
): AgentDefinitionIntegrityResult {
  const issues: string[] = [];
  const plans = options.discoveryPlans ?? createAllProviderDiscoveryPlans();

  if (!agent.filePath.endsWith(".md")) {
    issues.push(
      `Agent file must be a markdown file ending in .md, received: ${agent.filePath}`
    );
  }

  if (!isValidCommandIdentifier(agent.name)) {
    issues.push(
      `Invalid agent name "${agent.name}". Use ${getCommandIdentifierPatternDescription()}.`
    );
  }

  if (agent.description.trim().length === 0) {
    issues.push(`Agent "${agent.name}" must include a non-empty description.`);
  }

  const compatibilityValidation = validateDefinitionCompatibility(
    agent.filePath,
    "agent",
    plans
  );
  issues.push(...compatibilityValidation.issues);

  return {
    valid: issues.length === 0,
    issues,
    discoveryMatches: compatibilityValidation.matches,
  };
}

function parseAgentInfoWithIssues(file: DiscoveredAgentFile): AgentParseResult {
  const issues: string[] = [];

  try {
    const content = readFileSync(file.path, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);

    if (content.trimStart().startsWith("---") && !parsed) {
      return {
        info: null,
        issues: [
          "Invalid markdown frontmatter block. Ensure the agent file uses a valid '---' header and closing delimiter.",
        ],
      };
    }

    const body = parsed ? parsed.body : content;
    if (body.trim().length === 0) {
      return {
        info: null,
        issues: [
          "Agent instructions are empty. Add prompt content below the frontmatter block.",
        ],
      };
    }

    const frontmatter = parsed?.frontmatter;
    let name = file.filename.trim();
    if (frontmatter && "name" in frontmatter) {
      if (
        typeof frontmatter.name !== "string" ||
        frontmatter.name.trim().length === 0
      ) {
        issues.push("frontmatter.name must be a non-empty string when provided.");
      } else {
        name = frontmatter.name.trim();
      }
    }

    if (name.length === 0) {
      issues.push(
        "Agent name resolved to an empty value. Provide frontmatter.name or a non-empty filename."
      );
    }

    let description = `Agent: ${name}`;
    if (frontmatter && "description" in frontmatter) {
      if (
        typeof frontmatter.description !== "string" ||
        frontmatter.description.trim().length === 0
      ) {
        issues.push(
          "frontmatter.description must be a non-empty string when provided."
        );
      } else {
        description = frontmatter.description.trim();
      }
    }

    if (issues.length > 0) {
      return {
        info: null,
        issues,
      };
    }

    return {
      info: {
        name,
        description,
        source: file.source,
        filePath: file.path,
      },
      issues: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      info: null,
      issues: [`Unable to read agent definition: ${message}`],
    };
  }
}

/**
 * Parse lightweight agent info from a discovered file.
 * Only reads name and description from frontmatter — SDKs handle everything else.
 *
 * @param file - Discovered agent file information
 * @returns AgentInfo or null if parsing fails
 */
export function parseAgentInfoLight(file: DiscoveredAgentFile): AgentInfo | null {
  return parseAgentInfoWithIssues(file).info;
}

/**
 * Determine if a new agent source should override an existing one.
 *
 * Priority order (highest to lowest):
 * 1. project - Project-local agents (.claude/agents, .opencode/agents, .github/agents)
 * 2. user - User-global agents (~/.claude/agents, ~/.config/.opencode/agents, etc.)
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
export function discoverAgentInfos(
  options: {
    discoveryPlans?: readonly ProviderDiscoveryPlan[];
  } = {}
): AgentInfo[] {
  const allDiscoveryPlans = createAllProviderDiscoveryPlans(
    buildRuntimeDiscoveryPlanOptions(),
  );
  const activeDiscoveryPlans = options.discoveryPlans ?? allDiscoveryPlans;
  const activeRuntimeProviders = activeDiscoveryPlans
    .map((plan) => plan.provider)
    .join(", ");
  const runtimeCompatibleSearchPaths = getRuntimeCompatibleAgentDiscoveryPaths(
    activeDiscoveryPlans,
  );
  const crossProviderProjectSearchPaths = AGENT_DISCOVERY_PATHS.map((searchPath) =>
    resolve(searchPath),
  );
  const runtimeCompatiblePathSet = new Set(runtimeCompatibleSearchPaths);
  const discoverySearchPaths = [
    ...runtimeCompatibleSearchPaths,
    ...crossProviderProjectSearchPaths.filter((searchPath) =>
      !runtimeCompatiblePathSet.has(searchPath)
    ),
  ];
  const discoveredFiles = discoverAgentFilesWithOptions({
    searchPaths:
      discoverySearchPaths.length > 0
        ? discoverySearchPaths
        : undefined,
  });
  const agentMap = new Map<string, AgentInfo>();

  for (const file of discoveredFiles) {
    const parsed = parseAgentInfoWithIssues(file);
    if (!parsed.info) {
      warnSkippedAgentDefinition(file.path, parsed.issues, {
        reason: "parse_failed",
        discoveryMatches: collectDefinitionDiscoveryMatches(
          file.path,
          "agent",
          allDiscoveryPlans,
        ),
        activeDiscoveryPlans,
      });
      continue;
    }

    const integrity = validateAgentInfoIntegrity(parsed.info, {
      discoveryPlans: allDiscoveryPlans,
    });
    if (!integrity.valid) {
      warnSkippedAgentDefinition(file.path, integrity.issues, {
        reason: "integrity_validation_failed",
        discoveryMatches: integrity.discoveryMatches,
        activeDiscoveryPlans,
      });
      continue;
    }

    const runtimeCompatibleMatches = filterDefinitionMatchesByRuntimeCompatibility(
      integrity.discoveryMatches,
      activeDiscoveryPlans,
    );
    if (runtimeCompatibleMatches.length === 0) {
      emitAgentCompatibilityFilteredEvent(
        file.path,
        integrity.discoveryMatches,
        runtimeCompatibleMatches,
        activeDiscoveryPlans,
      );
      warnSkippedAgentDefinition(
        file.path,
        [
          `Definition is not compatible with active provider runtime(s): ${activeRuntimeProviders}.`,
        ],
        {
          reason: "runtime_incompatible",
          discoveryMatches: integrity.discoveryMatches,
          activeDiscoveryPlans,
        },
      );
      continue;
    }

    const info = parsed.info;
    const existing = agentMap.get(info.name);
    if (existing) {
      if (shouldAgentOverride(info.source, existing.source)) {
        agentMap.set(info.name, info);
      }
    } else {
      agentMap.set(info.name, info);
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

      if (context.agentType === "opencode") {
        // OpenCode uses the parent session's task tool and follow-up reply.
        // Keep this on the normal foreground stream so the parent task row
        // and assistant continuation render like upstream OpenCode.
        context.sendSilentMessage(task, { agent: agent.name });
      } else if (context.agentType === "claude") {
        // Claude path: use natural-language delegation and also pass the
        // selected agent through structured query options.
        const instruction = `Invoke the "${agent.name}" sub-agent with the following task:\n${task}`;
        context.sendSilentMessage(instruction, {
          agent: agent.name,
        });
      } else {
        // Copilot SDK uses the Task tool for sub-agent dispatch.
        // Strongly steer the model to use Task-tool sub-agent dispatch so
        // sub-agent lifecycle events (and tree rendering) are emitted.
        // NOTE: Do NOT set isAgentOnlyStream here — these SDKs fire normal
        // stream completion callbacks (handleStreamComplete). Setting it
        // would trigger the premature agent-only finalizer, stopping the
        // spinner while the main agent is still streaming its summary.
        const instruction = `Use the Task tool to invoke the ${agent.name} sub-agent for this exact task: ${task}\n\nAfter the sub-agent completes, provide a concise summary of the outcome to the user.`;
        context.sendSilentMessage(instruction);
      }

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
export async function registerAgentCommands(
  providerDiscoveryPlan?: ProviderDiscoveryPlan,
): Promise<void> {
  const activeDiscoveryPlans = providerDiscoveryPlan
    ? [providerDiscoveryPlan]
    : createAllProviderDiscoveryPlans();
  const agents = discoverAgentInfos({
    discoveryPlans: activeDiscoveryPlans,
  });

  for (const agent of agents) {
    let existingAgentCommand: CommandDefinition | undefined;

    if (globalRegistry.has(agent.name)) {
      // Only override if discovered agent has higher priority source
      const existing = globalRegistry.get(agent.name);
      if (existing?.category === "agent") {
        existingAgentCommand = existing;
        globalRegistry.unregister(agent.name);
      } else {
        continue;
      }
    }

    const command = createAgentCommand(agent);
    try {
      globalRegistry.register(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnSkippedAgentDefinition(
        agent.filePath,
        [`Command registration failed: ${message}`],
        {
          reason: "command_registration_failed",
          discoveryMatches: collectDefinitionDiscoveryMatches(
            agent.filePath,
            "agent",
            activeDiscoveryPlans,
          ),
          activeDiscoveryPlans,
        },
      );
      if (existingAgentCommand) {
        try {
          globalRegistry.register(existingAgentCommand);
        } catch {
          // Best effort recovery only.
        }
      }
    }
  }
}
