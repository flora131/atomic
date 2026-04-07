#!/usr/bin/env bun
/**
 * Postinstall hook for the Atomic source repo.
 *
 * Mirrors the `install_workflows` step in install.sh / install.ps1: copies
 * bundled workflow templates and shared helpers from `<repo>/.atomic/workflows`
 * into the user's global `~/.atomic/workflows/` directory and installs the
 * workflow SDK dependency there. This is what makes `bun run dev` see the same
 * workflow templates that a binary install would provide.
 *
 * When running from an installed package (i.e. somewhere inside
 * `node_modules/`) we also install all bundled skills globally via
 * `npx skills add` and then remove the source-control skill variants
 * (`gh-*` / `sl-*`) globally so `atomic init` can install them locally
 * per-project based on the user's selected SCM + active agent.
 *
 * Source-repo installs (`bun install` on a cloned checkout) skip the global
 * skills step entirely — dev environments already have the bundled configs
 * on disk and don't need the network round-trip through the skills CLI.
 *
 * Best-effort: any failure is logged as a warning and never fails the install.
 */

import { resolve } from "path";
import { installGlobalWorkflows } from "@/services/system/install-workflows.ts";

/**
 * True when this script is running against a cloned source checkout (a
 * developer ran `bun install` in the repo), false when running from an
 * installed package copy (under `node_modules/`).
 *
 * Detected from the file location: `import.meta.dir` lands under
 * `node_modules/…/src/scripts` for installed packages and under the repo's
 * own `src/scripts` otherwise.
 */
function isSourceInstall(): boolean {
  return !import.meta.dir.includes("node_modules");
}

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
    console.warn(
      "[atomic] Warning: npx not found on PATH — skipping skills install",
    );
    return false;
  }

  const proc = Bun.spawn([npxPath, "--yes", "skills", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;
  return exitCode === 0;
}

async function installGlobalSkills(): Promise<void> {
  const agentFlags = SKILLS_AGENTS.flatMap((agent) => ["-a", agent]);

  console.log("[atomic] Installing all bundled skills globally...");
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
    console.warn(
      "[atomic] Warning: 'npx skills add' exited non-zero (non-fatal)",
    );
    return;
  }

  const removeSkillFlags = SCM_SKILLS_TO_REMOVE_GLOBALLY.flatMap((skill) => [
    "--skill",
    skill,
  ]);
  console.log(
    "[atomic] Removing source-control skill variants globally (added per-project by `atomic init`)...",
  );
  const removeOk = await runNpxSkills([
    "remove",
    ...removeSkillFlags,
    "-g",
    ...agentFlags,
    "-y",
  ]);
  if (!removeOk) {
    console.warn(
      "[atomic] Warning: 'npx skills remove' exited non-zero (non-fatal)",
    );
  }
}

async function main(): Promise<void> {
  // src/scripts/postinstall.ts → repo root is two levels up
  const repoRoot = resolve(import.meta.dir, "..", "..");

  try {
    const copied = await installGlobalWorkflows(repoRoot);
    if (copied > 0) {
      console.log(
        `[atomic] Installed ${copied} workflow template(s) to ~/.atomic/workflows/`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[atomic] Warning: failed to install workflow templates: ${message}`,
    );
  }

  if (isSourceInstall()) {
    // Dev environment already has every bundled skill on disk under
    // `.claude/`, `.opencode/`, `.agents/`, etc. — skip the network-backed
    // `npx skills` step entirely.
    return;
  }

  try {
    await installGlobalSkills();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[atomic] Warning: failed to install global skills: ${message}`);
  }
}

await main();
