/**
 * Global skills installation and update.
 *
 * On first install (no skills lockfile), installs all bundled agent skills
 * globally via `bunx/npx skills add`, then removes source-control skill
 * variants so `atomic init` can install them locally per-project based on
 * the user's selected SCM + active agent.
 *
 * On subsequent launches (lockfile exists), runs
 * `bunx/npx skills update [SKILL1] [SKILL2] ...` for all non-SCM bundled
 * skills — much faster than a clean add each time.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { ALL_SCM_SKILLS } from "../config/index.ts";

const SKILLS_REPO = "https://github.com/flora131/atomic.git";
const SKILLS_AGENTS = ["claude-code", "opencode", "github-copilot"] as const;

/**
 * Every skill bundled in `.agents/skills/`, excluding SCM-variant skills.
 *
 * Used by the update path (`skills update SKILL1 SKILL2 ...`). When a new
 * skill is added to or removed from `.agents/skills/`, update this list.
 */
const BUNDLED_GLOBAL_SKILLS = [
  "adapt",
  "advanced-evaluation",
  "animate",
  "arrange",
  "audit",
  "bdi-mental-states",
  "bolder",
  "bun",
  "clarify",
  "colorize",
  "context-compression",
  "context-degradation",
  "context-fundamentals",
  "context-optimization",
  "create-spec",
  "critique",
  "delight",
  "distill",
  "docx",
  "evaluation",
  "explain-code",
  "extract",
  "filesystem-context",
  "find-skills",
  "frontend-design",
  "harden",
  "hosted-agents",
  "impeccable",
  "init",
  "layout",
  "liteparse",
  "memory-systems",
  "multi-agent-patterns",
  "normalize",
  "onboard",
  "opentui",
  "optimize",
  "overdrive",
  "pdf",
  "playwright-cli",
  "polish",
  "pptx",
  "project-development",
  "prompt-engineer",
  "quieter",
  "research-codebase",
  "shape",
  "skill-creator",
  "teach-impeccable",
  "test-driven-development",
  "tool-design",
  "typescript-advanced-types",
  "typescript-expert",
  "typescript-react-reviewer",
  "typeset",
  "workflow-creator",
  "xlsx",
] as const;

interface NpxSkillsResult {
  ok: boolean;
  /** Full captured stdout — used to parse command output (e.g. `skills list`). */
  stdout: string;
  /** Tail of captured stderr/stdout — surfaced by the spinner on failure. */
  details: string;
}

async function runNpxSkills(args: string[]): Promise<NpxSkillsResult> {
  // Prefer bunx (already available as our runtime) over npx to avoid
  // depending on a full Node.js/npm installation.
  const runner = Bun.which("bunx") ?? Bun.which("npx");
  if (!runner) {
    return { ok: false, stdout: "", details: "neither bunx nor npx found on PATH" };
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
    env: { ...process.env, DISABLE_TELEMETRY: "1" },
  });
  const [stderr, stdout, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  const details = (stderr.trim() || stdout.trim()).slice(-800);
  return { ok: exitCode === 0, stdout, details };
}

/**
 * True when the skills CLI lockfile exists, indicating skills have been
 * installed at least once (possibly for a different project).
 */
async function skillsLockExists(): Promise<boolean> {
  const xdgState = process.env.XDG_STATE_HOME;
  const lockPath = xdgState
    ? join(xdgState, "skills", ".skill-lock.json")
    : join(homedir(), ".agents", ".skill-lock.json");
  return Bun.file(lockPath).exists();
}

/**
 * True when Atomic's bundled skills are already installed globally.
 * Runs `skills list -g` and regex-matches the output for bundled names.
 */
async function hasBundledSkillsInstalled(): Promise<boolean> {
  const listResult = await runNpxSkills(["list", "-g"]);
  if (!listResult.ok) return false;

  const output = listResult.stdout;
  return BUNDLED_GLOBAL_SKILLS.some((skill) =>
    new RegExp(`\\b${skill}\\b`).test(output),
  );
}

export async function installGlobalSkills(): Promise<void> {
  const agentFlags = SKILLS_AGENTS.flatMap((agent) => ["-a", agent]);

  if ((await skillsLockExists()) && (await hasBundledSkillsInstalled())) {
    // Incremental update — much faster than a clean add.
    const updateResult = await runNpxSkills([
      "update",
      ...BUNDLED_GLOBAL_SKILLS,
    ]);
    if (!updateResult.ok) {
      throw new Error(`skills update failed: ${updateResult.details}`);
    }
  } else {
    // First install — full add from the repo.
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
      throw new Error(`skills add failed: ${addResult.details}`);
    }
  }

  // Remove SCM skills from global scope so `atomic init` can install
  // them locally per-project based on the user's selected SCM.
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
    throw new Error(`skills remove failed: ${removeResult.details}`);
  }
}
