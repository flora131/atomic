import { homedir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { copyDir, copyFile, isDirectory, pathExists } from "./copy";

const CLAUDE_CONFIG_MERGE_EXCLUDES = [".git"];
const CLAUDE_CONFIG_SYNC_ENTRIES = ["agents", "skills", "commands"] as const;

export interface PrepareClaudeConfigOptions {
  homeDir?: string;
  mergedDir?: string;
}

/**
 * Build a merged Claude config directory for CLAUDE_CONFIG_DIR.
 *
 * Precedence (low -> high):
 * 1) ~/.atomic/.claude (Atomic-managed defaults)
 * 2) ~/.claude/{agents,skills,commands} (legacy user config)
 *
 * @returns merged directory path, or null when ~/.atomic/.claude is missing
 */
export async function prepareClaudeConfigDir(
  options: PrepareClaudeConfigOptions = {},
): Promise<string | null> {
  const homeDir = options.homeDir ?? homedir();
  const atomicBaseDir = join(homeDir, ".atomic", ".claude");
  const mergedDir = options.mergedDir ?? atomicBaseDir;
  const stagingDir = join(homeDir, ".atomic", ".tmp", "claude-config-merge-staging");

  if (!(await pathExists(atomicBaseDir))) {
    return null;
  }

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  await copyDir(atomicBaseDir, stagingDir, {
    exclude: CLAUDE_CONFIG_MERGE_EXCLUDES,
  });

  const legacyUserDir = join(homeDir, ".claude");
  if (await pathExists(legacyUserDir)) {
    for (const entryName of CLAUDE_CONFIG_SYNC_ENTRIES) {
      const sourcePath = join(legacyUserDir, entryName);
      if (!(await pathExists(sourcePath))) {
        continue;
      }

      const destinationPath = join(stagingDir, entryName);
      if (await isDirectory(sourcePath)) {
        await copyDir(sourcePath, destinationPath, {
          exclude: CLAUDE_CONFIG_MERGE_EXCLUDES,
        });
      } else {
        await copyFile(sourcePath, destinationPath);
      }
    }
  }

  await rm(mergedDir, { recursive: true, force: true });
  await mkdir(mergedDir, { recursive: true });
  await copyDir(stagingDir, mergedDir, {
    exclude: CLAUDE_CONFIG_MERGE_EXCLUDES,
  });
  await rm(stagingDir, { recursive: true, force: true });

  return mergedDir;
}
