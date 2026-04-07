/**
 * Workflow CLI command
 *
 * Usage:
 *   atomic workflow -n <name> -a <agent> <prompt>
 *   atomic workflow --list
 */

import { AGENT_CONFIG, type AgentKey } from "@/services/config/index.ts";
import { COLORS } from "@/theme/colors.ts";
import { isCommandInstalled } from "@/services/system/detect.ts";
import { ensureTmuxInstalled, ensureBunInstalled } from "../../lib/spawn.ts";
import {
  isTmuxInstalled,
  discoverWorkflows,
  findWorkflow,
  loadWorkflowDefinition,
  executeWorkflow,
  resetMuxBinaryCache,
} from "@bastani/atomic-workflows";
import type { AgentType } from "@bastani/atomic-workflows";

export async function workflowCommand(options: {
  name?: string;
  agent?: string;
  prompt?: string;
  list?: boolean;
}): Promise<number> {
  // List mode
  if (options.list) {
    const workflows = await discoverWorkflows(undefined, options.agent as AgentType | undefined);

    if (workflows.length === 0) {
      console.log("No workflows found.");
      console.log("Create a workflow in .atomic/workflows/<agent>/<name>/index.ts");
      return 0;
    }

    console.log("Available workflows:\n");
    for (const wf of workflows) {
      const badge = wf.source === "local" ? "(local)" : "(global)";
      console.log(`  ${wf.agent}/${wf.name} ${COLORS.dim}${badge}${COLORS.reset}`);
      console.log(`    ${COLORS.dim}${wf.path}${COLORS.reset}`);
    }
    return 0;
  }

  // Run mode — validate inputs
  if (!options.name) {
    console.error(`${COLORS.red}Error: Missing workflow name. Use -n <name>.${COLORS.reset}`);
    return 1;
  }

  if (!options.agent) {
    console.error(`${COLORS.red}Error: Missing agent. Use -a <agent>.${COLORS.reset}`);
    return 1;
  }

  const validAgents = Object.keys(AGENT_CONFIG);
  if (!validAgents.includes(options.agent)) {
    console.error(`${COLORS.red}Error: Unknown agent '${options.agent}'.${COLORS.reset}`);
    console.error(`Valid agents: ${validAgents.join(", ")}`);
    return 1;
  }

  const agent = options.agent as AgentKey;

  // Check agent CLI is installed
  if (!isCommandInstalled(AGENT_CONFIG[agent].cmd)) {
    console.error(`${COLORS.red}Error: '${AGENT_CONFIG[agent].cmd}' is not installed.${COLORS.reset}`);
    console.error(`Install it from: ${AGENT_CONFIG[agent].install_url}`);
    return 1;
  }

  // Ensure tmux/psmux is installed
  if (!isTmuxInstalled()) {
    console.log("Terminal multiplexer not found. Installing...");
    try {
      await ensureTmuxInstalled();
      resetMuxBinaryCache();
    } catch {
      // Installation attempt failed — fall through to check below
    }
    if (!isTmuxInstalled()) {
      const isWin = process.platform === "win32";
      console.error(`${COLORS.red}Error: ${isWin ? "psmux" : "tmux"} is not installed.${COLORS.reset}`);
      console.error(
        isWin
          ? "Install psmux: https://github.com/psmux/psmux#installation"
          : "Install tmux: https://github.com/tmux/tmux/wiki/Installing",
      );
      return 1;
    }
  }

  // Ensure bun is installed (required for workflow execution)
  if (!Bun.which("bun")) {
    console.log("Bun runtime not found. Installing...");
    try {
      await ensureBunInstalled();
    } catch {
      // Installation attempt failed — fall through to check below
    }
    if (!Bun.which("bun")) {
      console.error(`${COLORS.red}Error: bun is not installed.${COLORS.reset}`);
      console.error("Install bun: https://bun.sh");
      return 1;
    }
  }

  // Find the workflow
  const discovered = await findWorkflow(options.name, agent);

  if (!discovered) {
    console.error(`${COLORS.red}Error: Workflow '${options.name}' not found for agent '${agent}'.${COLORS.reset}`);
    console.error(`\nExpected location:`);
    console.error(`  .atomic/workflows/${agent}/${options.name}/index.ts  ${COLORS.dim}(local)${COLORS.reset}`);
    console.error(`  ~/.atomic/workflows/${agent}/${options.name}/index.ts ${COLORS.dim}(global)${COLORS.reset}`);

    const available = await discoverWorkflows(undefined, agent);
    if (available.length > 0) {
      console.error(`\nAvailable ${agent} workflows:`);
      for (const wf of available) {
        console.error(`  ${COLORS.dim}•${COLORS.reset} ${wf.name} ${COLORS.dim}(${wf.source})${COLORS.reset}`);
      }
    }

    return 1;
  }

  // Load and validate
  let definition;
  try {
    definition = await loadWorkflowDefinition(discovered.path, agent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${COLORS.red}Error loading workflow: ${message}${COLORS.reset}`);
    return 1;
  }

  // Execute
  try {
    await executeWorkflow({
      definition,
      agent,
      prompt: options.prompt ?? "",
      workflowFile: discovered.path,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${COLORS.red}Workflow failed: ${message}${COLORS.reset}`);
    return 1;
  }
}
