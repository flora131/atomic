/**
 * Global skills installation.
 *
 * Installs bundled agent skills globally via `npx skills`, then removes
 * source-control skill variants so `atomic init` can install them
 * locally per-project based on the user's selected SCM + active agent.
 */

import { ALL_SCM_SKILLS } from "../config/index.ts";

const SKILLS_REPO = "https://github.com/flora131/atomic.git";
const SKILLS_AGENTS = ["claude-code", "opencode", "github-copilot"] as const;

interface NpxSkillsResult {
  ok: boolean;
  /** Tail of captured stderr/stdout — surfaced by the spinner on failure. */
  details: string;
}

async function runNpxSkills(args: string[]): Promise<NpxSkillsResult> {
  // Prefer bunx (already available as our runtime) over npx to avoid
  // depending on a full Node.js/npm installation.
  const runner = Bun.which("bunx") ?? Bun.which("npx");
  if (!runner) {
    return { ok: false, details: "neither bunx nor npx found on PATH" };
  }

  // Capture stdout/stderr so the outer spinner UI owns terminal output and
  // can surface the tail of any failure.
  const isBunx = runner.endsWith("bunx");
  const cmd = isBunx
    ? [runner, "skills", ...args]
    : [runner, "--yes", "skills", ...args];
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, stdout, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  const details = (stderr.trim() || stdout.trim()).slice(-800);
  return { ok: exitCode === 0, details };
}

export async function installGlobalSkills(): Promise<void> {
  const agentFlags = SKILLS_AGENTS.flatMap((agent) => ["-a", agent]);

  const addResult = await runNpxSkills([
    "add",
    SKILLS_REPO,
    "--skill",
    "*",
    "-g",
    ...agentFlags,
    "-y",
  ]);
  if (!addResult.ok) {
    throw new Error(`npx skills add failed: ${addResult.details}`);
  }

  const removeSkillFlags = ALL_SCM_SKILLS.flatMap((skill) => [
    "--skill",
    skill,
  ]);
  const removeResult = await runNpxSkills([
    "remove",
    ...removeSkillFlags,
    "-g",
    ...agentFlags,
    "-y",
  ]);
  if (!removeResult.ok) {
    throw new Error(`npx skills remove failed: ${removeResult.details}`);
  }
}
