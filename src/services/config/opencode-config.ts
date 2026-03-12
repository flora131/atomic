import defaultFs from "node:fs/promises";
import { homedir } from "os";
import { resolve } from "path";
import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";
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

export interface OpenCodeAgent {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: Record<string, boolean>;
  source: "local" | "global";
}

function parseOpenCodeToolToggles(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    ([name, enabled]) => name.trim().length > 0 && typeof enabled === "boolean",
  );
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries.map(([name, enabled]) => [name.trim(), enabled]));
}

async function loadOpenCodeAgentsFromDir(
  agentsDir: string,
  source: "local" | "global",
): Promise<OpenCodeAgent[]> {
  try {
    const files = await defaultFs.readdir(agentsDir);
    const markdownFiles = files.filter((file) => file.endsWith(".md"));

    const agentResults = await Promise.allSettled(
      markdownFiles.map(async (file) => {
        const filePath = resolve(agentsDir, file);
        const content = await defaultFs.readFile(filePath, "utf-8");
        const parsed = parseMarkdownFrontmatter(content);

        if (!parsed) {
          const fallbackName = file.replace(/\.md$/, "");
          return {
            name: fallbackName,
            description: `Agent: ${fallbackName}`,
            systemPrompt: content.trim(),
            source,
          } satisfies OpenCodeAgent;
        }

        const { frontmatter, body } = parsed;
        const name = typeof frontmatter.name === "string"
          ? frontmatter.name
          : file.replace(/\.md$/, "");

        return {
          name,
          description: typeof frontmatter.description === "string"
            ? frontmatter.description
            : `Agent: ${name}`,
          systemPrompt: body.trim(),
          tools: parseOpenCodeToolToggles(frontmatter.tools),
          source,
        } satisfies OpenCodeAgent;
      }),
    );

    return agentResults
      .filter(
        (result): result is PromiseFulfilledResult<OpenCodeAgent> => result.status === "fulfilled",
      )
      .map((result) => result.value);
  } catch {
    return [];
  }
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

export async function loadOpenCodeAgents(
  options: OpenCodeArtifactLoadOptions = {},
): Promise<OpenCodeAgent[]> {
  const plan = resolveOpenCodeArtifactPlan(options);
  const agentDirs = plan.rootsInPrecedenceOrder.map((root) => ({
    dir: resolve(root.resolvedPath, "agents"),
    source: root.tier === "projectLocal" ? "local" as const : "global" as const,
  }));

  const agentMap = new Map<string, OpenCodeAgent>();
  const allAgents = await Promise.all(
    agentDirs.map(({ dir, source }) => loadOpenCodeAgentsFromDir(dir, source)),
  );

  for (const agents of allAgents) {
    for (const agent of agents) {
      agentMap.set(agent.name.trim().toLowerCase(), agent);
    }
  }

  return Array.from(agentMap.values());
}
