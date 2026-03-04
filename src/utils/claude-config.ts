import { homedir } from "os";
import { join, resolve } from "path";
import { mkdir, rm } from "fs/promises";
import { copyDir, pathExists } from "./copy";
import {
  buildProviderDiscoveryPlan,
  getCompatibleDiscoveryRoots,
  type ProviderDiscoveryPlan,
} from "./provider-discovery-plan.ts";
import type { ProviderDiscoveryTier } from "./provider-discovery-contract.ts";
import {
  assertPathWithinRoot,
  assertRealPathWithinRoot,
} from "./path-root-guard";

const CLAUDE_CONFIG_MERGE_EXCLUDES = [".git"];

export interface PrepareClaudeConfigOptions {
  projectRoot?: string;
  homeDir?: string;
  mergedDir?: string;
  discoveryPlan?: ProviderDiscoveryPlan;
}

function resolveClaudeDiscoveryPlan(
  options: PrepareClaudeConfigOptions,
  homeDir: string,
  projectRoot: string,
): ProviderDiscoveryPlan {
  const discoveryPlan =
    options.discoveryPlan ??
    buildProviderDiscoveryPlan("claude", {
      homeDir,
      projectRoot,
    });

  if (discoveryPlan.provider !== "claude") {
    throw new Error(
      `Expected Claude discovery plan, received ${discoveryPlan.provider}`,
    );
  }

  return discoveryPlan;
}

function getAllowedRootForTier(
  tier: ProviderDiscoveryTier,
  atomicHomeDir: string,
  homeDir: string,
  projectRoot: string,
): string {
  if (tier === "atomicBaseline") {
    return atomicHomeDir;
  }
  if (tier === "userGlobal") {
    return homeDir;
  }

  return projectRoot;
}

function getClaudeRootLabel(rootId: string): string {
  switch (rootId) {
    case "claude_atomic":
      return "Atomic Claude config root";
    case "claude_user":
      return "User Claude config root";
    case "claude_project":
      return "Project Claude config root";
    default:
      return `Claude config root (${rootId})`;
  }
}

/**
 * Build a merged Claude config directory for CLAUDE_CONFIG_DIR.
 *
 * Precedence (low -> high):
 * 1) ~/.atomic/.claude (Atomic-managed defaults)
 * 2) ~/.claude (user global config)
 * 3) <project>/.claude (project-local overrides)
 *
 * @returns merged directory path, or null when ~/.atomic/.claude is missing
 */
export async function prepareClaudeConfigDir(
  options: PrepareClaudeConfigOptions = {},
): Promise<string | null> {
  const homeDir = resolve(options.homeDir ?? homedir());
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const atomicHomeDir = join(homeDir, ".atomic");
  const mergedDir = resolve(
    options.mergedDir ?? join(atomicHomeDir, ".tmp", "claude-config-merged"),
  );
  const stagingDir = join(atomicHomeDir, ".tmp", "claude-config-merge-staging");
  const discoveryPlan = resolveClaudeDiscoveryPlan(options, homeDir, projectRoot);
  const rootsInPrecedenceOrder = getCompatibleDiscoveryRoots(discoveryPlan, "native");
  const atomicRoot = rootsInPrecedenceOrder.find((root) => root.id === "claude_atomic");

  assertPathWithinRoot(atomicHomeDir, mergedDir, "Claude merged config directory");

  if (!atomicRoot) {
    throw new Error("Claude discovery plan is missing required root: claude_atomic");
  }

  if (!(await pathExists(atomicRoot.resolvedPath))) {
    return null;
  }

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await assertRealPathWithinRoot(atomicHomeDir, stagingDir, "Claude staging config root");

  try {
    for (const root of rootsInPrecedenceOrder) {
      const sourcePath = root.resolvedPath;
      if (!(await pathExists(sourcePath))) {
        continue;
      }

      const allowedRoot = getAllowedRootForTier(
        root.tier,
        atomicHomeDir,
        homeDir,
        projectRoot,
      );
      const rootLabel = getClaudeRootLabel(root.id);

      assertPathWithinRoot(allowedRoot, sourcePath, rootLabel);
      await assertRealPathWithinRoot(allowedRoot, sourcePath, rootLabel);

      await copyDir(sourcePath, stagingDir, {
        exclude: CLAUDE_CONFIG_MERGE_EXCLUDES,
      });
    }

    await rm(mergedDir, { recursive: true, force: true });
    await mkdir(mergedDir, { recursive: true });
    await assertRealPathWithinRoot(atomicHomeDir, mergedDir, "Claude merged config directory");

    await copyDir(stagingDir, mergedDir, {
      exclude: CLAUDE_CONFIG_MERGE_EXCLUDES,
    });

    return mergedDir;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
