import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseMarkdownFrontmatter } from "../ui/commands/agent-commands";

/**
 * Represents a Copilot agent configuration parsed from manual format.
 */
export interface CopilotAgent {
  /** The name of the agent */
  name: string;
  /** Description of what the agent does */
  description: string;
  /** Optional list of tool names this agent can use */
  tools?: string[];
  /** The system prompt for the agent */
  systemPrompt: string;
  /** Where the agent was loaded from */
  source: "local" | "global";
}

/**
 * Load agents from a directory containing .md files.
 * Each markdown file should have frontmatter with agent configuration.
 *
 * @param agentsDir - Path to directory containing agent .md files
 * @param source - Whether agents are 'local' (project) or 'global' (user)
 * @returns Array of parsed CopilotAgent objects
 */
export async function loadAgentsFromDir(
  agentsDir: string,
  source: "local" | "global"
): Promise<CopilotAgent[]> {
  try {
    const files = await fs.readdir(agentsDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    const agents: CopilotAgent[] = [];

    for (const file of mdFiles) {
      try {
        const filePath = path.join(agentsDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = parseMarkdownFrontmatter(content);

        if (!parsed) {
          // No frontmatter, use file content as system prompt
          agents.push({
            name: file.replace(/\.md$/, ""),
            description: `Agent: ${file.replace(/\.md$/, "")}`,
            systemPrompt: content.trim(),
            source,
          });
          continue;
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
          ? (frontmatter.tools.filter(
              (t): t is string => typeof t === "string"
            ) as string[])
          : undefined;

        agents.push({
          name,
          description,
          tools,
          systemPrompt: body.trim(),
          source,
        });
      } catch {
        // Skip files we can't read or parse
        continue;
      }
    }

    return agents;
  } catch {
    // Return empty array if directory doesn't exist or can't be read
    return [];
  }
}

/**
 * Load all Copilot agents from both local and global directories.
 * Local agents (project-specific) override global agents with the same name.
 *
 * @param projectRoot - Path to the project root directory
 * @returns Array of CopilotAgent objects with local taking priority over global
 */
export async function loadCopilotAgents(
  projectRoot: string
): Promise<CopilotAgent[]> {
  const localDir = path.join(projectRoot, ".github", "agents");
  const globalDir = path.join(os.homedir(), ".copilot", "agents");

  // Map for deduplication - lowercase name as key for case-insensitive matching
  const agentMap = new Map<string, CopilotAgent>();

  // Load global agents first (lower priority)
  const globalAgents = await loadAgentsFromDir(globalDir, "global");
  for (const agent of globalAgents) {
    agentMap.set(agent.name.toLowerCase(), agent);
  }

  // Load local agents (override global with same name)
  const localAgents = await loadAgentsFromDir(localDir, "local");
  for (const agent of localAgents) {
    agentMap.set(agent.name.toLowerCase(), agent);
  }

  return Array.from(agentMap.values());
}

/**
 * Load Copilot instructions from either local or global configuration.
 * Local instructions (.github/copilot-instructions.md) take priority over global (~/.copilot/copilot-instructions.md).
 *
 * @param projectRoot - Path to the project root directory
 * @returns The instructions content or null if not found
 */
export async function loadCopilotInstructions(
  projectRoot: string
): Promise<string | null> {
  const localPath = path.join(projectRoot, ".github", "copilot-instructions.md");
  const globalPath = path.join(os.homedir(), ".copilot", "copilot-instructions.md");

  // Try local first (higher priority)
  try {
    return await fs.readFile(localPath, "utf-8");
  } catch {
    // Local not found, try global
  }

  // Try global
  try {
    return await fs.readFile(globalPath, "utf-8");
  } catch {
    // Neither found
    return null;
  }
}
