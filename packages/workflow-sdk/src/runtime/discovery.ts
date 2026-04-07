/**
 * Workflow discovery — finds workflow definitions from disk.
 *
 * Workflows are discovered from:
 *   1. .atomic/workflows/<agent>/<name>/index.ts (project-local)
 *   2. ~/.atomic/workflows/<agent>/<name>/index.ts (global)
 *
 * Project-local workflows take precedence over global ones with the same name.
 */

import { join } from "path";
import { readdir } from "fs/promises";
import { homedir } from "os";
import type { WorkflowDefinition, AgentType } from "../types.ts";
import { validateCopilotWorkflow } from "../providers/copilot.ts";
import { validateOpenCodeWorkflow } from "../providers/opencode.ts";
import { validateClaudeWorkflow } from "../providers/claude.ts";

export interface DiscoveredWorkflow {
  name: string;
  agent: AgentType;
  path: string;
  source: "local" | "global";
}

function getLocalWorkflowsDir(projectRoot: string): string {
  return join(projectRoot, ".atomic", "workflows");
}

function getGlobalWorkflowsDir(): string {
  return join(homedir(), ".atomic", "workflows");
}

async function discoverFromAgentDir(
  baseDir: string,
  agent: AgentType,
  source: "local" | "global"
): Promise<DiscoveredWorkflow[]> {
  const agentDir = join(baseDir, agent);
  const workflows: DiscoveredWorkflow[] = [];

  try {
    const entries = await readdir(agentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const indexPath = join(agentDir, entry.name, "index.ts");
      const file = Bun.file(indexPath);
      if (await file.exists()) {
        workflows.push({
          name: entry.name,
          agent,
          path: indexPath,
          source,
        });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return workflows;
}

const AGENTS: AgentType[] = ["copilot", "opencode", "claude"];

/**
 * Discover all available workflows from local and global directories.
 * Optionally filter by agent. Local workflows take precedence over global.
 */
export async function discoverWorkflows(
  projectRoot: string = process.cwd(),
  agentFilter?: AgentType
): Promise<DiscoveredWorkflow[]> {
  const agents = agentFilter ? [agentFilter] : AGENTS;
  const localDir = getLocalWorkflowsDir(projectRoot);
  const globalDir = getGlobalWorkflowsDir();

  const results = await Promise.all(
    agents.flatMap((agent) => [
      discoverFromAgentDir(globalDir, agent, "global"),
      discoverFromAgentDir(localDir, agent, "local"),
    ])
  );

  const byKey = new Map<string, DiscoveredWorkflow>();
  for (const batch of results) {
    for (const wf of batch) {
      const key = `${wf.agent}/${wf.name}`;
      if (!byKey.has(key) || wf.source === "local") {
        byKey.set(key, wf);
      }
    }
  }

  return Array.from(byKey.values());
}

/**
 * Find a specific workflow by name and agent.
 */
export async function findWorkflow(
  name: string,
  agent: AgentType,
  projectRoot: string = process.cwd()
): Promise<DiscoveredWorkflow | null> {
  const all = await discoverWorkflows(projectRoot, agent);
  return all.find((w) => w.name === name) ?? null;
}

/**
 * Import a workflow definition from disk.
 * When `agent` is provided, runs agent-specific source validation before import.
 */
export async function loadWorkflowDefinition(
  path: string,
  agent?: AgentType,
): Promise<WorkflowDefinition> {
  if (agent) {
    const source = await Bun.file(path).text();
    const warnings = validateWorkflowSource(source, agent);
    for (const w of warnings) {
      console.warn(`⚠ [${w.rule}] ${w.message}`);
    }
  }

  const mod = await import(path);
  const definition = mod.default ?? mod;

  if (!definition || definition.__brand !== "WorkflowDefinition") {
    if (definition && definition.__brand === "WorkflowBuilder") {
      throw new Error(
        `Workflow at ${path} was defined but not compiled.\n` +
        `  Add .compile() at the end of your defineWorkflow() chain:\n\n` +
        `    export default defineWorkflow({ ... })\n` +
        `      .session({ ... })\n` +
        `      .compile();`,
      );
    }

    throw new Error(
      `${path} does not export a valid WorkflowDefinition.\n` +
      `  Make sure it exports defineWorkflow(...).compile() as the default export.`,
    );
  }

  return definition as WorkflowDefinition;
}

function validateWorkflowSource(source: string, agent: AgentType) {
  switch (agent) {
    case "copilot":
      return validateCopilotWorkflow(source);
    case "opencode":
      return validateOpenCodeWorkflow(source);
    case "claude":
      return validateClaudeWorkflow(source);
    default:
      return [];
  }
}
