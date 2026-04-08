/**
 * Workflow discovery — finds workflow definitions from disk.
 *
 * Workflows are discovered from:
 *   1. .atomic/workflows/<name>/<agent>/index.ts (project-local)
 *   2. ~/.atomic/workflows/<name>/<agent>/index.ts (global)
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

const AGENTS: AgentType[] = ["copilot", "opencode", "claude"];
const AGENT_SET = new Set<string>(AGENTS);

/**
 * Discover workflows from a base directory by scanning workflow-name
 * directories first, then agent subdirectories within each.
 *
 * Layout: baseDir/<workflow_name>/<agent>/index.ts
 */
async function discoverFromBaseDir(
  baseDir: string,
  source: "local" | "global",
  agentFilter?: AgentType
): Promise<DiscoveredWorkflow[]> {
  const workflows: DiscoveredWorkflow[] = [];
  const agents = agentFilter ? [agentFilter] : AGENTS;
  const agentNames = new Set<string>(agents);

  let workflowEntries;
  try {
    workflowEntries = await readdir(baseDir, { withFileTypes: true });
  } catch {
    return workflows;
  }

  for (const wfEntry of workflowEntries) {
    if (!wfEntry.isDirectory()) continue;
    if (wfEntry.name.startsWith(".") || wfEntry.name === "node_modules") continue;
    // Skip agent-named directories at root (they are not workflow names)
    if (AGENT_SET.has(wfEntry.name)) continue;

    const workflowDir = join(baseDir, wfEntry.name);

    let agentEntries;
    try {
      agentEntries = await readdir(workflowDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const agentEntry of agentEntries) {
      if (!agentEntry.isDirectory()) continue;
      if (!agentNames.has(agentEntry.name)) continue;

      const indexPath = join(workflowDir, agentEntry.name, "index.ts");
      const file = Bun.file(indexPath);
      if (await file.exists()) {
        workflows.push({
          name: wfEntry.name,
          agent: agentEntry.name as AgentType,
          path: indexPath,
          source,
        });
      }
    }
  }

  return workflows;
}

/**
 * Discover all available workflows from local and global directories.
 * Optionally filter by agent. Local workflows take precedence over global.
 */
export async function discoverWorkflows(
  projectRoot: string = process.cwd(),
  agentFilter?: AgentType
): Promise<DiscoveredWorkflow[]> {
  const localDir = getLocalWorkflowsDir(projectRoot);
  const globalDir = getGlobalWorkflowsDir();

  const [globalResults, localResults] = await Promise.all([
    discoverFromBaseDir(globalDir, "global", agentFilter),
    discoverFromBaseDir(localDir, "local", agentFilter),
  ]);

  const byKey = new Map<string, DiscoveredWorkflow>();
  for (const wf of globalResults) {
    byKey.set(`${wf.agent}/${wf.name}`, wf);
  }
  for (const wf of localResults) {
    byKey.set(`${wf.agent}/${wf.name}`, wf);
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
