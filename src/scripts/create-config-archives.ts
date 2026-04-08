#!/usr/bin/env bun
/**
 * Creates the slim config archives shipped with each release.
 *
 * Usage:
 *   bun run src/scripts/create-config-archives.ts
 *
 * Produces in dist/:
 *   atomic-config.tar.gz  (Unix — preserves permissions)
 *   atomic-config.zip     (Windows)
 *
 * The archive contains:
 *   .claude/agents, .opencode/agents, .github/agents  — subagent definitions
 *   .github/lsp.json                                  — Copilot LSP config
 *   .atomic/workflows                                 — workflow templates
 *
 * Skills are NOT bundled — install.sh / install.ps1 pull them at install
 * time via `npx skills add`, and `atomic init` installs the per-project
 * SCM variants the same way.
 */

import { $ } from "bun";
import { resolve, join } from "path";
import { mkdir, cp, readdir, rm, writeFile } from "fs/promises";
import ignore from "ignore";
import { AGENTS } from "@bastani/atomic-workflows";
import { SDK_PACKAGE_NAME, WORKFLOW_SDK_DIR, CONFIG_DIRS, CONFIG_FILES } from "./constants.ts";

const ROOT = resolve(import.meta.dir, "../..");
const DIST = resolve(ROOT, "dist");
const STAGING = resolve(ROOT, "config-staging");

/** Minimal tsconfig shipped with workflow templates (no monorepo path aliases). */
const WORKFLOWS_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      noEmit: true,
      verbatimModuleSyntax: true,
      strict: true,
      skipLibCheck: true,
      types: ["bun"],
    },
    include: [
      ...AGENTS.map((agent) => `**/${agent}/**/*.ts`),
      "**/helpers/**/*.ts",
    ],
  },
  null,
  2,
);

async function main(): Promise<void> {
  // Clean any previous staging directory
  await rm(STAGING, { recursive: true, force: true });

  // ── Agent configs ──────────────────────────────────────────────────
  for (const dir of CONFIG_DIRS) {
    const dest = join(STAGING, dir);
    await mkdir(dest, { recursive: true });
    await cp(join(ROOT, dir), dest, { recursive: true });
  }
  for (const file of CONFIG_FILES) {
    const dest = join(STAGING, file);
    await mkdir(resolve(dest, ".."), { recursive: true });
    await cp(join(ROOT, file), dest);
  }

  // ── Workflow templates ─────────────────────────────────────────────
  // Include-based: copy only the workflow subdirectories, then generate
  // a clean package.json and tsconfig rather than copying and patching.
  const workflowsSrc = join(ROOT, ".atomic/workflows");
  const workflowsDest = join(STAGING, ".atomic/workflows");
  await mkdir(workflowsDest, { recursive: true });

  // Filter workflow entries using the same .gitignore the runtime uses for discovery
  const gitignorePath = join(workflowsSrc, ".gitignore");
  const ig = ignore().add(await Bun.file(gitignorePath).text());

  const entries = await readdir(workflowsSrc, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !ig.ignores(entry.name + "/"))
      .map((entry) => cp(join(workflowsSrc, entry.name), join(workflowsDest, entry.name), { recursive: true })),
  );

  // Write a release package.json referencing the published SDK version
  const sdkPkgPath = join(ROOT, WORKFLOW_SDK_DIR, "package.json");
  const sdkVersion: string = (await Bun.file(sdkPkgPath).json()).version;
  const workflowsPkg = {
    name: "atomic-workflows",
    private: true,
    type: "module",
    dependencies: {
      [SDK_PACKAGE_NAME]: `^${sdkVersion}`,
    },
  };
  await writeFile(join(workflowsDest, "package.json"), JSON.stringify(workflowsPkg, null, 2) + "\n");

  // Write a minimal tsconfig (no monorepo path aliases)
  await writeFile(join(workflowsDest, "tsconfig.json"), WORKFLOWS_TSCONFIG + "\n");

  // ── Create archives ────────────────────────────────────────────────
  await mkdir(DIST, { recursive: true });

  console.log("Creating atomic-config.tar.gz…");
  await $`tar -czvf ${join(DIST, "atomic-config.tar.gz")} -C ${STAGING} .`;

  console.log("Creating atomic-config.zip…");
  await $`zip -r ${join(DIST, "atomic-config.zip")} .`.cwd(STAGING);

  // Clean up staging directory
  await rm(STAGING, { recursive: true, force: true });

  console.log("\nConfig archives created in dist/.");
}

main().catch(async (err) => {
  console.error(err);
  await rm(STAGING, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
