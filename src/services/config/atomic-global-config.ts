import { copyFile, lstat, readdir, rm, rmdir } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";

import { AGENT_CONFIG, type AgentKey } from "@/services/config/index.ts";
import { mergeJsonFile } from "@/lib/merge.ts";
import { copyDir, ensureDir, pathExists } from "@/services/system/copy.ts";
import type { InstallationType } from "@/services/config/config-path.ts";

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
  copilot: AGENT_CONFIG.copilot.folder,
};

const REQUIRED_GLOBAL_CONFIG_ENTRIES: Record<AgentKey, string[]> = {
  claude: ["agents", "skills"],
  opencode: ["agents", "skills", "tools"],
  copilot: ["agents", "skills", "lsp-config.json"],
};

const GLOBAL_SYNC_SUBDIRECTORIES = ["agents", "skills"] as const;

/**
 * Additional subdirectories to sync per agent beyond the shared ones.
 * OpenCode custom tools live in .opencode/tools/ and must be synced globally.
 */
const AGENT_EXTRA_SYNC_SUBDIRECTORIES: Partial<Record<AgentKey, readonly string[]>> = {
  opencode: ["tools"],
};

const GLOBAL_SYNC_FILES: Partial<Record<AgentKey, readonly string[]>> = {
  opencode: ["package.json"],
  copilot: ["lsp.json"],
};

const GLOBAL_SYNC_DESTINATION_FILE_NAMES: Partial<Record<AgentKey, Partial<Record<string, string>>>> = {
  copilot: {
    "lsp.json": "lsp-config.json",
  },
};

/**
 * Return the Atomic home directory used for global workflows/tools/settings.
 */
export function getAtomicHomeDir(): string {
  return ATOMIC_HOME_DIR;
}

function resolveHomeDirFromAtomicHome(baseDir: string): string {
  return resolve(baseDir, "..");
}

/**
 * Get Atomic-managed provider config directories.
 *
 * Atomic now installs provider configs into the provider home roots while
 * keeping Atomic-specific state under ~/.atomic.
 */
export function getAtomicManagedConfigDirs(baseDir: string = ATOMIC_HOME_DIR): string[] {
  const homeDir = resolveHomeDirFromAtomicHome(baseDir);
  return [
    join(homeDir, GLOBAL_AGENT_FOLDER_BY_KEY.claude),
    join(homeDir, GLOBAL_AGENT_FOLDER_BY_KEY.opencode),
    join(homeDir, GLOBAL_AGENT_FOLDER_BY_KEY.copilot),
  ];
}

/**
 * Get the provider home-folder suffix for the given agent.
 */
export function getAtomicGlobalAgentFolder(agentKey: AgentKey): string {
  return GLOBAL_AGENT_FOLDER_BY_KEY[agentKey];
}

/**
 * Resolve the destination directory where Atomic installs provider configs.
 */
export function getAtomicManagedAgentDir(
  agentKey: AgentKey,
  baseDir: string = ATOMIC_HOME_DIR,
): string {
  return join(resolveHomeDirFromAtomicHome(baseDir), getAtomicGlobalAgentFolder(agentKey));
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
 * Build exclude names for managed SCM skill directories under a skills root.
 */
async function getManagedScmSkillExcludes(sourceDir: string): Promise<string[]> {
  const skillsDir = join(sourceDir, "skills");
  if (!(await pathExists(skillsDir))) return [];

  const entries = await readdir(skillsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && isManagedScmSkillName(entry.name))
    .map((entry) => entry.name);
}

interface ManagedTreeEntries {
  directories: string[];
  files: string[];
}

async function collectManagedTreeEntries(
  sourceDir: string,
  exclude: readonly string[],
  relativeDir: string = "",
): Promise<ManagedTreeEntries> {
  if (!(await pathExists(sourceDir))) {
    return {
      directories: [],
      files: [],
    };
  }

  const directories: string[] = [];
  const files: string[] = [];
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = relativeDir.length > 0
      ? join(relativeDir, entry.name)
      : entry.name;

    if (exclude.includes(entry.name)) {
      continue;
    }

    const normalizedRelativePath = relativePath.replace(/\\/g, "/");
    if (exclude.some((excluded) =>
      normalizedRelativePath === excluded.replace(/\\/g, "/") ||
      normalizedRelativePath.startsWith(`${excluded.replace(/\\/g, "/")}/`)
    )) {
      continue;
    }

    const sourcePath = join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      directories.push(relativePath);
      const nestedEntries = await collectManagedTreeEntries(
        sourcePath,
        exclude,
        relativePath,
      );
      directories.push(...nestedEntries.directories);
      files.push(...nestedEntries.files);
      continue;
    }

    if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(relativePath);
    }
  }

  return { directories, files };
}

