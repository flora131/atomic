import defaultFs from "fs/promises";
import path from "path";
import os from "os";
import { parseMarkdownFrontmatter } from "../utils/markdown.ts";
import {
  emitCopilotPathConflictWarnings,
  type CopilotPathConflictWarning,
  resolveCopilotUserRoots,
} from "../utils/copilot-paths.ts";
import {
  buildProviderDiscoveryPlan,
  type ProviderDiscoveryPlan,
} from "../utils/provider-discovery-plan.ts";
import { assertPathWithinRoot } from "../utils/path-root-guard.ts";
import {
  getProviderDiscoverySessionCacheValue,
  getStartupProviderDiscoveryPlan,
  registerProviderDiscoveryCacheInvalidator,
  setProviderDiscoverySessionCacheValue,
} from "../utils/provider-discovery-cache.ts";

/**
 * Represents a Copilot agent configuration parsed from manual format.
 */
export interface CopilotAgent {
  /** The name of the agent */
  name: string;
  /** Description of what the agent does */
  description: string;
  /** Optional list of tool names this agent can use */
  tools?: string[];
  /** The system prompt for the agent */
  systemPrompt: string;
  /** Where the agent was loaded from */
  source: "local" | "global";
}

/**
 * File system operations interface for dependency injection.
 * Allows testing with mock implementations.
 */
export interface FsOps {
  readdir: typeof defaultFs.readdir;
  readFile: typeof defaultFs.readFile;
}

export interface CopilotPathResolutionOptions {
  xdgConfigHome?: string | null;
  appDataDir?: string | null;
  platform?: NodeJS.Platform;
  onPathConflictWarning?: (warning: CopilotPathConflictWarning) => void;
  pathExistsFn?: (candidatePath: string) => Promise<boolean>;
  providerDiscoveryPlan?: ProviderDiscoveryPlan;
}

/** Default fs operations using Node.js fs/promises */
export const defaultFsOps: FsOps = {
  readdir: defaultFs.readdir,
  readFile: defaultFs.readFile,
};

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

function resolveXdgConfigHome(
  options: CopilotPathResolutionOptions,
): string | null {
  return options.xdgConfigHome === undefined
    ? process.env.XDG_CONFIG_HOME ?? null
    : options.xdgConfigHome;
}

function resolveAppDataDir(
  options: CopilotPathResolutionOptions,
): string | null {
  return options.appDataDir === undefined
    ? process.env.APPDATA ?? null
    : options.appDataDir;
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

const AGENT_SESSION_CACHE_PREFIX = "copilot-manual:agents:";
const SKILL_DIRECTORY_SESSION_CACHE_PREFIX =
  "copilot-manual:skill-directories:";

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

  const xdgConfigHome = resolveXdgConfigHome(options);
  const appDataDir = resolveAppDataDir(options);
  const homeDir = os.homedir();
  const copilotRoots = await resolveCopilotUserRoots({
    homeDir,
    xdgConfigHome,
    appDataDir,
    platform: options.platform,
  });
  emitCopilotPathConflictWarnings(
    copilotRoots.warnings,
    options.onPathConflictWarning,
  );

  return buildProviderDiscoveryPlan("copilot", {
    projectRoot,
    homeDir,
    ...(xdgConfigHome ? { xdgConfigHome } : {}),
    ...(appDataDir ? { appDataDir } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
    copilotCanonicalUserRoot: copilotRoots.canonicalRoot,
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

  const rootsInCompatibilityOrder = [...plan.rootsInPrecedenceOrder].reverse();
  const candidateDirs = dedupePaths(
    rootsInCompatibilityOrder.map((root) =>
      getDiscoveryRootSubdirectory(root.resolvedPath, "skills"),
    ),
  );
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
    const mdFiles = (files as string[]).filter((f) => f.endsWith(".md"));

    // Load all files in parallel
    const agentResults = await Promise.allSettled(
      mdFiles.map(async (file) => {
        const filePath = path.join(agentsDir, file);
        const content = await fsOps.readFile(filePath, "utf-8");
        const parsed = parseMarkdownFrontmatter(content as string);

        if (!parsed) {
          // No frontmatter, use file content as system prompt
          return {
            name: file.replace(/\.md$/, ""),
            description: `Agent: ${file.replace(/\.md$/, "")}`,
            systemPrompt: (content as string).trim(),
            source,
          };
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
        const tools = Array.isArray(frontmatter.tools)
          ? (frontmatter.tools.filter(
              (t): t is string => typeof t === "string"
            ) as string[])
          : undefined;

        return {
          name,
          description,
          tools,
          systemPrompt: body.trim(),
          source,
        };
      })
    );

    // Filter out rejected promises and extract successful agents
    return agentResults
      .filter((result): result is PromiseFulfilledResult<CopilotAgent> => result.status === "fulfilled")
      .map((result) => result.value);
  } catch {
    // Return empty array if directory doesn't exist or can't be read
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
 * ~/.copilot, then canonical global root, then ~/.atomic/.copilot.
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
  const homeDir = os.homedir();
  const xdgConfigHome = resolveXdgConfigHome(options);
  const appDataDir = resolveAppDataDir(options);
  const copilotRoots = await resolveCopilotUserRoots({
    homeDir,
    xdgConfigHome,
    appDataDir,
    platform: options.platform,
  });
  emitCopilotPathConflictWarnings(
    copilotRoots.warnings,
    options.onPathConflictWarning,
  );

  const instructionCandidates = dedupePaths([
    path.join(projectRoot, ".github", "copilot-instructions.md"),
    path.join(copilotRoots.homeRoot, "copilot-instructions.md"),
    path.join(copilotRoots.canonicalRoot, "copilot-instructions.md"),
    path.join(homeDir, ".atomic", ".copilot", "copilot-instructions.md"),
  ]);

  for (const candidatePath of instructionCandidates) {
    try {
      return (await fsOps.readFile(candidatePath, "utf-8")) as string;
    } catch {
      // Candidate not found, continue to next path.
    }
  }

  return null;
}
