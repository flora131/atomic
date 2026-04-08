/**
 * Workflow CLI command
 *
 * Usage:
 *   atomic workflow -n <name> -a <agent> <prompt>
 *   atomic workflow --list
 */

import { join, resolve, relative } from "path";
import { existsSync } from "fs";
import { AGENT_CONFIG, type AgentKey } from "@/services/config/index.ts";
import { COLORS } from "@/theme/colors.ts";
import { isCommandInstalled } from "@/services/system/detect.ts";
import { ensureTmuxInstalled, ensureBunInstalled } from "../../lib/spawn.ts";
import { VERSION } from "@/version.ts";
import { detectInstallationType } from "@/services/config/config-path.ts";
import {
  isTmuxInstalled,
  discoverWorkflows,
  findWorkflow,
  loadWorkflowDefinition,
  executeWorkflow,
  resetMuxBinaryCache,
} from "@bastani/atomic-workflows";
import type { AgentType } from "@bastani/atomic-workflows";

/**
 * Ensure the workflow-sdk (and its transitive SDK deps) is installed at the
 * correct spec in the workflow directory that contains the discovered
 * workflow file. Writes the pinned version (or file: reference for dev
 * installs) into `package.json` and runs `bun install` so that
 * `@github/copilot-sdk`, `@opencode-ai/sdk`, etc. are available as
 * hoisted transitive dependencies.
 *
 * For source/dev installations:
 *   - local (.atomic/workflows): uses a file: reference to the workspace SDK
 *   - global (~/.atomic/workflows): skipped entirely
 * For binary/npm installations:
 *   - both local and global: pinned to the exact running CLI version
 */
async function ensureWorkflowDeps(
  workflowDir: string,
  source: "local" | "global",
): Promise<void> {
  const pkgPath = join(workflowDir, "package.json");
  const pkgFile = Bun.file(pkgPath);

  if (!(await pkgFile.exists())) return;

  const installType = detectInstallationType();

  // For source/dev installations, never touch global workflows
  if (installType === "source" && source === "global") return;

  // Determine the desired dependency spec
  let desiredSpec: string;
  if (installType === "source") {
    // Use a file: reference to the workspace workflow-sdk package
    const sdkPath = resolve(workflowDir, "..", "..", "packages", "workflow-sdk");
    if (!existsSync(sdkPath)) return;
    desiredSpec = `file:${relative(workflowDir, sdkPath)}`;
  } else {
    desiredSpec = VERSION;
  }

  const pkg = await pkgFile.json();
  const currentSpec = pkg.dependencies?.["@bastani/atomic-workflows"];

  // Already set to the desired spec — skip install
  if (currentSpec === desiredSpec) return;

  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies["@bastani/atomic-workflows"] = desiredSpec;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const bunPath = Bun.which("bun");
  if (!bunPath) return;

  const proc = Bun.spawn([bunPath, "install"], {
    cwd: workflowDir,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Failed to install workflow dependencies (exit ${exitCode}):\n${stderr.trim()}`,
    );
  }
}

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
      console.log("Create a workflow in .atomic/workflows/<name>/<agent>/index.ts");
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
    console.error(`  .atomic/workflows/${options.name}/${agent}/index.ts  ${COLORS.dim}(local)${COLORS.reset}`);
    console.error(`  ~/.atomic/workflows/${options.name}/${agent}/index.ts ${COLORS.dim}(global)${COLORS.reset}`);

    const available = await discoverWorkflows(undefined, agent);
    if (available.length > 0) {
      console.error(`\nAvailable ${agent} workflows:`);
      for (const wf of available) {
        console.error(`  ${COLORS.dim}•${COLORS.reset} ${wf.name} ${COLORS.dim}(${wf.source})${COLORS.reset}`);
      }
    }

    return 1;
  }

  // Ensure workflow SDK deps are installed at the correct version in both
  // local (.atomic/workflows) and global (~/.atomic/workflows) directories.
  // For dev installs, only the local dir is updated (with a file: reference);
  // the global dir is left untouched.
  const { homedir } = await import("os");
  const localWorkflowDir = join(process.cwd(), ".atomic", "workflows");
  const globalWorkflowDir = join(homedir(), ".atomic", "workflows");
  const workflowDirs: Array<[string, "local" | "global"]> = [
    [localWorkflowDir, "local"],
    [globalWorkflowDir, "global"],
  ];
  for (const [dir, source] of workflowDirs) {
    try {
      await ensureWorkflowDeps(dir, source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${COLORS.red}Error installing workflow dependencies in ${dir}: ${message}${COLORS.reset}`);
      return 1;
    }
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
