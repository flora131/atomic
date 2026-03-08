import { homedir } from "os";
import { resolve } from "path";
import { buildProviderDiscoveryPlan, type ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import {
  getProviderDiscoverySessionCacheValue,
  getStartupProviderDiscoveryPlan,
  setProviderDiscoverySessionCacheValue,
} from "@/services/config/provider-discovery-cache.ts";

export interface OpenCodeArtifactLoadOptions {
  projectRoot?: string;
  homeDir?: string;
  xdgConfigHome?: string | null;
  providerDiscoveryPlan?: ProviderDiscoveryPlan;
}

function serializeDiscoveryPlanRoots(plan: ProviderDiscoveryPlan): string {
  return plan.rootsInPrecedenceOrder
    .map((root) => `${root.id}:${root.resolvedPath}`)
    .join("|");
}

function assertOpenCodeArtifactDiscoveryPlan(
  plan: ProviderDiscoveryPlan,
): ProviderDiscoveryPlan {
  if (plan.provider !== "opencode") {
    throw new Error(
      `Expected opencode discovery plan, received ${plan.provider}`,
    );
  }

  return plan;
}

export function resolveOpenCodeArtifactPlan(
  options: OpenCodeArtifactLoadOptions = {},
): ProviderDiscoveryPlan {
  if (options.providerDiscoveryPlan) {
    return assertOpenCodeArtifactDiscoveryPlan(options.providerDiscoveryPlan);
  }

  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const startupPlan = getStartupProviderDiscoveryPlan("opencode", {
    projectRoot,
  });
  if (startupPlan) {
    return startupPlan;
  }

  return buildProviderDiscoveryPlan("opencode", {
    projectRoot,
    homeDir: resolve(options.homeDir ?? homedir()),
    xdgConfigHome: options.xdgConfigHome,
  });
}

function resolveOpenCodeSubdirectories(
  options: OpenCodeArtifactLoadOptions,
  subdirectory: "agents" | "skills",
): string[] {
  const plan = resolveOpenCodeArtifactPlan(options);
  const cacheKey = `opencode:${subdirectory}:${serializeDiscoveryPlanRoots(plan)}`;
  const cachedDirectories = getProviderDiscoverySessionCacheValue<string[]>(
    cacheKey,
    {
      projectRoot: options.projectRoot,
    },
  );
  if (cachedDirectories) {
    return cachedDirectories;
  }

  const directories = Array.from(
    new Set(
      [...plan.rootsInPrecedenceOrder]
        .reverse()
        .map((root) => resolve(root.resolvedPath, subdirectory)),
    ),
  );

  return setProviderDiscoverySessionCacheValue(cacheKey, directories, {
    projectRoot: options.projectRoot,
  });
}

export function resolveOpenCodeAgentDirectories(
  options: OpenCodeArtifactLoadOptions = {},
): string[] {
  return resolveOpenCodeSubdirectories(options, "agents");
}

export function resolveOpenCodeSkillDirectories(
  options: OpenCodeArtifactLoadOptions = {},
): string[] {
  return resolveOpenCodeSubdirectories(options, "skills");
}
