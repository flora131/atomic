import type {
  AgentDefinition,
  AgentMcpServerSpec,
  McpServerConfigForProcessTransport,
} from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "os";
import { resolve } from "path";
import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";
import { buildProviderDiscoveryPlan, type ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import {
  getProviderDiscoverySessionCacheValue,
  getStartupProviderDiscoveryPlan,
  setProviderDiscoverySessionCacheValue,
} from "@/services/config/provider-discovery-cache.ts";
import {
  defaultAgentDefinitionFsOps,
  type AgentDefinitionFsOps,
} from "@/services/config/agent-definition-loader.ts";

export interface ClaudeArtifactLoadOptions {
  projectRoot?: string;
  homeDir?: string;
  providerDiscoveryPlan?: ProviderDiscoveryPlan;
}

export interface ClaudeAgent extends AgentDefinition {
  name: string;
  source: "local" | "global";
}

function parseClaudeStringList(
  value: unknown,
  options: { allowCommaSeparated?: boolean } = {},
): string[] | undefined {
  if (Array.isArray(value)) {
    const parsed = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parsed.length > 0 ? parsed : undefined;
  }

  if (options.allowCommaSeparated && typeof value === "string") {
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

function parseClaudeMcpServerConfig(
  value: unknown,
): Record<string, McpServerConfigForProcessTransport> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const servers: Record<string, McpServerConfigForProcessTransport> = {};

  for (const [name, rawConfig] of Object.entries(value)) {
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      return null;
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
    const args = Array.isArray(config.args)
      ? config.args.filter((entry): entry is string => typeof entry === "string")
      : undefined;

    if (normalizedType === "http" || normalizedType === "sse") {
      if (typeof config.url !== "string" || config.url.trim().length === 0) {
        return null;
      }

      servers[name] = {
        type: normalizedType,
        url: config.url,
        headers: parseStringRecord(config.headers),
      };
      continue;
    }

    if (typeof config.command !== "string" || config.command.trim().length === 0) {
      return null;
    }

    servers[name] = {
      type: normalizedType ?? "stdio",
      command: config.command,
      args,
      env: parseStringRecord(config.env),
    };
  }

  return Object.keys(servers).length > 0 ? servers : null;
}

function parseClaudeAgentMcpServers(value: unknown): AgentMcpServerSpec[] | undefined {
  if (Array.isArray(value)) {
    const parsedSpecs = value.flatMap<AgentMcpServerSpec>((entry) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed.length > 0 ? [trimmed] : [];
      }

      const configRecord = parseClaudeMcpServerConfig(entry);
      return configRecord ? [configRecord] : [];
    });
    return parsedSpecs.length > 0 ? parsedSpecs : undefined;
  }

  if (typeof value === "string") {
    const parsedNames = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parsedNames.length > 0 ? parsedNames : undefined;
  }

  const configRecord = parseClaudeMcpServerConfig(value);
  return configRecord ? [configRecord] : undefined;
}

function parseClaudeAgentModel(value: unknown): AgentDefinition["model"] | undefined {
  return value === "sonnet" ||
      value === "opus" ||
      value === "haiku" ||
      value === "inherit"
    ? value
    : undefined;
}

async function loadClaudeAgentsFromDir(
  agentsDir: string,
  source: "local" | "global",
  fsOps: AgentDefinitionFsOps,
): Promise<ClaudeAgent[]> {
  try {
    const files = await fsOps.readdir(agentsDir);
    const markdownFiles = (files as string[]).filter((file) => file.endsWith(".md"));

    const agentPromises: Promise<ClaudeAgent>[] = markdownFiles.map(async (file) => {
        const filePath = resolve(agentsDir, file);
        const content = await fsOps.readFile(filePath, "utf-8");
        const parsed = parseMarkdownFrontmatter(content as string);

        if (!parsed) {
          const fallbackName = file.replace(/\.md$/, "");
          return {
            name: fallbackName,
            description: `Agent: ${fallbackName}`,
            prompt: (content as string).trim(),
            source,
          } satisfies ClaudeAgent;
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
          prompt: body.trim(),
          tools: parseClaudeStringList(frontmatter.tools, {
            allowCommaSeparated: true,
          }),
          disallowedTools: parseClaudeStringList(frontmatter.disallowedTools ?? frontmatter["disallowed-tools"], {
            allowCommaSeparated: true,
          }),
          model: parseClaudeAgentModel(frontmatter.model),
          mcpServers: parseClaudeAgentMcpServers(
            frontmatter["mcp-servers"] ?? frontmatter.mcpServers,
          ),
          skills: parseClaudeStringList(frontmatter.skills, {
            allowCommaSeparated: true,
          }),
          maxTurns:
            typeof frontmatter.maxTurns === "number"
              ? frontmatter.maxTurns
              : typeof frontmatter["max-turns"] === "number"
                ? frontmatter["max-turns"]
                : undefined,
          criticalSystemReminder_EXPERIMENTAL:
            typeof frontmatter.criticalSystemReminder_EXPERIMENTAL === "string"
              ? frontmatter.criticalSystemReminder_EXPERIMENTAL
              : typeof frontmatter["critical-system-reminder"] === "string"
                ? frontmatter["critical-system-reminder"]
                : undefined,
          source,
        } satisfies ClaudeAgent;
      });
    const agentResults = await Promise.allSettled(agentPromises);

    return agentResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<ClaudeAgent> =>
          result.status === "fulfilled",
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
): Promise<ClaudeAgent[]> {
  const plan = resolveClaudeArtifactPlan(options);
  const cacheKey = `claude:agents:loaded:${serializeDiscoveryPlanRoots(plan)}`;
  const cachedAgents = getProviderDiscoverySessionCacheValue<ClaudeAgent[]>(cacheKey, {
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
      loadClaudeAgentsFromDir(dir, source, fsOps),
    ),
  );

  const mergedAgents = new Map<string, ClaudeAgent>();
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
