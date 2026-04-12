/**
 * Build script for the @bastani/atomic SDK.
 *
 * Generates two artifacts in dist/:
 *   1. JS output  — via Bun.build() with all packages external
 *   2. .d.ts files — via tsc (with .ts → .js specifier rewriting)
 */

import { Glob, $ } from "bun";

const pkg = await Bun.file("package.json").json();

const entrypoints: string[] = Object.entries(
  pkg.exports as Record<string, string | { bun?: string }>,
).map(([key, v]) => {
  const entry = typeof v === "string" ? v : v.bun;
  if (!entry) throw new Error(`Export "${key}" is missing a "bun" entrypoint`);
  return entry;
});

await $`rm -rf dist`;

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

// 3. Rewrite .ts/.tsx → .js in relative specifiers within .d.ts files
//    so consumers resolve ./foo.js → ./foo.d.ts via standard TS resolution.
const tsExtRe = /(from\s+["']\.\.?\/[^"']*?)\.tsx?(["'])/g;

for await (const path of new Glob("**/*.d.ts").scan("dist")) {
  const file = Bun.file(`dist/${path}`);
  const text = await file.text();
  const rewritten = text.replace(tsExtRe, "$1.js$2");
  if (rewritten !== text) await Bun.write(file, rewritten);
}

// 4. Post-build validation
let dtsCount = 0;
const staleSpecifiers: string[] = [];

for await (const path of new Glob("**/*.d.ts").scan("dist")) {
  dtsCount++;
  const text = await Bun.file(`dist/${path}`).text();
  const matches = text.match(tsExtRe);
  if (matches) staleSpecifiers.push(`  dist/${path}: ${matches.join(", ")}`);
}

if (dtsCount === 0) {
  console.error("Build validation failed: dist/ contains no .d.ts files");
  process.exit(1);
}

if (staleSpecifiers.length > 0) {
  console.error(
    "Build validation failed: .d.ts files still contain .ts specifiers:\n" +
      staleSpecifiers.join("\n"),
  );
  process.exit(1);
}

console.log(`Build complete → dist/ (${dtsCount} declaration files verified)`);
