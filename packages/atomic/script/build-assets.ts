import { mkdir, rm, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, basename, extname } from "node:path";
import { $ } from "bun";
import { findRepoRoot } from "../src/lib/workspace-paths.ts";

interface ArchiveSpec {
  outPath: string;
  leafDir: string;
  excludes?: readonly string[];
}

export async function bundleEmbeddedAssets(rootDir: string): Promise<void> {
  // Ensure .agents/ dir exists at workspace root (for skills.tar)
  await mkdir(join(rootDir, ".agents"), { recursive: true });

  const archives: ArchiveSpec[] = [
    { outPath: join(rootDir, ".claude.tar"),           leafDir: join(rootDir, ".claude") },
    { outPath: join(rootDir, ".opencode.tar"),         leafDir: join(rootDir, ".opencode") },
    { outPath: join(rootDir, ".github.tar"),           leafDir: join(rootDir, ".github"),
      excludes: ["workflows", "dependabot.yml"] },
    { outPath: join(rootDir, ".agents", "skills.tar"), leafDir: join(rootDir, ".agents", "skills") },
  ];

  for (const { outPath, leafDir, excludes } of archives) {
    const excludeArgs = (excludes ?? []).map((ex) => `--exclude=${ex}`);
    const r = spawnSync(
      "tar",
      ["-cf", outPath, ...excludeArgs, "-C", leafDir, "."],
      { stdio: "inherit" },
    );
    if (r.status !== 0) {
      throw new Error(
        `bundleEmbeddedAssets: tar failed for ${outPath} (exit ${r.status})`,
      );
    }
    console.log(`bundled: ${outPath}`);
  }
}

interface RuntimeScriptSpec {
  /** Absolute path to the canonical TS source. */
  src: string;
  /** Output filename (extension MUST be .js — bundle is ESM JS). */
  outName: string;
}

export async function emitRuntimeScriptBundles(rootDir: string): Promise<void> {
  const destDir = join(rootDir, "packages/atomic-sdk/src/lib/runtime-scripts");
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  const scripts: RuntimeScriptSpec[] = [
    {
      src: join(rootDir, "packages/atomic-sdk/src/runtime/cc-debounce.ts"),
      outName: "cc-debounce.script.js",
    },
    {
      src: join(rootDir, "packages/atomic-sdk/src/runtime/orchestrator-entry.ts"),
      outName: "orchestrator-entry.script.js",
    },
  ];

  // Pre-create empty placeholders so any `with { type: "file" }` asset import
  // that recursively references one of these output paths during bundling
  // (e.g. orchestrator-entry.ts -> executor.ts -> runtime-assets.ts ->
  //  ./runtime-scripts/orchestrator-entry.script.js) resolves at bundle time.
  // Each `bun build` invocation below overwrites the placeholder with the real
  // bundle.
  for (const { outName } of scripts) {
    await Bun.write(join(destDir, outName), "");
  }

  for (const { src, outName } of scripts) {
    // Use a per-script temp directory so that asset side-files emitted by
    // `bun build` (e.g. .wasm / .conf from transitive `{ type: "file" }`
    // imports) do not collide with other scripts and the main JS output can be
    // reliably renamed to the canonical `outName`.
    const tmpDir = join(destDir, `.tmp-${outName}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      await $`bun build ${src} --target bun --format esm --outdir ${tmpDir} --external 'node:*' --external 'bun:*'`;
      // bun build --outdir names the entry-point JS after the source file stem,
      // e.g. orchestrator-entry.ts -> orchestrator-entry.js.  Move it to the
      // canonical `outName` (e.g. orchestrator-entry.script.js) in destDir.
      const stem = basename(src, extname(src)); // e.g. "orchestrator-entry"
      await rename(join(tmpDir, `${stem}.js`), join(destDir, outName));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
    console.log(`bundled runtime script: ${outName}`);
  }
}

if (import.meta.main) {
  const rootDir = findRepoRoot(import.meta.dir);
  await Promise.all([
    bundleEmbeddedAssets(rootDir),
    emitRuntimeScriptBundles(rootDir),
  ]);
}
