/**
 * Global skills installation.
 *
 * Copies bundled agent skills from the installed package into the
 * provider-native global skill roots, mirroring the merge-copy approach
 * used by {@link installGlobalAgents} for agent configs.
 *
 * Previously this ran `npx skills add <repo>` at runtime, which cloned
 * the entire git repo on every version bump.  Now the skills ship inside
 * the npm package (`.agents/skills/`) and are copied locally — no network
 * required, no `npx`/`bunx` dependency.
 *
 * SCM-variant skills (gh-commit, gh-create-pr, sl-commit, sl-submit-diff)
 * are excluded from the global install; `atomic init` installs them
 * per-project based on the user's selected SCM + active agent.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { ALL_SCM_SKILLS } from "../config/index.ts";
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

/** The set of SCM skill names to exclude from global installation. */
const SCM_SKILL_SET = new Set<string>(ALL_SCM_SKILLS);

/**
 * Copy bundled skills to the global skill directories, excluding
 * SCM-variant skills that are installed per-project by `atomic init`.
 */
export async function installGlobalSkills(): Promise<void> {
  const src = join(packageRoot(), ".agents", "skills");

  if (!(await pathExists(src))) {
    throw new Error(`Bundled skills missing at ${src}`);
  }

  const home = homeRoot();

  // Build the exclusion list from SCM skill names
  const exclude = [...SCM_SKILL_SET];

  await Promise.all(
    SKILL_DEST_DIRS.map((rel) =>
      copyDir(src, join(home, rel), { exclude }),
    ),
  );
}
