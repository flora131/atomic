import { homedir } from "os";
import { join, resolve } from "path";
import { mkdir, rm } from "fs/promises";
import { copyDir, pathExists } from "./copy";
import {
  assertPathWithinRoot,
  assertRealPathWithinRoot,
} from "./path-root-guard";
import {
  buildProviderDiscoveryPlan,
  type PlannedProviderDiscoveryRoot,
  type ProviderDiscoveryPlan,
} from "./provider-discovery-plan.ts";

const OPENCODE_ROOT_LABEL_BY_ID: Record<string, string> = {
  opencode_atomic: "Atomic OpenCode config root",
  opencode_user_canonical_xdg: "OpenCode canonical config root",
  opencode_user_home_native: "OpenCode home config root",
  opencode_project: "OpenCode project config root",
};

interface OpenCodeRootGuardContext {
  atomicHomeDir: string;
  homeDir: string;
  projectRoot: string;
}

function getOpenCodeRootLabel(root: PlannedProviderDiscoveryRoot): string {
  return OPENCODE_ROOT_LABEL_BY_ID[root.id] ??
    `OpenCode discovery root (${root.id})`;
}

function getOpenCodeRootAllowedPath(
  root: PlannedProviderDiscoveryRoot,
  context: OpenCodeRootGuardContext,
): string {
  if (root.tier === "atomicBaseline") {
    return context.atomicHomeDir;
  }
  if (root.tier === "projectLocal") {
    return context.projectRoot;
  }
  return context.homeDir;
}

function getRequiredOpenCodeRoot(
  plan: ProviderDiscoveryPlan,
  rootId: string,
): PlannedProviderDiscoveryRoot {
  const root = plan.rootsById.get(rootId);
  if (!root) {
    throw new Error(`OpenCode discovery plan missing required root: ${rootId}`);
  }
  return root;
}

function resolveOpenCodeDiscoveryPlan(
  options: PrepareOpenCodeConfigOptions,
  homeDir: string,
  projectRoot: string,
): ProviderDiscoveryPlan {
  if (options.providerDiscoveryPlan) {
    if (options.providerDiscoveryPlan.provider !== "opencode") {
      throw new Error(
        `prepareOpenCodeConfigDir expected opencode provider plan, received ${options.providerDiscoveryPlan.provider}`,
      );
    }
    return options.providerDiscoveryPlan;
  }

  return buildProviderDiscoveryPlan("opencode", {
    homeDir,
    projectRoot,
  });
}

export interface PrepareOpenCodeConfigOptions {
  /** Project root used for local .opencode overrides */
  projectRoot?: string;
  /** Home directory override for tests */
  homeDir?: string;
  /** Startup discovery plan override for deterministic root ordering */
  providerDiscoveryPlan?: ProviderDiscoveryPlan;
  /** Explicit merged directory path override for tests */
  mergedDir?: string;
}

/**
 * Build a merged OpenCode config directory for OPENCODE_CONFIG_DIR.
 *
 * Precedence (low -> high):
 * 1) ~/.atomic/.opencode (Atomic-managed defaults)
 * 2) platform config-home/.opencode (canonical user config)
 * 3) ~/.opencode (user home config)
 * 4) <project>/.opencode (project-local overrides)
 *
 * @returns merged directory path, or null when Atomic base config is missing
 */
export async function prepareOpenCodeConfigDir(
  options: PrepareOpenCodeConfigOptions = {}
): Promise<string | null> {
  const fallbackHomeDir = resolve(options.homeDir ?? homedir());
  const fallbackProjectRoot = resolve(options.projectRoot ?? process.cwd());
  const discoveryPlan = resolveOpenCodeDiscoveryPlan(
    options,
    fallbackHomeDir,
    fallbackProjectRoot,
  );
  const atomicRoot = getRequiredOpenCodeRoot(discoveryPlan, "opencode_atomic");
  const projectRootConfig = getRequiredOpenCodeRoot(discoveryPlan, "opencode_project");

  const atomicBaseDir = resolve(atomicRoot.resolvedPath);
  const atomicHomeDir = resolve(atomicBaseDir, "..");
  const homeDir = resolve(atomicHomeDir, "..");
  const projectRoot = resolve(projectRootConfig.resolvedPath, "..");

  const mergedDir = resolve(
    options.mergedDir ?? join(atomicHomeDir, ".tmp", "opencode-config-merged")
  );

  assertPathWithinRoot(atomicHomeDir, mergedDir, "OpenCode merged config directory");

  if (!(await pathExists(atomicBaseDir))) {
    return null;
  }

  await assertRealPathWithinRoot(atomicHomeDir, atomicBaseDir, "Atomic OpenCode config root");

  await rm(mergedDir, { recursive: true, force: true });
  await mkdir(mergedDir, { recursive: true });

  await assertRealPathWithinRoot(atomicHomeDir, mergedDir, "OpenCode merged config directory");

  for (const root of discoveryPlan.rootsInPrecedenceOrder) {
    if (!(await pathExists(root.resolvedPath))) {
      continue;
    }

    const allowedRoot = getOpenCodeRootAllowedPath(root, {
      atomicHomeDir,
      homeDir,
      projectRoot,
    });

    await assertRealPathWithinRoot(
      allowedRoot,
      root.resolvedPath,
      getOpenCodeRootLabel(root),
    );
    await copyDir(root.resolvedPath, mergedDir);
  }

  return mergedDir;
}
