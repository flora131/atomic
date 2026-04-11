/**
 * Build script for the @bastani/atomic SDK.
 *
 * Generates two artifacts in dist/:
 *   1. JS output  — via Bun.build() with all packages external
 *   2. .d.ts files — via tsc (with .ts → .js specifier rewriting)
 */

import { Glob, $ } from "bun";

const pkg = await Bun.file("package.json").json();

const entrypoints: string[] = Object.values(
  pkg.exports as Record<string, string | { bun: string }>,
).map((v) => (typeof v === "string" ? v : v.bun));

await $`rm -rf dist`;

// 1. JS output
const result = await Bun.build({
  entrypoints,
  outdir: "./dist",
  root: "./src",
  target: "bun",
  format: "esm",
  splitting: true,
  packages: "external",
});

if (!result.success) {
  console.error("JS build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// 2. Declaration files
await $`bunx tsc --project tsconfig.build.json`;

// 3. Rewrite .ts/.tsx → .js in relative specifiers within .d.ts files
//    so consumers resolve ./foo.js → ./foo.d.ts via standard TS resolution.
const tsExtRe = /(from\s+["']\.\.?\/[^"']*?)\.tsx?(["'])/g;

for await (const path of new Glob("**/*.d.ts").scan("dist")) {
  const file = Bun.file(`dist/${path}`);
  const text = await file.text();
  const rewritten = text.replace(tsExtRe, "$1.js$2");
  if (rewritten !== text) await Bun.write(file, rewritten);
}

console.log("Build complete → dist/");
