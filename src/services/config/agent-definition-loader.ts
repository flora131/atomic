import defaultFs from "node:fs/promises";
import path from "node:path";
import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";

export interface RuntimeAgentDefinition {
  name: string;
  description: string;
  tools?: string[];
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
        const tools = Array.isArray(frontmatter.tools)
          ? frontmatter.tools.filter(
              (tool): tool is string => typeof tool === "string",
            )
          : undefined;

        return {
          name,
          description,
          tools,
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
