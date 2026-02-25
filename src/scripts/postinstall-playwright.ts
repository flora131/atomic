import { mkdir } from "fs/promises";
import { join } from "path";

import { AGENT_CONFIG, type AgentKey } from "../config";
import {
  getAtomicGlobalAgentFolder,
  getAtomicHomeDir,
  getTemplateAgentFolder,
} from "../utils/atomic-global-config";
import { copyFile, pathExists } from "../utils/copy";

const PLAYWRIGHT_SKILL_RELATIVE_PATH = join("skills", "playwright-cli", "SKILL.md");
const PLAYWRIGHT_CLI_PACKAGE = "@playwright/cli@latest";

function decodeSpawnOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}

export async function installPlaywrightCli(): Promise<void> {
  const installResult = Bun.spawnSync({
    cmd: [process.execPath, "install", "-g", PLAYWRIGHT_CLI_PACKAGE],
    stdout: "ignore",
    stderr: "pipe",
  });

  if (installResult.success) {
    return;
  }

  const stderr = decodeSpawnOutput(installResult.stderr);
  const details = stderr.length > 0 ? stderr : "No stderr output from Bun.";
  throw new Error(`Failed to install ${PLAYWRIGHT_CLI_PACKAGE}: ${details}`);
}

export async function deployPlaywrightSkill(
  configRoot: string,
  atomicHomeDir: string = getAtomicHomeDir()
): Promise<void> {
  const agentKeys = Object.keys(AGENT_CONFIG) as AgentKey[];
  const missingSkillTemplates: string[] = [];

  for (const agentKey of agentKeys) {
    const sourceSkillPath = join(
      configRoot,
      getTemplateAgentFolder(agentKey),
      PLAYWRIGHT_SKILL_RELATIVE_PATH
    );

    if (!(await pathExists(sourceSkillPath))) {
      missingSkillTemplates.push(sourceSkillPath);
      continue;
    }

    const destinationAgentFolder = join(atomicHomeDir, getAtomicGlobalAgentFolder(agentKey));
    const destinationSkillDir = join(destinationAgentFolder, "skills", "playwright-cli");
    await mkdir(destinationSkillDir, { recursive: true });

    const destinationSkillPath = join(destinationSkillDir, "SKILL.md");
    await copyFile(sourceSkillPath, destinationSkillPath);
  }

  if (missingSkillTemplates.length > 0) {
    throw new Error(
      `Missing Playwright skill template(s): ${missingSkillTemplates.join(", ")}`
    );
  }
}
