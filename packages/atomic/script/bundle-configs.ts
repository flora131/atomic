#!/usr/bin/env bun
/**
 * Bundle global configs for a release.
 *
 * Installs curated skills globally, copies bundled agent definitions to
 * each agent's global config root, and packages everything into a zip
 * archive suitable for attaching to a GitHub Release.
 *
 * Usage:
 *   bun run src/scripts/bundle-configs.ts <version> [output-dir]
 *
 * <version>     Semver string (e.g. 0.4.47 or 0.4.47-0).
 * [output-dir]  Directory for the zip file. Defaults to $GITHUB_WORKSPACE
 *               or the current directory.
 */

import { $ } from "bun";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const HOME = homedir();

/** Source repo for the global skills install. */
const SKILLS_REPO = "https://github.com/flora131/atomic.git";

/** Agent CLI flags accepted by `bunx skills`. */
const AGENT_FLAGS = ["claude-code", "opencode", "github-copilot"];

/**
 * Local config root (in repo) → global root (~/) for each agent.
 * Copilot uses `.github` locally but `.copilot` globally.
 */
const AGENT_ROOTS = {
  claude: { local: ".claude", global: ".claude" },
  opencode: { local: ".opencode", global: ".opencode" },
  copilot: { local: ".github", global: ".copilot" },
} as const;

/** Paths included in the zip archive (relative to $HOME). */
const ZIP_INCLUDES = [
  ".agents/skills",
  ".claude/agents",
  ".claude/skills",
  ".opencode/agents",
  ".copilot/agents",
  ".copilot/lsp-config.json",
];

// ── Steps ──────────────────────────────────────────────────────────────────

async function installGlobalSkills(): Promise<void> {
  console.log("Installing global skills…");

  const agentArgs = AGENT_FLAGS.flatMap((a) => ["-a", a]);
  await $`bunx skills add ${SKILLS_REPO} --skill "*" -g ${agentArgs} -y`;
}

async function copyBundledAgents(): Promise<void> {
  console.log("Copying bundled agents to global roots…");

  for (const [agent, { local, global: globalDir }] of Object.entries(
    AGENT_ROOTS,
  )) {
    const src = join(ROOT, local, "agents");
    const dest = join(HOME, globalDir, "agents");

    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    console.log(`  ${agent}: ${src} → ${dest}`);
  }

  const lspSrc = join(ROOT, ".github", "lsp.json");
  if (existsSync(lspSrc)) {
    const lspDest = join(HOME, AGENT_ROOTS.copilot.global, "lsp-config.json");
    cpSync(lspSrc, lspDest);
    console.log(`  copilot: lsp.json → ${lspDest}`);
  }
}

async function packageZip(
  version: string,
  outputDir: string,
): Promise<string> {
  const zipName = `atomic-configs-v${version}.zip`;
  const zipPath = resolve(outputDir, zipName);

  console.log(`Packaging ${zipName}…`);
  await $`cd ${HOME} && zip -r ${zipPath} ${ZIP_INCLUDES} -x '*.DS_Store'`.quiet();
  console.log(`  → ${zipPath}`);

  return zipPath;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const version = process.argv[2]?.replace(/^v/, "");
  const outputDir = process.argv[3] ?? process.env.GITHUB_WORKSPACE ?? ".";

  if (!version) {
    console.error(
      "Usage: bun run src/scripts/bundle-configs.ts <version> [output-dir]",
    );
    process.exit(1);
  }

  await installGlobalSkills();
  await copyBundledAgents();
  await packageZip(version, outputDir);

  console.log("\nDone.");
}

main();
