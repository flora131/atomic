import defaultFs from "node:fs/promises";
import path from "node:path";
import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";
import type { McpServerConfig } from "@/services/agents/types.ts";

export interface RuntimeAgentDefinition {
  name: string;
  description: string;
  displayName?: string;
  tools?: string[];
  mcpServers?: McpServerConfig[];
  infer?: boolean;
  systemPrompt: string;
  source: "local" | "global";
}

export interface AgentDefinitionFsOps {
  readdir: typeof defaultFs.readdir;
  readFile: typeof defaultFs.readFile;
}

export const defaultAgentDefinitionFsOps: AgentDefinitionFsOps = {
  readdir: defaultFs.readdir,
  readFile: defaultFs.readFile,
};

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

function parseAgentMcpServers(value: unknown): McpServerConfig[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const servers: McpServerConfig[] = [];
  for (const [name, rawConfig] of Object.entries(value)) {
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      continue;
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

    servers.push({
      name,
      type: normalizedType,
      command:
        typeof config.command === "string" ? config.command : undefined,
      args: Array.isArray(config.args)
        ? config.args.filter((arg): arg is string => typeof arg === "string")
        : undefined,
      env: parseStringRecord(config.env),
      url: typeof config.url === "string" ? config.url : undefined,
      headers: parseStringRecord(config.headers),
      cwd: typeof config.cwd === "string" ? config.cwd : undefined,
      timeout: typeof config.timeout === "number" ? config.timeout : undefined,
      enabled:
        typeof config.enabled === "boolean" ? config.enabled : undefined,
      tools: Array.isArray(config.tools)
        ? config.tools.filter((tool): tool is string => typeof tool === "string")
        : undefined,
    });
  }

  return servers.length > 0 ? servers : undefined;
}

/**
 * Load markdown-backed agent definitions from a single config directory.
 * Missing or unreadable directories are treated as empty.
 */
export async function loadAgentDefinitionsFromDir(
  agentsDir: string,
  source: "local" | "global",
  fsOps: AgentDefinitionFsOps = defaultAgentDefinitionFsOps,
): Promise<RuntimeAgentDefinition[]> {
  try {
    const files = await fsOps.readdir(agentsDir);
    const markdownFiles = (files as string[]).filter((file) => file.endsWith(".md"));

    const agentResults = await Promise.allSettled(
      markdownFiles.map(async (file) => {
        const filePath = path.join(agentsDir, file);
        const content = await fsOps.readFile(filePath, "utf-8");
        const parsed = parseMarkdownFrontmatter(content as string);

        if (!parsed) {
          const fallbackName = file.replace(/\.md$/, "");
          return {
            name: fallbackName,
            description: `Agent: ${fallbackName}`,
            systemPrompt: (content as string).trim(),
            source,
          } satisfies RuntimeAgentDefinition;
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
        const displayName =
          typeof frontmatter.displayName === "string"
            ? frontmatter.displayName
            : typeof frontmatter["display-name"] === "string"
              ? frontmatter["display-name"]
              : undefined;
        const tools = Array.isArray(frontmatter.tools)
          ? frontmatter.tools.filter(
              (tool): tool is string => typeof tool === "string",
            )
          : undefined;
        const mcpServers = parseAgentMcpServers(
          frontmatter["mcp-servers"] ?? frontmatter.mcpServers,
        );
        const infer =
          typeof frontmatter.infer === "boolean"
            ? frontmatter.infer
            : undefined;

        return {
          name,
          description,
          displayName,
          tools,
          mcpServers,
          infer,
          systemPrompt: body.trim(),
          source,
        } satisfies RuntimeAgentDefinition;
      }),
    );

    return agentResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<RuntimeAgentDefinition> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
  } catch {
    return [];
  }
}
