import { mkdir, readdir, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

import { AGENT_CONFIG, type AgentKey } from "../config";
import { copyDir, pathExists } from "./copy";

const ATOMIC_HOME_DIR = join(homedir(), ".atomic");

export const MANAGED_SCM_SKILL_PREFIXES = ["gh-", "sl-"] as const;

const GLOBAL_AGENT_FOLDER_BY_KEY: Record<AgentKey, string> = {
  claude: ".claude",
  opencode: ".opencode",
  copilot: ".copilot",
};

const TEMPLATE_AGENT_FOLDER_BY_KEY: Record<AgentKey, string> = {
  claude: AGENT_CONFIG.claude.folder,
  opencode: AGENT_CONFIG.opencode.folder,
  // Copilot templates are sourced from .github but synced globally to ~/.atomic/.copilot
  copilot: AGENT_CONFIG.copilot.folder,
};

const REQUIRED_GLOBAL_CONFIG_ENTRIES: Record<AgentKey, string[]> = {
  claude: ["agents", "skills", "settings.json"],
  opencode: ["agents", "skills", "opencode.json"],
  copilot: ["agents", "skills"],
};

/**
 * Return the Atomic home directory used for global workflows/tools/settings.
 */
export function getAtomicHomeDir(): string {
  return ATOMIC_HOME_DIR;
}

/**
 * Get Atomic-managed global config directories in ~/.atomic.
 */
export function getAtomicManagedConfigDirs(baseDir: string = ATOMIC_HOME_DIR): string[] {
  return [
    join(baseDir, GLOBAL_AGENT_FOLDER_BY_KEY.claude),
    join(baseDir, GLOBAL_AGENT_FOLDER_BY_KEY.opencode),
    join(baseDir, GLOBAL_AGENT_FOLDER_BY_KEY.copilot),
  ];
}

/**
 * Get the global ~/.atomic folder for the given agent.
 */
export function getAtomicGlobalAgentFolder(agentKey: AgentKey): string {
  return GLOBAL_AGENT_FOLDER_BY_KEY[agentKey];
}

/**
 * Get the bundled template folder for the given agent.
 */
export function getTemplateAgentFolder(agentKey: AgentKey): string {
  return TEMPLATE_AGENT_FOLDER_BY_KEY[agentKey];
}

/**
 * Return true when a skill name is one of Atomic's SCM-managed variants.
 */
export function isManagedScmSkillName(name: string): boolean {
  return MANAGED_SCM_SKILL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Remove all managed SCM skill variants (gh-*, sl-*) from a destination agent folder.
 */
async function pruneManagedScmSkills(agentDir: string): Promise<void> {
  const skillsDir = join(agentDir, "skills");
  if (!(await pathExists(skillsDir))) return;

  const entries = await readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isManagedScmSkillName(entry.name)) continue;
    await rm(join(skillsDir, entry.name), { recursive: true, force: true });
  }
}

/**
 * Build relative exclude paths for managed SCM skill directories.
 */
async function getManagedScmSkillExcludes(sourceDir: string): Promise<string[]> {
  const skillsDir = join(sourceDir, "skills");
  if (!(await pathExists(skillsDir))) return [];

  const entries = await readdir(skillsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && isManagedScmSkillName(entry.name))
    .map((entry) => join("skills", entry.name));
}

/**
 * Sync bundled agent templates into ~/.atomic for global discovery.
 *
 * This installs baseline agent/skill configs globally while intentionally
 * excluding SCM-specific skills (gh-*, sl-*), which are configured per-project
 * by `atomic init`.
 */
export async function syncAtomicGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR
): Promise<void> {
  await mkdir(baseDir, { recursive: true });

  const agentKeys = Object.keys(AGENT_CONFIG) as AgentKey[];
  for (const agentKey of agentKeys) {
    const sourceFolder = join(configRoot, getTemplateAgentFolder(agentKey));
    if (!(await pathExists(sourceFolder))) continue;

    const destinationFolder = join(baseDir, getAtomicGlobalAgentFolder(agentKey));
    const scmSkillExcludes = await getManagedScmSkillExcludes(sourceFolder);

    await copyDir(sourceFolder, destinationFolder, {
      exclude: [...AGENT_CONFIG[agentKey].exclude, ...scmSkillExcludes],
    });

    // Ensure stale managed SCM skills from previous installs are removed.
    await pruneManagedScmSkills(destinationFolder);
  }
}

/**
 * Return true when Atomic-managed global config folders already exist.
 */
export async function hasAtomicGlobalAgentConfigs(
  baseDir: string = ATOMIC_HOME_DIR
): Promise<boolean> {
  const agentKeys = Object.keys(AGENT_CONFIG) as AgentKey[];

  for (const agentKey of agentKeys) {
    const agentDir = join(baseDir, getAtomicGlobalAgentFolder(agentKey));
    if (!(await pathExists(agentDir))) return false;

    const requiredEntries = REQUIRED_GLOBAL_CONFIG_ENTRIES[agentKey];
    const entryChecks = await Promise.all(
      requiredEntries.map((entryName) => pathExists(join(agentDir, entryName)))
    );

    if (entryChecks.some((exists) => !exists)) {
      return false;
    }
  }

  return true;
}

/**
 * Ensure ~/.atomic contains Atomic-managed global agent configs.
 */
export async function ensureAtomicGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR
): Promise<void> {
  if (await hasAtomicGlobalAgentConfigs(baseDir)) return;
  await syncAtomicGlobalAgentConfigs(configRoot, baseDir);
}
