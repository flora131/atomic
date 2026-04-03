/**
 * Agent Resolution for Workflow Stages
 *
 * Resolves agent definition files for workflow stages at compile time.
 * Each stage ID is matched against discovered agent names; the agent
 * file's body (markdown content after frontmatter) becomes the stage
 * session's system prompt.
 */

import { readFileSync } from "fs";
import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";
import {
  discoverAgentInfos,
  type AgentInfo,
} from "@/services/agent-discovery/index.ts";

/**
 * Read the `model` field from an agent definition file's frontmatter.
 *
 * Each SDK has its own agent directory (`.claude/agents/`,
 * `.opencode/agents/`, `.github/agents/`) with SDK-appropriate model
 * values. The discovery system resolves the correct file; this function
 * simply extracts the `model` string as-is.
 *
 * Returns the model string if present and non-empty, or null otherwise.
 */
export function readAgentFrontmatterModel(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);
    if (!parsed) return null;
    const model = parsed.frontmatter.model;
    return typeof model === "string" && model.trim().length > 0
      ? model.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Read the body (system prompt) from an agent definition file.
 * Returns the markdown content after the frontmatter block.
 */
export function readAgentBody(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);
    const body = parsed ? parsed.body.trim() : content.trim();
    return body.length > 0 ? body : null;
  } catch {
    return null;
  }
}

/**
 * Cached agent lookup — agent files are static within a single process
 * run, so we avoid re-scanning and re-parsing them on every call.
 */
let cachedAgentLookup: Map<string, AgentInfo> | null = null;

/**
 * Build a lookup map of discovered agent names to their AgentInfo.
 * Used at compile time to validate and resolve stage agents.
 * Results are cached for the lifetime of the process.
 */
export function buildAgentLookup(): Map<string, AgentInfo> {
  if (cachedAgentLookup) return cachedAgentLookup;
  const agents = discoverAgentInfos();
  const lookup = new Map<string, AgentInfo>();
  for (const agent of agents) {
    lookup.set(agent.name.toLowerCase(), agent);
  }
  cachedAgentLookup = lookup;
  return lookup;
}

/**
 * Clear the cached agent lookup. Useful in tests or when agent
 * definition files may have changed on disk.
 */
export function clearAgentLookupCache(): void {
  cachedAgentLookup = null;
}

/**
 * Validate that all stage IDs in the instruction list correspond to
 * discovered agent definitions. Returns an array of error messages
 * for unmatched stages (empty if all stages match).
 */
export function validateStageAgents(
  stageIds: readonly string[],
  agentLookup: Map<string, AgentInfo>,
): string[] {
  const errors: string[] = [];
  const availableNames = Array.from(agentLookup.keys()).sort();

  for (const stageId of stageIds) {
    if (!agentLookup.has(stageId.toLowerCase())) {
      const suggestion = availableNames.length > 0
        ? ` Available agents: ${availableNames.join(", ")}`
        : " No agent definitions found in any discovery path.";
      errors.push(
        `Stage "${stageId}" has no matching agent definition file.${suggestion}`,
      );
    }
  }

  return errors;
}

/**
 * Resolve the system prompt for a stage by reading its matched agent
 * definition file. Returns the body text, or null if the agent has
 * no body content.
 */
export function resolveStageSystemPrompt(
  stageId: string,
  agentLookup: Map<string, AgentInfo>,
): string | null {
  const agent = agentLookup.get(stageId.toLowerCase());
  if (!agent) return null;
  return readAgentBody(agent.filePath);
}

/**
 * Resolve the model from an agent definition file's frontmatter.
 * Returns the model string, or null if the agent has no model field.
 */
export function resolveStageAgentModel(
  stageId: string,
  agentLookup: Map<string, AgentInfo>,
): string | null {
  const agent = agentLookup.get(stageId.toLowerCase());
  if (!agent) return null;
  return readAgentFrontmatterModel(agent.filePath);
}
