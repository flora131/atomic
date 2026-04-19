import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import { AGENT_CONFIG, getAgentKeys, type AgentKey } from "./index.ts";
import { syncJsonFile } from "../../lib/merge.ts";
import { createCommonIgnoreFilter } from "../../lib/common-ignore.ts";
import { copyDir, ensureDir, pathExists, shouldExclude } from "../system/copy.ts";


const ATOMIC_HOME_DIR = join(homedir(), ".atomic");

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

/**
 * Per-agent subdirectories copied from the bundled template into the
 * provider home. Only `agents/` now — skills ship via the skills CLI.
 */
const GLOBAL_SYNC_SUBDIRECTORIES = ["agents"] as const;

/**
 * Top-level files copied per agent. Copilot's lsp.json is renamed to
 * lsp-config.json in the destination (see `GLOBAL_SYNC_DESTINATION_FILE_NAMES`).
 */
const GLOBAL_SYNC_FILES: Partial<Record<AgentKey, readonly string[]>> = {
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

    if (shouldExclude(relativePath, entry.name, [...exclude])) {
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
  await syncJsonFile(sourcePath, destinationPath);
}

/**
 * Remove only the Atomic-managed entries from provider-native global roots.
 *
 * Mirrors `syncAtomicGlobalAgentConfigs`: walks the bundled template for
 * each agent and removes every file/directory it would have installed. Any
 * legacy skills or tools left behind from previous Atomic versions are
 * intentionally untouched — those are owned by the skills CLI now.
 */
export async function removeAtomicManagedGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<void> {
  const agentKeys = getAgentKeys();

  for (const agentKey of agentKeys) {
    const sourceFolder = join(configRoot, getTemplateAgentFolder(agentKey));
    const destinationFolder = getAtomicManagedAgentDir(agentKey, baseDir);
    for (const subdirectory of GLOBAL_SYNC_SUBDIRECTORIES) {
      const sourceSubdirectory = join(sourceFolder, subdirectory);
      if (!(await pathExists(sourceSubdirectory))) {
        continue;
      }

      const managedTree = await collectManagedTreeEntries(sourceSubdirectory, []);
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
 * Copies each agent's `agents/` directory plus a small set of top-level
 * files (currently just Copilot's `lsp.json` → `lsp-config.json`). Skills
 * are NOT synced from here — they are installed globally at install time
 * via `npx skills add` from the git repo.
 */
export async function syncAtomicGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<void> {
  await ensureDir(baseDir);

  const agentKeys = getAgentKeys();
  for (const agentKey of agentKeys) {
    const sourceFolder = join(configRoot, getTemplateAgentFolder(agentKey));
    if (!(await pathExists(sourceFolder))) continue;

    const destinationFolder = getAtomicManagedAgentDir(agentKey, baseDir);
    await ensureDir(destinationFolder);

    const ignoreFilter = createCommonIgnoreFilter();
    for (const subdirectory of GLOBAL_SYNC_SUBDIRECTORIES) {
      const sourceSubdir = join(sourceFolder, subdirectory);
      if (await pathExists(sourceSubdir)) {
        await copyDir(sourceSubdir, join(destinationFolder, subdirectory), { ignoreFilter });
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
  }
}

/**
 * Return true when every Atomic-bundled agent file is present at its
 * destination in the provider-native global roots.
 *
 * This walks the bundled template for each agent and checks that every
 * file (and the top-level files in `GLOBAL_SYNC_FILES`) has a matching
 * entry under `~/.<agent>/`. A single missing file returns false so the
 * caller can run a merge re-sync. User-added files in the destination
 * that don't exist in the template are ignored — they never trigger a
 * false-negative and they are never removed.
 */
export async function hasAtomicGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<boolean> {
  const agentKeys = getAgentKeys();

  for (const agentKey of agentKeys) {
    const sourceFolder = join(configRoot, getTemplateAgentFolder(agentKey));
    if (!(await pathExists(sourceFolder))) {
      // No template for this agent in the config root — nothing to verify.
      continue;
    }

    const destinationFolder = getAtomicManagedAgentDir(agentKey, baseDir);
    if (!(await pathExists(destinationFolder))) return false;

    for (const subdirectory of GLOBAL_SYNC_SUBDIRECTORIES) {
      const sourceSubdir = join(sourceFolder, subdirectory);
      if (!(await pathExists(sourceSubdir))) continue;

      const managedTree = await collectManagedTreeEntries(sourceSubdir, []);
      const destinationSubdir = join(destinationFolder, subdirectory);

      for (const relativeFile of managedTree.files) {
        if (!(await pathExists(join(destinationSubdir, relativeFile)))) {
          return false;
        }
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
      if (!(await pathExists(destinationFilePath))) return false;
    }
  }

  return true;
}

/**
 * Verify-and-repair entrypoint for user-facing commands (`atomic chat`).
 * If every bundled agent file is present at its
 * destination, returns immediately without touching disk. Otherwise
 * runs a merge re-sync, which fills the missing files from the local
 * config data dir while leaving user-added files alone.
 *
 * This helper heals drift (e.g. a user deleted `~/.claude/agents/<foo>.md`).
 */
export async function ensureAtomicGlobalAgentConfigs(
  configRoot: string,
  baseDir: string = ATOMIC_HOME_DIR,
): Promise<void> {
  if (await hasAtomicGlobalAgentConfigs(configRoot, baseDir)) return;
  await syncAtomicGlobalAgentConfigs(configRoot, baseDir);
}