async function removeEmptyDirectoryIfPresent(pathToDirectory: string): Promise<void> {
  try {
    const stats = await lstat(pathToDirectory);
    if (!stats.isDirectory()) {
      return;
    }
  } catch {
    return;
  }

  const entries = await readdir(pathToDirectory);
  if (entries.length === 0) {
    await rmdir(pathToDirectory);
  }
}

function getGlobalSyncDestinationFileName(agentKey: AgentKey, sourceFileName: string): string {
  return GLOBAL_SYNC_DESTINATION_FILE_NAMES[agentKey]?.[sourceFileName] ?? sourceFileName;
}

async function syncManagedGlobalFile(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await ensureDir(resolve(destinationPath, ".."));

  if (await pathExists(destinationPath)) {
    await mergeJsonFile(sourcePath, destinationPath);
    return;
  }

  await copyFile(sourcePath, destinationPath);
}

/**
 * Remove only the Atomic-managed entries from provider-native global roots.
 */
export async function removeAtomicManagedGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<void> {
  const agentKeys = Object.keys(AGENT_CONFIG) as AgentKey[];

  for (const agentKey of agentKeys) {
    const sourceFolder = join(configRoot, getTemplateAgentFolder(agentKey));
    const destinationFolder = getAtomicManagedAgentDir(agentKey, baseDir);
    for (const subdirectory of GLOBAL_SYNC_SUBDIRECTORIES) {
      const sourceSubdirectory = join(sourceFolder, subdirectory);
      if (!(await pathExists(sourceSubdirectory))) {
        continue;
      }

      const scmSkillExcludes = subdirectory === "skills"
        ? await getManagedScmSkillExcludes(sourceFolder)
        : [];
      const managedTree = await collectManagedTreeEntries(sourceSubdirectory, scmSkillExcludes);
      const destinationSubdirectory = join(destinationFolder, subdirectory);

      for (const relativeFile of managedTree.files) {
        await rm(join(destinationSubdirectory, relativeFile), { force: true });
      }

      const managedDirectories = [...managedTree.directories].sort(
        (left, right) => right.length - left.length,
      );
      for (const relativeDirectory of managedDirectories) {
        await removeEmptyDirectoryIfPresent(join(destinationSubdirectory, relativeDirectory));
      }
      await removeEmptyDirectoryIfPresent(destinationSubdirectory);
    }

    // Remove entries from agent-specific extra subdirectories (e.g. OpenCode tools/)
    const extraSubdirs = AGENT_EXTRA_SYNC_SUBDIRECTORIES[agentKey] ?? [];
    for (const extraSubdir of extraSubdirs) {
      const sourceExtraSubdir = join(sourceFolder, extraSubdir);
      if (!(await pathExists(sourceExtraSubdir))) continue;

      const managedTree = await collectManagedTreeEntries(sourceExtraSubdir, []);
      const destExtraSubdir = join(destinationFolder, extraSubdir);

      for (const relativeFile of managedTree.files) {
        await rm(join(destExtraSubdir, relativeFile), { force: true });
      }
      const sortedDirs = [...managedTree.directories].sort(
        (left, right) => right.length - left.length,
      );
      for (const relativeDirectory of sortedDirs) {
        await removeEmptyDirectoryIfPresent(join(destExtraSubdir, relativeDirectory));
      }
      await removeEmptyDirectoryIfPresent(destExtraSubdir);
    }

    const managedFiles = GLOBAL_SYNC_FILES[agentKey] ?? [];
    for (const fileName of managedFiles) {
      const sourceFilePath = join(sourceFolder, fileName);
      if (!(await pathExists(sourceFilePath))) {
        continue;
      }

      const destinationFilePath = join(
        destinationFolder,
        getGlobalSyncDestinationFileName(agentKey, fileName),
      );
      await rm(destinationFilePath, { force: true });
    }

    // Do NOT remove the top-level provider directory (e.g. ~/.claude, ~/.opencode,
    // ~/.copilot) — Atomic does not own it and it may contain user-managed configs.
  }
}

