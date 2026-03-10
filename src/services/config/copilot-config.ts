import defaultFs from "fs/promises";
import path from "path";
import os from "os";
import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";
import type { McpServerConfig } from "@/services/agents/types.ts";
import {
  buildProviderDiscoveryPlan,
  type ProviderDiscoveryPlan,
} from "@/services/config/provider-discovery-plan.ts";
import { assertPathWithinRoot } from "@/lib/path-root-guard.ts";
import {
  getProviderDiscoverySessionCacheValue,
  getStartupProviderDiscoveryPlan,
  registerProviderDiscoveryCacheInvalidator,
  setProviderDiscoverySessionCacheValue,
} from "@/services/config/provider-discovery-cache.ts";
import {
  defaultAgentDefinitionFsOps,
  type AgentDefinitionFsOps,
} from "@/services/config/agent-definition-loader.ts";

/**
 * Represents a Copilot agent configuration parsed from manual format.
 */
export interface CopilotAgent {
  name: string;
  description: string;
  displayName?: string;
  tools?: string[] | null;
  mcpServers?: McpServerConfig[];
  infer?: boolean;
  systemPrompt: string;
  source: "local" | "global";
}

/**
 * File system operations interface for dependency injection.
 * Allows testing with mock implementations.
 */
export type FsOps = AgentDefinitionFsOps;

export interface CopilotPathResolutionOptions {
  pathExistsFn?: (candidatePath: string) => Promise<boolean>;
  xdgConfigHome?: string | null;
  providerDiscoveryPlan?: ProviderDiscoveryPlan;
}

/** Default fs operations using Node.js fs/promises */
export const defaultFsOps: FsOps = {
  ...defaultAgentDefinitionFsOps,
};

function parseCopilotTools(value: unknown): string[] | null | undefined {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    const parsed = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parsed.length > 0 ? parsed : undefined;
  }

  if (typeof value === "string") {
    const parsed = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parsed.length > 0 ? parsed : undefined;
  }

  return undefined;
}

function parseStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value);
  if (
    entries.some(
      ([key, entryValue]) => key.length === 0 || typeof entryValue !== "string",
    )
  ) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function parseCopilotAgentMcpServers(value: unknown): McpServerConfig[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const servers: McpServerConfig[] = [];
  for (const [name, rawConfig] of Object.entries(value)) {
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      continue;
    }

    const config = rawConfig as Record<string, unknown>;
    const rawType = config.type;
    const normalizedType =
      rawType === "local"
        ? "stdio"
        : rawType === "remote"
          ? "http"
          : rawType === "stdio" || rawType === "http" || rawType === "sse"
            ? rawType
            : undefined;

    servers.push({
      name,
      type: normalizedType,
      command:
        typeof config.command === "string" ? config.command : undefined,
      args: Array.isArray(config.args)
        ? config.args.filter((arg): arg is string => typeof arg === "string")
        : undefined,
      env: parseStringRecord(config.env),
      url: typeof config.url === "string" ? config.url : undefined,
      headers: parseStringRecord(config.headers),
      cwd: typeof config.cwd === "string" ? config.cwd : undefined,
      timeout: typeof config.timeout === "number" ? config.timeout : undefined,
      enabled:
        typeof config.enabled === "boolean" ? config.enabled : undefined,
      tools: Array.isArray(config.tools)
        ? config.tools.filter((tool): tool is string => typeof tool === "string")
        : undefined,
    });
  }

  return servers.length > 0 ? servers : undefined;
}

function dedupeDirectoryEntries(
  entries: Array<{ dir: string; source: "global" | "local" }>,
): Array<{ dir: string; source: "global" | "local" }> {
  const deduped: Array<{ dir: string; source: "global" | "local" }> = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const normalizedDir = path.resolve(entry.dir);
    if (seen.has(normalizedDir)) {
      continue;
    }

    seen.add(normalizedDir);
    deduped.push(entry);
  }

  return deduped;
}

