import defaultFs from "fs/promises";
import path from "path";
import os from "os";
import { parseMarkdownFrontmatter } from "../utils/markdown.ts";

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
 * File system operations interface for dependency injection.
 * Allows testing with mock implementations.
 */
export interface FsOps {
  readdir: typeof defaultFs.readdir;
  readFile: typeof defaultFs.readFile;
}

/** Default fs operations using Node.js fs/promises */
export const defaultFsOps: FsOps = {
  readdir: defaultFs.readdir,
  readFile: defaultFs.readFile,
};

/**
 * Load agents from a directory containing .md files.
 * Each markdown file should have frontmatter with agent configuration.
 *
 * @param agentsDir - Path to directory containing agent .md files
 * @param source - Whether agents are 'local' (project) or 'global' (user)
 * @param fsOps - Optional fs operations for testing (defaults to Node.js fs/promises)
 * @returns Array of parsed CopilotAgent objects
 */
export async function loadAgentsFromDir(
  agentsDir: string,
  source: "local" | "global",
  fsOps: FsOps = defaultFsOps
): Promise<CopilotAgent[]> {
  try {
    const files = await fsOps.readdir(agentsDir);
    const mdFiles = (files as string[]).filter((f) => f.endsWith(".md"));

    const agents: CopilotAgent[] = [];

    for (const file of mdFiles) {
      try {
        const filePath = path.join(agentsDir, file);
        const content = await fsOps.readFile(filePath, "utf-8");
        const parsed = parseMarkdownFrontmatter(content as string);

        if (!parsed) {
          // No frontmatter, use file content as system prompt
          agents.push({
            name: file.replace(/\.md$/, ""),
            description: `Agent: ${file.replace(/\.md$/, "")}`,
            systemPrompt: (content as string).trim(),
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
 * @param fsOps - Optional fs operations for testing (defaults to Node.js fs/promises)
 * @returns Array of CopilotAgent objects with local taking priority over global
 */
export async function loadCopilotAgents(
  projectRoot: string,
  fsOps: FsOps = defaultFsOps
): Promise<CopilotAgent[]> {
  const HOME = os.homedir();
  const ATOMIC_HOME = path.join(HOME, ".atomic");

  // All agent directories in priority order (later entries override earlier for same name)
  const agentDirs: Array<{ dir: string; source: "global" | "local" }> = [
    // Atomic-managed global directories (lowest priority)
    { dir: path.join(ATOMIC_HOME, ".copilot", "agents"), source: "global" },
    { dir: path.join(ATOMIC_HOME, ".claude", "agents"), source: "global" },
    { dir: path.join(ATOMIC_HOME, ".opencode", "agents"), source: "global" },
    // Legacy global directories
    { dir: path.join(HOME, ".copilot", "agents"), source: "global" },
    { dir: path.join(HOME, ".claude", "agents"), source: "global" },
    { dir: path.join(HOME, ".opencode", "agents"), source: "global" },
    // Project-local directories (highest priority)
    { dir: path.join(projectRoot, ".github", "agents"), source: "local" },
    { dir: path.join(projectRoot, ".claude", "agents"), source: "local" },
    { dir: path.join(projectRoot, ".opencode", "agents"), source: "local" },
  ];

  // Map for deduplication - lowercase name as key for case-insensitive matching
  const agentMap = new Map<string, CopilotAgent>();

  for (const { dir, source } of agentDirs) {
    const agents = await loadAgentsFromDir(dir, source, fsOps);
    for (const agent of agents) {
      agentMap.set(agent.name.toLowerCase(), agent);
    }
  }

  return Array.from(agentMap.values());
}

/**
 * Load Copilot instructions from either local or global configuration.
 * Local instructions (.github/copilot-instructions.md) take priority over global (~/.copilot/copilot-instructions.md).
 *
 * @param projectRoot - Path to the project root directory
 * @param fsOps - Optional fs operations for testing (defaults to Node.js fs/promises)
 * @returns The instructions content or null if not found
 */
export async function loadCopilotInstructions(
  projectRoot: string,
  fsOps: FsOps = defaultFsOps
): Promise<string | null> {
  const localPath = path.join(projectRoot, ".github", "copilot-instructions.md");
  const globalPath = path.join(os.homedir(), ".copilot", "copilot-instructions.md");
  const atomicGlobalPath = path.join(os.homedir(), ".atomic", ".copilot", "copilot-instructions.md");

  // Try local first (higher priority)
  try {
    return (await fsOps.readFile(localPath, "utf-8")) as string;
  } catch {
    // Local not found, try global
  }

  // Try global
  try {
    return (await fsOps.readFile(globalPath, "utf-8")) as string;
  } catch {
    // Global not found, try Atomic-managed global path
  }

  try {
    return (await fsOps.readFile(atomicGlobalPath, "utf-8")) as string;
  } catch {
    // Neither found
    return null;
  }
}
