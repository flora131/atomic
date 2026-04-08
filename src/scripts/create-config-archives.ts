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
import { mkdir, cp, rm, writeFile } from "fs/promises";

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
      "**/claude/**/*.ts",
      "**/copilot/**/*.ts",
      "**/opencode/**/*.ts",
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
  for (const dir of [".claude/agents", ".opencode/agents", ".github/agents"]) {
    const dest = join(STAGING, dir);
    await mkdir(dest, { recursive: true });
    await cp(join(ROOT, dir), dest, { recursive: true });
  }
  await cp(join(ROOT, ".github/lsp.json"), join(STAGING, ".github/lsp.json"));

  // ── Workflow templates ─────────────────────────────────────────────
  const workflowsSrc = join(ROOT, ".atomic/workflows");
  const workflowsDest = join(STAGING, ".atomic/workflows");
  await cp(workflowsSrc, workflowsDest, { recursive: true });

  // Remove dev-only artifacts
  await rm(join(workflowsDest, "node_modules"), { recursive: true, force: true });
  await rm(join(workflowsDest, "package-lock.json"), { force: true });
  await rm(join(workflowsDest, "bun.lock"), { force: true });

  // Rewrite the dev file: reference to the published npm version
  const sdkPkgPath = join(ROOT, "packages/workflow-sdk/package.json");
  const sdkVersion: string = (await Bun.file(sdkPkgPath).json()).version;

  const workflowsPkgPath = join(workflowsDest, "package.json");
  const workflowsPkg = await Bun.file(workflowsPkgPath).json();
  workflowsPkg.dependencies["@bastani/atomic-workflows"] = `^${sdkVersion}`;
  await writeFile(workflowsPkgPath, JSON.stringify(workflowsPkg, null, 2) + "\n");

  // Strip dev-only tsconfig paths alias (points to monorepo packages/ dir)
  await writeFile(join(workflowsDest, "tsconfig.json"), WORKFLOWS_TSCONFIG + "\n");

  // ── Create archives ────────────────────────────────────────────────
  await mkdir(DIST, { recursive: true });

  console.log("Creating atomic-config.tar.gz…");
  await $`tar -czvf ${join(DIST, "atomic-config.tar.gz")} -C ${STAGING} .`;

  console.log("Creating atomic-config.zip…");
  await $`cd ${STAGING} && zip -r ${join(DIST, "atomic-config.zip")} .`;

  // Clean up staging
  await rm(STAGING, { recursive: true, force: true });

  console.log("\nConfig archives created in dist/.");
}

main();
