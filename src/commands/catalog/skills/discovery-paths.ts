import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import { resolveClaudeSkillDirectories } from "@/services/config/claude-config.ts";
import { resolveOpenCodeSkillDirectories } from "@/services/config/opencode-config.ts";
import { resolveCopilotSkillDirectoriesFromPlan } from "@/services/config/copilot-config.ts";
import {
  getGlobalDiscoveryPaths,
  getUserDiscoveryRoots,
  isPathWithinRoot,
} from "@/commands/catalog/shared/discovery-paths.ts";
import {
  HOME,
  SKILL_DISCOVERY_PATHS,
  type DiscoveredSkillFile,
  type SkillSource,
} from "./types.ts";

function getGlobalSkillPaths(): string[] {
  return getGlobalDiscoveryPaths(HOME, "skills");
}

export function shouldSkillOverride(
  newSource: SkillSource,
  existingSource: SkillSource,
): boolean {
  const priority: Record<SkillSource, number> = {
    project: 2,
    user: 1,
  };
  return priority[newSource] > priority[existingSource];
}

function determineSkillSource(discoveryPath: string): SkillSource {
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

export function getRuntimeCompatibleSkillDiscoveryPaths(
  discoveryPlans: readonly ProviderDiscoveryPlan[],
): string[] {
  return collectSkillDiscoveryPaths(discoveryPlans);
}

function collectSkillDiscoveryPaths(
  discoveryPlans: readonly ProviderDiscoveryPlan[],
): string[] {
  const searchPaths: string[] = [];
  const seen = new Set<string>();

  for (const plan of discoveryPlans) {
    const providerSearchPaths = (() => {
      switch (plan.provider) {
        case "claude":
          return resolveClaudeSkillDirectories({
            projectRoot: process.cwd(),
            providerDiscoveryPlan: plan,
          });
        case "opencode":
          return resolveOpenCodeSkillDirectories({
            projectRoot: process.cwd(),
            providerDiscoveryPlan: plan,
          });
        case "copilot":
          return resolveCopilotSkillDirectoriesFromPlan(plan);
        default:
          return [] as string[];
      }
    })();

    for (const skillPath of providerSearchPaths) {
      const resolvedPath = resolve(skillPath);
      if (seen.has(resolvedPath)) {
        continue;
      }

      seen.add(resolvedPath);
      searchPaths.push(resolvedPath);
    }
  }

  return searchPaths;
}

export function discoverSkillFiles(
  options: {
    searchPaths?: readonly string[];
  } = {},
): DiscoveredSkillFile[] {
  const files: DiscoveredSkillFile[] = [];
  const cwd = process.cwd();
  const discoveryPaths = options.searchPaths ?? [
    ...SKILL_DISCOVERY_PATHS.map((searchPath) => resolve(cwd, searchPath)),
    ...getGlobalSkillPaths(),
  ];

  for (const discoveryPath of discoveryPaths) {
    const fullPath = resolve(discoveryPath);
    if (!existsSync(fullPath)) {
      continue;
    }

    try {
      const entries = readdirSync(fullPath, { withFileTypes: true });
      const source = determineSkillSource(fullPath);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = join(fullPath, entry.name, "SKILL.md");
        if (existsSync(skillFile)) {
          files.push({
            path: skillFile,
            dirName: entry.name,
            source,
          });
        }
      }
    } catch {
      // Skip inaccessible directories.
    }
  }

  return files;
}
