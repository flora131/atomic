/**
 * Build script for the @bastani/atomic SDK.
 *
 * Generates two artifacts in dist/:
 *   1. JS output  — via Bun.build() with all packages external
 *   2. .d.ts files — via tsc (with .ts → .js specifier rewriting)
 */

import { Glob, $ } from "bun";
import { rmSync } from "fs";

const pkg = await Bun.file("package.json").json();

const entrypoints: string[] = Object.entries(
  pkg.exports as Record<string, string | { bun?: string }>,
).map(([key, v]) => {
  const entry = typeof v === "string" ? v : v.bun;
  if (!entry) throw new Error(`Export "${key}" is missing a "bun" entrypoint`);
  return entry;
});

rmSync("dist", { recursive: true, force: true });

// 1. JS output
//    target: "bun" — the compiled JS is Bun-specific (adds // @bun pragma).
//    The "default" export condition exists for TypeScript / bundler resolution
//    in non-Bun toolchains, NOT for Node.js runtime use.
const result = await Bun.build({
  entrypoints,
  outdir: "./dist",
  root: "./src",
  target: "bun",
  format: "esm",
  splitting: true,
  packages: "external",
  sourcemap: "external",
});

if (!result.success) {
  console.error("JS build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// 2. Declaration files
//    tsc-alias rewrites the @/* path aliases in emitted .d.ts files
//    to relative paths, so source code can use @/ consistently while
//    the published declarations remain portable.
await $`bunx tsc --project tsconfig.build.json`;
await $`bunx tsc-alias --project tsconfig.build.json`;

// 3. Rewrite TS specifiers → JS in .d.ts files and validate in a single pass.
//    Extension mapping matches tsup's replaceDtsWithJsExtensions convention:
//    .ts/.tsx → .js, .mts → .mjs, .cts → .cjs
const tsExtRe = /(from\s+["']\.\.?\/[^"']*?)\.(tsx?|mts|cts)(["'])/g;
const aliasRe = /(from\s+["'])@\/[^"']+["']/g;
const jsExtMap: Record<string, string> = { ts: "js", tsx: "js", mts: "mjs", cts: "cjs" };
let dtsCount = 0;
const errors: string[] = [];

for await (const path of new Glob("**/*.d.ts").scan("dist")) {
  dtsCount++;
  const file = Bun.file(`dist/${path}`);
  const text = await file.text();
  const rewritten = text.replace(tsExtRe, (_, prefix, ext, quote) => `${prefix}.${jsExtMap[ext]}${quote}`);
  if (rewritten !== text) await Bun.write(file, rewritten);

  // Validate: no stale TS specifiers survived the rewrite
  const tsMatches = rewritten.match(tsExtRe);
  if (tsMatches) errors.push(`  dist/${path}: stale specifier — ${tsMatches.join(", ")}`);
  // Validate: no @/ aliases survived tsc-alias
  const aliasMatches = rewritten.match(aliasRe);
  if (aliasMatches) errors.push(`  dist/${path}: stale @/ alias — ${aliasMatches.join(", ")}`);
}

if (dtsCount === 0) {
  console.error("Build failed: dist/ contains no .d.ts files");
  process.exit(1);
}

if (errors.length > 0) {
  console.error("Build failed: declaration files have unresolved specifiers:\n" + errors.join("\n"));
  process.exit(1);
}

console.log(`Build complete → dist/ (${dtsCount} declaration files verified)`);
