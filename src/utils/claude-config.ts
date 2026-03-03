import { homedir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { copyDir, pathExists } from "./copy";

export interface PrepareClaudeConfigOptions {
  homeDir?: string;
  mergedDir?: string;
}

/**
 * Build a merged Claude config directory for CLAUDE_CONFIG_DIR.
 *
 * Precedence (low -> high):
 * 1) ~/.atomic/.claude (Atomic-managed defaults)
 * 2) ~/.claude (legacy user config)
 *
 * @returns merged directory path, or null when ~/.atomic/.claude is missing
 */
export async function prepareClaudeConfigDir(
  options: PrepareClaudeConfigOptions = {},
): Promise<string | null> {
  const homeDir = options.homeDir ?? homedir();
  const atomicBaseDir = join(homeDir, ".atomic", ".claude");
  const mergedDir =
    options.mergedDir ?? join(homeDir, ".atomic", ".tmp", "claude-config-merged");

  if (!(await pathExists(atomicBaseDir))) {
    return null;
  }

  await rm(mergedDir, { recursive: true, force: true });
  await mkdir(mergedDir, { recursive: true });

  await copyDir(atomicBaseDir, mergedDir);

  const legacyUserDir = join(homeDir, ".claude");
  if (await pathExists(legacyUserDir)) {
    await copyDir(legacyUserDir, mergedDir);
  }

  return mergedDir;
}