/**
 * Sync bundled agent templates into provider-native global roots.
 *
 * This installs baseline agent/skill configs globally while intentionally
 * excluding SCM-specific skills (gh-*, sl-*), which are configured per-project
 * by `atomic init`.
 */
export async function syncAtomicGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<void> {
  await ensureDir(baseDir);

  const agentKeys = Object.keys(AGENT_CONFIG) as AgentKey[];
  for (const agentKey of agentKeys) {
    const sourceFolder = join(configRoot, getTemplateAgentFolder(agentKey));
    if (!(await pathExists(sourceFolder))) continue;

    const destinationFolder = getAtomicManagedAgentDir(agentKey, baseDir);
    await ensureDir(destinationFolder);

    const sourceAgentsDir = join(sourceFolder, "agents");
    if (await pathExists(sourceAgentsDir)) {
      await copyDir(sourceAgentsDir, join(destinationFolder, "agents"));
    }

    const sourceSkillsDir = join(sourceFolder, "skills");
    if (await pathExists(sourceSkillsDir)) {
      const scmSkillExcludes = await getManagedScmSkillExcludes(sourceFolder);
      await copyDir(sourceSkillsDir, join(destinationFolder, "skills"), {
        exclude: scmSkillExcludes,
      });
    }

    // Sync agent-specific extra subdirectories (e.g. OpenCode tools/)
    const extraSubdirs = AGENT_EXTRA_SYNC_SUBDIRECTORIES[agentKey] ?? [];
    for (const subdir of extraSubdirs) {
      const sourceSubdir = join(sourceFolder, subdir);
      if (await pathExists(sourceSubdir)) {
        await copyDir(sourceSubdir, join(destinationFolder, subdir));
      }
    }

    const managedFiles = GLOBAL_SYNC_FILES[agentKey] ?? [];
    for (const fileName of managedFiles) {
      const sourceFilePath = join(sourceFolder, fileName);
      if (!(await pathExists(sourceFilePath))) continue;

      const destinationFilePath = join(
        destinationFolder,
        getGlobalSyncDestinationFileName(agentKey, fileName),
      );
      await syncManagedGlobalFile(sourceFilePath, destinationFilePath);
    }

    await pruneManagedScmSkills(destinationFolder);
  }
}

/**
 * Return true when Atomic-managed provider config roots already exist.
 */
export async function hasAtomicGlobalAgentConfigs(
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<boolean> {
  const agentKeys = Object.keys(AGENT_CONFIG) as AgentKey[];

  for (const agentKey of agentKeys) {
    const agentDir = getAtomicManagedAgentDir(agentKey, baseDir);
    if (!(await pathExists(agentDir))) return false;

    const requiredEntries = REQUIRED_GLOBAL_CONFIG_ENTRIES[agentKey];
    const entryChecks = await Promise.all(
      requiredEntries.map((entryName) => pathExists(join(agentDir, entryName))),
    );

    if (entryChecks.some((exists) => !exists)) {
      return false;
    }
  }

  return true;
}

/**
 * Ensure provider-native roots contain Atomic-managed global agent configs.
 */
export async function ensureAtomicGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<void> {
  if (await hasAtomicGlobalAgentConfigs(baseDir)) return;
  await syncAtomicGlobalAgentConfigs(configRoot, baseDir);
}

/**
 * Ensure provider-native roots contain Atomic-managed global agent configs
 * for all install types.
 */
export async function ensureAtomicGlobalAgentConfigsForInstallType(
  installType: InstallationType,
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<void> {
  switch (installType) {
    case "source":
    case "npm":
    case "binary":
      await ensureAtomicGlobalAgentConfigs(configRoot, baseDir);
      return;
  }
}
