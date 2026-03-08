import { homedir } from "os";
import { join, resolve } from "path";
import { mkdir, rm } from "fs/promises";
import { copyDir, pathExists } from "@/services/system/copy.ts";
import {
  assertPathWithinRoot,
  assertRealPathWithinRoot,
} from "@/lib/path-root-guard.ts";
import {
  buildProviderDiscoveryPlan,
  type PlannedProviderDiscoveryRoot,
  type ProviderDiscoveryPlan,
} from "@/services/config/provider-discovery-plan.ts";

const OPENCODE_ROOT_LABEL_BY_ID: Record<string, string> = {
  opencode_user_home_native: "OpenCode home config root",
  opencode_user_canonical_xdg: "OpenCode XDG config root",
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
 * 1) ~/.opencode (installed/user home config)
 * 2) distinct XDG config root/.opencode (custom user override, if present)
 * 3) <project>/.opencode (project-local overrides)
 *
 * @returns merged directory path, or null when ~/.opencode is missing
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
  const homeRoot = getRequiredOpenCodeRoot(discoveryPlan, "opencode_user_home_native");
  const projectRootConfig = getRequiredOpenCodeRoot(discoveryPlan, "opencode_project");

  const homeConfigDir = resolve(homeRoot.resolvedPath);
  const homeDir = resolve(homeConfigDir, "..");
  const atomicHomeDir = join(homeDir, ".atomic");
  const projectRoot = resolve(projectRootConfig.resolvedPath, "..");

  const mergedDir = resolve(
    options.mergedDir ?? join(atomicHomeDir, ".tmp", "opencode-config-merged")
  );

  assertPathWithinRoot(atomicHomeDir, mergedDir, "OpenCode merged config directory");

  if (!(await pathExists(homeConfigDir))) {
    return null;
  }

  await assertRealPathWithinRoot(homeDir, homeConfigDir, "OpenCode home config root");

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
