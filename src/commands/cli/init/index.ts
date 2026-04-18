/**
 * Automatic project setup — replaces the interactive `atomic init` command.
 *
 * Detects the repo's SCM, applies onboarding files (MCP configs, settings),
 * registers the workspace as trusted, and installs SCM-specific skills.
 *
 * Called transparently during `atomic chat` preflight so users never need
 * to think about initialization.
 */

import { join, resolve } from "node:path";
import {
  AGENT_CONFIG,
  type AgentKey,
  type SourceControlType,
  SCM_SKILLS_BY_TYPE,
  detectScmType,
} from "../../../services/config/index.ts";
import { pathExists } from "../../../services/system/copy.ts";
import { getConfigRoot } from "../../../services/config/config-path.ts";
import { upsertTrustedWorkspacePath } from "../../../services/config/settings.ts";
import { applyManagedOnboardingFiles } from "./onboarding.ts";
import { installLocalScmSkills, syncProjectScmSkills } from "./scm.ts";

/**
 * Check whether all expected SCM skills are already present on disk.
 */
async function areScmSkillsInstalled(
  agentKey: AgentKey,
  projectRoot: string,
  scmType: SourceControlType,
): Promise<boolean> {
  const skillNames = SCM_SKILLS_BY_TYPE[scmType];
  const skillsDir = join(projectRoot, AGENT_CONFIG[agentKey].folder, "skills");

  for (const name of skillNames) {
    if (!(await pathExists(join(skillsDir, name)))) {
      return false;
    }
  }
  return true;
}

function isInstalledPackage(): boolean {
  return import.meta.dir.includes("node_modules");
}

/**
 * Ensure the project is configured for the given agent.
 *
 * Idempotent — safe to call on every `atomic chat` invocation. Expensive
 * operations (skill installation via `bunx skills add`) are skipped when
 * the skills are already present on disk. Onboarding file merges are
 * always applied since they are cheap and self-healing.
 *
 * Errors in skill installation are swallowed so the agent can still launch.
 */
export async function ensureProjectSetup(
  agentKey: AgentKey,
  projectRoot: string,
): Promise<void> {
  const configRoot = getConfigRoot();
  const detectedScm = await detectScmType(projectRoot);

  // Apply onboarding files (idempotent merge, SCM-gated entries handled internally)
  await applyManagedOnboardingFiles(agentKey, projectRoot, configRoot);

  // Register trusted workspace
  await upsertTrustedWorkspacePath(resolve(projectRoot), agentKey);

  // Install SCM skills if detected and not yet present (best-effort)
  if (detectedScm) {
    try {
      const alreadyInstalled = await areScmSkillsInstalled(
        agentKey,
        projectRoot,
        detectedScm,
      );
      if (!alreadyInstalled) {
        if (isInstalledPackage()) {
          // npm/bunx install: fetch via the skills CLI
          await installLocalScmSkills({
            scmType: detectedScm,
            agentKey,
            cwd: projectRoot,
          });
        } else {
          // Source checkout (e.g. `bun run dev`): copy from the canonical
          // `.agents/skills` directory so prompt edits in-repo flow through
          // to the target project without needing a publish or git push.
          await syncProjectScmSkills({
            scmType: detectedScm,
            sourceSkillsDir: join(configRoot, ".agents", "skills"),
            targetSkillsDir: join(
              projectRoot,
              AGENT_CONFIG[agentKey].folder,
              "skills",
            ),
          });
        }
      }
    } catch {
      // Skills installation is best-effort — don't block the agent launch
    }
  }
}
