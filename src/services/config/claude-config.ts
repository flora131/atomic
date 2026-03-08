import { homedir } from "os";
import { resolve } from "path";
import { buildProviderDiscoveryPlan, type ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import {
  getProviderDiscoverySessionCacheValue,
  getStartupProviderDiscoveryPlan,
  setProviderDiscoverySessionCacheValue,
} from "@/services/config/provider-discovery-cache.ts";
import {
  defaultAgentDefinitionFsOps,
  loadAgentDefinitionsFromDir,
  type AgentDefinitionFsOps,
  type RuntimeAgentDefinition,
} from "@/services/config/agent-definition-loader.ts";

export interface ClaudeArtifactLoadOptions {
  projectRoot?: string;
  homeDir?: string;
  providerDiscoveryPlan?: ProviderDiscoveryPlan;
}

function serializeDiscoveryPlanRoots(plan: ProviderDiscoveryPlan): string {
  return plan.rootsInPrecedenceOrder
    .map((root) => `${root.id}:${root.resolvedPath}`)
    .join("|");
}

function assertClaudeArtifactDiscoveryPlan(
  plan: ProviderDiscoveryPlan,
): ProviderDiscoveryPlan {
  if (plan.provider !== "claude") {
    throw new Error(`Expected Claude discovery plan, received ${plan.provider}`);
  }

  return plan;
}

function resolveClaudeArtifactPlan(
  options: ClaudeArtifactLoadOptions = {},
): ProviderDiscoveryPlan {
  if (options.providerDiscoveryPlan) {
    return assertClaudeArtifactDiscoveryPlan(options.providerDiscoveryPlan);
  }

  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const startupPlan = getStartupProviderDiscoveryPlan("claude", {
    projectRoot,
  });
  if (startupPlan) {
    return startupPlan;
  }

  return buildProviderDiscoveryPlan("claude", {
    projectRoot,
    homeDir: resolve(options.homeDir ?? homedir()),
  });
}

function resolveClaudeSubdirectories(
  options: ClaudeArtifactLoadOptions,
  subdirectory: "agents" | "skills",
): string[] {
  const plan = resolveClaudeArtifactPlan(options);
  const cacheKey = `claude:${subdirectory}:${serializeDiscoveryPlanRoots(plan)}`;
  const cachedDirectories = getProviderDiscoverySessionCacheValue<string[]>(
    cacheKey,
    {
      projectRoot: options.projectRoot,
    },
  );
  if (cachedDirectories) {
    return cachedDirectories;
  }

  const directories = [...plan.rootsInPrecedenceOrder]
    .reverse()
    .map((root) => resolve(root.resolvedPath, subdirectory));

  return setProviderDiscoverySessionCacheValue(cacheKey, directories, {
    projectRoot: options.projectRoot,
  });
}

export function resolveClaudeAgentDirectories(
  options: ClaudeArtifactLoadOptions = {},
): string[] {
  return resolveClaudeSubdirectories(options, "agents");
}

export function resolveClaudeSkillDirectories(
  options: ClaudeArtifactLoadOptions = {},
): string[] {
  return resolveClaudeSubdirectories(options, "skills");
}

export async function loadClaudeAgents(
  options: ClaudeArtifactLoadOptions = {},
  fsOps: AgentDefinitionFsOps = defaultAgentDefinitionFsOps,
): Promise<RuntimeAgentDefinition[]> {
  const plan = resolveClaudeArtifactPlan(options);
  const cacheKey = `claude:agents:loaded:${serializeDiscoveryPlanRoots(plan)}`;
  const cachedAgents = getProviderDiscoverySessionCacheValue<
    RuntimeAgentDefinition[]
  >(cacheKey, {
    projectRoot: options.projectRoot,
  });
  if (cachedAgents) {
    return cachedAgents;
  }

  const agentDirectories: Array<{
    dir: string;
    source: "local" | "global";
  }> = plan.rootsInPrecedenceOrder.map((root) => ({
    dir: resolve(root.resolvedPath, "agents"),
    source: root.tier === "projectLocal" ? "local" : "global",
  }));
  const loadedAgentArrays = await Promise.all(
    agentDirectories.map(({ dir, source }) =>
      loadAgentDefinitionsFromDir(dir, source, fsOps),
    ),
  );

  const mergedAgents = new Map<string, RuntimeAgentDefinition>();
  for (const agents of loadedAgentArrays) {
    for (const agent of agents) {
      mergedAgents.set(agent.name.toLowerCase(), agent);
    }
  }

  return setProviderDiscoverySessionCacheValue(
    cacheKey,
    [...mergedAgents.values()],
    {
      projectRoot: options.projectRoot,
    },
  );
}
