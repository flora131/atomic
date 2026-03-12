import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import { resolveClaudeAgentDirectories } from "@/services/config/claude-config.ts";
import { resolveOpenCodeAgentDirectories } from "@/services/config/opencode-config.ts";
import { resolveCopilotAgentDirectoriesFromPlan } from "@/services/config/copilot-config.ts";
import {
  getGlobalDiscoveryPaths,
  getUserDiscoveryRoots,
  isPathWithinRoot,
} from "@/commands/catalog/shared/discovery-paths.ts";
import {
  AGENT_DISCOVERY_PATHS,
  type AgentFileDiscoveryOptions,
  type AgentSource,
  type DiscoveredAgentFile,
  HOME,
} from "./types.ts";

function getGlobalAgentPaths(): string[] {
  return getGlobalDiscoveryPaths(HOME, "agents");
}

export function expandTildePath(path: string): string {
  if (path.startsWith("~/")) {
    return join(HOME, path.slice(2));
  }
  if (path === "~") {
    return HOME;
  }
  return path;
}

export function determineAgentSource(discoveryPath: string): AgentSource {
  if (discoveryPath.startsWith("~")) {
    return "user";
  }

  const resolvedPath = resolve(discoveryPath);
  if (isPathWithinRoot(process.cwd(), resolvedPath)) {
    return "project";
  }

  if (
    getUserDiscoveryRoots(HOME).some((rootPath) =>
      isPathWithinRoot(rootPath, resolvedPath),
    )
  ) {
    return "user";
  }

  return "project";
}

export function getRuntimeCompatibleAgentDiscoveryPaths(
  discoveryPlans: readonly ProviderDiscoveryPlan[],
): string[] {
  return collectAgentDiscoveryPaths(discoveryPlans);
}

function collectAgentDiscoveryPaths(
  discoveryPlans: readonly ProviderDiscoveryPlan[],
): string[] {
  const searchPaths: string[] = [];
  const seen = new Set<string>();

  for (const plan of discoveryPlans) {
    const providerSearchPaths = (() => {
      switch (plan.provider) {
        case "claude":
          return resolveClaudeAgentDirectories({
            projectRoot: process.cwd(),
            providerDiscoveryPlan: plan,
          });
        case "opencode":
          return resolveOpenCodeAgentDirectories({
            projectRoot: process.cwd(),
            providerDiscoveryPlan: plan,
          });
        case "copilot":
          return resolveCopilotAgentDirectoriesFromPlan(plan);
        default:
          return [] as string[];
      }
    })();

    for (const agentPath of providerSearchPaths) {
      const resolvedPath = resolve(agentPath);
      if (seen.has(resolvedPath)) {
        continue;
      }

      seen.add(resolvedPath);
      searchPaths.push(resolvedPath);
    }
  }

  return searchPaths;
}

export function discoverAgentFilesInPath(
  searchPath: string,
  source: AgentSource,
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
    // Skip directories we can't read.
  }

  return discovered;
}

export function discoverAgentFiles(): DiscoveredAgentFile[] {
  return discoverAgentFilesWithOptions();
}

export function discoverAgentFilesWithOptions(
  options: AgentFileDiscoveryOptions = {},
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

  for (const searchPath of AGENT_DISCOVERY_PATHS) {
    const source = determineAgentSource(searchPath);
    const files = discoverAgentFilesInPath(searchPath, source);
    discovered.push(...files);
  }

  for (const searchPath of getGlobalAgentPaths()) {
    const source = determineAgentSource(searchPath);
    const files = discoverAgentFilesInPath(searchPath, source);
    discovered.push(...files);
  }

  return discovered;
}