function dedupePaths(paths: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const candidatePath of paths) {
    const normalizedPath = path.resolve(candidatePath);
    if (seen.has(normalizedPath)) {
      continue;
    }

    seen.add(normalizedPath);
    deduped.push(candidatePath);
  }

  return deduped;
}

function assertCopilotDiscoveryPlan(
  plan: ProviderDiscoveryPlan,
): ProviderDiscoveryPlan {
  if (plan.provider !== "copilot") {
    throw new Error(
      `Expected copilot discovery plan, received ${plan.provider}`,
    );
  }

  return plan;
}

function serializeDiscoveryPlanRoots(plan: ProviderDiscoveryPlan): string {
  return plan.rootsInPrecedenceOrder
    .map((root) => `${root.id}:${root.resolvedPath}`)
    .join("|");
}

const AGENT_SESSION_CACHE_PREFIX = "copilot-config:agents:";
const SKILL_DIRECTORY_SESSION_CACHE_PREFIX =
  "copilot-config:skill-directories:";

function buildSessionScopedCacheKey(
  prefix: string,
  projectRoot: string,
  plan: ProviderDiscoveryPlan,
): string {
  return `${prefix}${projectRoot}::${serializeDiscoveryPlanRoots(plan)}`;
}

async function defaultPathExists(candidatePath: string): Promise<boolean> {
  try {
    await defaultFs.stat(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function getDiscoveryRootSubdirectory(
  rootPath: string,
  subdirectory: "agents" | "skills",
): string {
  const resolvedDirectory = path.join(rootPath, subdirectory);
  assertPathWithinRoot(
    rootPath,
    resolvedDirectory,
    `Copilot ${subdirectory} discovery path`,
  );
  return resolvedDirectory;
}

function resolveCopilotSubdirectoriesFromPlan(
  plan: ProviderDiscoveryPlan,
  subdirectory: "agents" | "skills",
): string[] {
  return dedupePaths(
    [...plan.rootsInPrecedenceOrder]
      .reverse()
      .map((root) => getDiscoveryRootSubdirectory(root.resolvedPath, subdirectory)),
  );
}

export async function resolveCopilotDiscoveryPlan(
  projectRoot: string,
  options: CopilotPathResolutionOptions = {},
): Promise<ProviderDiscoveryPlan> {
  if (options.providerDiscoveryPlan) {
    return assertCopilotDiscoveryPlan(options.providerDiscoveryPlan);
  }

  const startupPlan = getStartupProviderDiscoveryPlan("copilot", {
    projectRoot,
  });
  if (startupPlan) {
    return startupPlan;
  }

  const homeDir = os.homedir();
  return buildProviderDiscoveryPlan("copilot", {
    projectRoot,
    homeDir,
    xdgConfigHome: options.xdgConfigHome,
  });
}

export async function resolveCopilotSkillDirectories(
  projectRoot: string,
  options: CopilotPathResolutionOptions = {},
): Promise<string[]> {
  const plan = await resolveCopilotDiscoveryPlan(projectRoot, options);
  const cacheKey = buildSessionScopedCacheKey(
    SKILL_DIRECTORY_SESSION_CACHE_PREFIX,
    projectRoot,
    plan,
  );
  const sessionCachedDirectories =
    getProviderDiscoverySessionCacheValue<string[]>(cacheKey, {
      projectRoot,
    });
  if (sessionCachedDirectories) {
    return sessionCachedDirectories;
  }

  const cachedSkillDirectories = skillDirectoryCache.get(cacheKey);
  if (
    cachedSkillDirectories &&
    (Date.now() - cachedSkillDirectories.timestamp) < CACHE_TTL_MS
  ) {
    setProviderDiscoverySessionCacheValue(cacheKey, cachedSkillDirectories.directories, {
      projectRoot,
    });
    return cachedSkillDirectories.directories;
  }

  const candidateDirs = resolveCopilotSubdirectoriesFromPlan(plan, "skills");
  const doesPathExist = options.pathExistsFn ?? defaultPathExists;

  const existingDirectories = await Promise.all(
    candidateDirs.map(async (candidateDir) =>
      (await doesPathExist(candidateDir)) ? candidateDir : null,
    ),
  );

  const resolvedDirectories = existingDirectories.filter(
    (candidateDir): candidateDir is string => candidateDir !== null,
  );

  skillDirectoryCache.set(cacheKey, {
    directories: resolvedDirectories,
    timestamp: Date.now(),
  });
  setProviderDiscoverySessionCacheValue(cacheKey, resolvedDirectories, {
    projectRoot,
  });

  return resolvedDirectories;
}

export async function resolveCopilotAgentDirectories(
  projectRoot: string,
  options: CopilotPathResolutionOptions = {},
): Promise<string[]> {
  const plan = await resolveCopilotDiscoveryPlan(projectRoot, options);
  return resolveCopilotSubdirectoriesFromPlan(plan, "agents");
}

export function resolveCopilotAgentDirectoriesFromPlan(
  plan: ProviderDiscoveryPlan,
): string[] {
  return resolveCopilotSubdirectoriesFromPlan(assertCopilotDiscoveryPlan(plan), "agents");
}

export function resolveCopilotSkillDirectoriesFromPlan(
  plan: ProviderDiscoveryPlan,
): string[] {
  return resolveCopilotSubdirectoriesFromPlan(assertCopilotDiscoveryPlan(plan), "skills");
}

/**
 * Load agents from a directory containing .md files.
 * Each markdown file should have frontmatter with agent configuration.
 *
 * Files are loaded in parallel for better performance when spawning multiple sub-agents.
 *
 * @param agentsDir - Path to directory containing agent .md files
 * @param source - Whether agents are 'local' (project) or 'global' (user)
 * @param fsOps - Optional fs operations for testing (defaults to Node.js fs/promises)
 * @returns Array of parsed CopilotAgent objects
 */
export async function loadAgentsFromDir(
  agentsDir: string,
  source: "local" | "global",
  fsOps: FsOps = defaultFsOps
): Promise<CopilotAgent[]> {
  try {
    const files = await fsOps.readdir(agentsDir);
    const markdownFiles = (files as string[]).filter((file) => file.endsWith(".md"));

    const agentPromises: Promise<CopilotAgent>[] = markdownFiles.map(async (file) => {
        const filePath = path.join(agentsDir, file);
        const content = await fsOps.readFile(filePath, "utf-8");
        const parsed = parseMarkdownFrontmatter(content as string);

        if (!parsed) {
          const fallbackName = file.replace(/\.md$/, "");
          return {
            name: fallbackName,
            description: `Agent: ${fallbackName}`,
            systemPrompt: (content as string).trim(),
            source,
          } satisfies CopilotAgent;
        }

        const { frontmatter, body } = parsed;
        const name =
          typeof frontmatter.name === "string"
            ? frontmatter.name
            : file.replace(/\.md$/, "");
        const description =
          typeof frontmatter.description === "string"
            ? frontmatter.description
            : `Agent: ${name}`;

        return {
          name,
          description,
          displayName:
            typeof frontmatter.displayName === "string"
              ? frontmatter.displayName
              : typeof frontmatter["display-name"] === "string"
                ? frontmatter["display-name"]
                : undefined,
          tools: parseCopilotTools(frontmatter.tools),
          mcpServers: parseCopilotAgentMcpServers(
            frontmatter["mcp-servers"] ?? frontmatter.mcpServers,
          ),
          infer:
            typeof frontmatter.infer === "boolean"
              ? frontmatter.infer
              : undefined,
          systemPrompt: body.trim(),
          source,
        } satisfies CopilotAgent;
      });
    const agentResults = await Promise.allSettled(agentPromises);

    return agentResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<CopilotAgent> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
  } catch {
    return [];
  }
}

/**
 * Caches loaded Copilot discovery artifacts by project and normalized roots.
 * Cache is invalidated after 5 seconds to allow for dynamic agent changes.
 */
const agentCache = new Map<string, { agents: CopilotAgent[]; timestamp: number }>();
const skillDirectoryCache = new Map<
  string,
  { directories: string[]; timestamp: number }
>();
const CACHE_TTL_MS = 5000;

registerProviderDiscoveryCacheInvalidator(() => {
  agentCache.clear();
  skillDirectoryCache.clear();
});

/**
 * Load all Copilot agents from both local and global directories.
 * Local agents (project-specific) override global agents with the same name.
 *
 * Results are cached per project root for 5 seconds to avoid redundant file system
 * operations when spawning multiple parallel sub-agents.
 *
 * @param projectRoot - Path to the project root directory
 * @param fsOps - Optional fs operations for testing (defaults to Node.js fs/promises)
 * @returns Array of CopilotAgent objects with local taking priority over global
 */
export async function loadCopilotAgents(
  projectRoot: string,
  fsOps: FsOps = defaultFsOps,
  options: CopilotPathResolutionOptions = {},
): Promise<CopilotAgent[]> {
  const discoveryPlan = await resolveCopilotDiscoveryPlan(projectRoot, options);
  const cacheKey = `${projectRoot}::${serializeDiscoveryPlanRoots(discoveryPlan)}`;
  const sessionCacheKey = buildSessionScopedCacheKey(
    AGENT_SESSION_CACHE_PREFIX,
    projectRoot,
    discoveryPlan,
  );

  const sessionCachedAgents = getProviderDiscoverySessionCacheValue<CopilotAgent[]>(
    sessionCacheKey,
    {
      projectRoot,
    },
  );
  if (sessionCachedAgents) {
    return sessionCachedAgents;
  }

  const cached = agentCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    setProviderDiscoverySessionCacheValue(sessionCacheKey, cached.agents, {
      projectRoot,
    });
    return cached.agents;
  }

  // All agent directories in priority order (later entries override earlier for same name)
  const agentDirs = dedupeDirectoryEntries(
    discoveryPlan.rootsInPrecedenceOrder.map((root) => ({
      dir: getDiscoveryRootSubdirectory(root.resolvedPath, "agents"),
      source: root.tier === "projectLocal" ? "local" : "global",
    })),
  );

  // Map for deduplication - lowercase name as key for case-insensitive matching
  const agentMap = new Map<string, CopilotAgent>();

  // Load all directories in parallel instead of sequentially
  const allAgentsArrays = await Promise.all(
    agentDirs.map(({ dir, source }) => loadAgentsFromDir(dir, source, fsOps))
  );

  // Merge in priority order (later directories override earlier)
  for (const agents of allAgentsArrays) {
    for (const agent of agents) {
      agentMap.set(agent.name.toLowerCase(), agent);
    }
  }

  const agents = Array.from(agentMap.values());

  // Update cache
  agentCache.set(cacheKey, { agents, timestamp: Date.now() });
  setProviderDiscoverySessionCacheValue(sessionCacheKey, agents, {
    projectRoot,
  });

  return agents;
}

/**
 * Load Copilot instructions from either local or global configuration.
 * Local instructions (.github/copilot-instructions.md) take priority over
 * the configured global Copilot root from AGENTS.md.
 *
 * @param projectRoot - Path to the project root directory
 * @param fsOps - Optional fs operations for testing (defaults to Node.js fs/promises)
 * @returns The instructions content or null if not found
 */
export async function loadCopilotInstructions(
  projectRoot: string,
  fsOps: FsOps = defaultFsOps,
  options: CopilotPathResolutionOptions = {},
): Promise<string | null> {
  const plan = await resolveCopilotDiscoveryPlan(projectRoot, options);
  const instructionCandidates = dedupePaths(
    [...plan.rootsInPrecedenceOrder]
      .reverse()
      .map((root) => path.join(root.resolvedPath, "copilot-instructions.md")),
  );

  for (const candidatePath of instructionCandidates) {
    try {
      return (await fsOps.readFile(candidatePath, "utf-8")) as string;
    } catch {
      // Candidate not found, continue to next path.
    }
  }

  return null;
}
