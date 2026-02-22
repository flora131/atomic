import { homedir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { copyDir, pathExists } from "./copy";

export interface PrepareOpenCodeConfigOptions {
  /** Project root used for local .opencode overrides */
  projectRoot?: string;
  /** Home directory override for tests */
  homeDir?: string;
  /** Explicit merged directory path override for tests */
  mergedDir?: string;
}

/**
 * Build a merged OpenCode config directory for OPENCODE_CONFIG_DIR.
 *
 * Precedence (low -> high):
 * 1) ~/.atomic/.opencode (Atomic-managed defaults)
 * 2) ~/.config/opencode (user global config)
 * 3) ~/.opencode (legacy user config)
 * 4) <project>/.opencode (project-local overrides)
 *
 * @returns merged directory path, or null when Atomic base config is missing
 */
export async function prepareOpenCodeConfigDir(
  options: PrepareOpenCodeConfigOptions = {}
): Promise<string | null> {
  const homeDir = options.homeDir ?? homedir();
  const projectRoot = options.projectRoot ?? process.cwd();
  const atomicBaseDir = join(homeDir, ".atomic", ".opencode");
  const mergedDir = options.mergedDir ?? join(homeDir, ".atomic", ".tmp", "opencode-config-merged");

  if (!(await pathExists(atomicBaseDir))) {
    return null;
  }

  await rm(mergedDir, { recursive: true, force: true });
  await mkdir(mergedDir, { recursive: true });

  // Base layer: Atomic-managed defaults
  await copyDir(atomicBaseDir, mergedDir);

  // Overlay user/global and project-local configs so they override defaults.
  const overlays = [
    join(homeDir, ".config", "opencode"),
    join(homeDir, ".opencode"),
    join(projectRoot, ".opencode"),
  ];

  for (const overlayDir of overlays) {
    if (await pathExists(overlayDir)) {
      await copyDir(overlayDir, mergedDir);
    }
  }

  return mergedDir;
}
