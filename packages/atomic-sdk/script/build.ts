/**
 * SDK build — compile TypeScript sources to `dist/`. The publish step
 * (`script/publish.ts`) rewrites `package.json#exports` to point at the
 * compiled output before invoking `npm publish`.
 *
 * Two-step:
 *   1. tsc emits .d.ts + .d.ts.map (emitDeclarationOnly: true in tsconfig.build.json)
 *   2. bun build emits .js ESM bundles, externalising all deps + node:* builtins
 */

import { $ } from "bun";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitRuntimeScriptBundles } from "../../atomic/script/build-assets.ts";

const SDK_PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE_ROOT = join(SDK_PKG_ROOT, "../..");
const distDir = join(SDK_PKG_ROOT, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

// 0. Bundle runtime scripts into src/lib/runtime-scripts/ so tsc + bun build pick them up.
await emitRuntimeScriptBundles(WORKSPACE_ROOT);

// 1. Emit .d.ts via tsc.
await $`bunx tsc --project tsconfig.build.json`.cwd(SDK_PKG_ROOT);

// 2. Bundle JS via bun build, externalising dependencies + peerDependencies + node:* builtins.
const pkg = await Bun.file(join(SDK_PKG_ROOT, "package.json")).json() as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports: Record<string, string>;
};

const externals = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "node:*",
];

// exports values are plain strings like "./src/index.ts" — strip leading "./" for bun build paths.
const entries = Object.values(pkg.exports)
  .filter((s): s is string => typeof s === "string")
  .map((s) => s.replace(/^\.\//, ""));

const externalArgs = externals.flatMap((e) => ["--external", e]);

await $`bun build ${entries} \
  --target node \
  --format esm \
  --outdir ${distDir} \
  --root src \
  --splitting \
  ${externalArgs}`.cwd(SDK_PKG_ROOT);
