/**
 * Global skills installation.
 *
 * Copies bundled agent skills from the installed package into the
 * provider-native global skill roots, mirroring the merge-copy approach
 * used by {@link installGlobalAgents} for agent configs.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { createCommonIgnoreFilter } from "@bastani/atomic-sdk/lib/common-ignore";
import { copyDir, pathExists } from "@bastani/atomic-sdk/services/system/copy";
import { getEmbeddedAsset } from "../../lib/embedded-assets.ts";

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
  const src = await getEmbeddedAsset("skills");

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
