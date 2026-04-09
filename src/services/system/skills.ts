/**
 * Global skills installation.
 *
 * Installs bundled agent skills globally via `npx skills`, then removes
 * source-control skill variants so `atomic init` can install them
 * locally per-project based on the user's selected SCM + active agent.
 */

const SKILLS_REPO = "https://github.com/flora131/atomic.git";
const SKILLS_AGENTS = ["claude-code", "opencode", "github-copilot"] as const;
const SCM_SKILLS_TO_REMOVE_GLOBALLY = [
  "gh-commit",
  "gh-create-pr",
  "sl-commit",
  "sl-submit-diff",
] as const;

async function runNpxSkills(args: string[]): Promise<boolean> {
  const npxPath = Bun.which("npx");
  if (!npxPath) {
    console.warn("npx not found on PATH — skipping skills install");
    return false;
  }

  const proc = Bun.spawn([npxPath, "--yes", "skills", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;
  return exitCode === 0;
}

export async function installGlobalSkills(): Promise<void> {
  const agentFlags = SKILLS_AGENTS.flatMap((agent) => ["-a", agent]);

  console.log("Installing bundled skills globally...");
  const addOk = await runNpxSkills([
    "add",
    SKILLS_REPO,
    "--skill",
    "*",
    "-g",
    ...agentFlags,
    "-y",
  ]);
  if (!addOk) {
    console.warn("Warning: 'npx skills add' exited non-zero (non-fatal)");
    return;
  }

  const removeSkillFlags = SCM_SKILLS_TO_REMOVE_GLOBALLY.flatMap((skill) => [
    "--skill",
    skill,
  ]);
  console.log(
    "Removing source-control skill variants globally (added per-project by `atomic init`)...",
  );
  const removeOk = await runNpxSkills([
    "remove",
    ...removeSkillFlags,
    "-g",
    ...agentFlags,
    "-y",
  ]);
  if (!removeOk) {
    console.warn("Warning: 'npx skills remove' exited non-zero (non-fatal)");
  }
}
