/**
 * Global skills installation.
 *
 * Copies bundled agent skills from the installed package into the
 * provider-native global skill roots, mirroring the merge-copy approach
 * used by {@link installGlobalAgents} for agent configs.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { createCommonIgnoreFilter } from "../../lib/common-ignore.ts";
import { copyDir, pathExists } from "./copy.ts";

/**
 * Locate the package root by walking up from this module. Both in installed
 * (`<pkg>/src/services/system/skills.ts`) and dev checkout layouts the
 * package root is three directories up.
 */
function packageRoot(): string {
  return join(import.meta.dir, "..", "..", "..");
}

/** Honors ATOMIC_SETTINGS_HOME so tests can point at a temp dir. */
function homeRoot(): string {
  return process.env.ATOMIC_SETTINGS_HOME ?? homedir();
}

/**
 * Global skill directories keyed by provider.
 *
 * From CLAUDE.md:
 *   - `~/.agents/skills` for OpenCode and Copilot CLI
 *   - `~/.claude/skills` for Claude Code
 */
const SKILL_DEST_DIRS = [
  ".agents/skills",
  ".claude/skills",
] as const;

/**
 * Copy bundled skills to the global skill directories.
 */
export async function installGlobalSkills(): Promise<void> {
  const src = join(packageRoot(), ".agents", "skills");

  if (!(await pathExists(src))) {
    throw new Error(`Bundled skills missing at ${src}`);
  }

  const home = homeRoot();
  const ignoreFilter = createCommonIgnoreFilter();

  await Promise.all(
    SKILL_DEST_DIRS.map((rel) =>
      copyDir(src, join(home, rel), { ignoreFilter }),
    ),
  );
}
