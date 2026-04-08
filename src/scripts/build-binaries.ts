#!/usr/bin/env bun
/**
 * Builds Atomic CLI binaries for all supported platforms.
 *
 * Usage:
 *   bun run src/scripts/build-binaries.ts
 *
 * Produces binaries in dist/:
 *   atomic-linux-x64, atomic-linux-arm64,
 *   atomic-darwin-x64, atomic-darwin-arm64,
 *   atomic-windows-x64.exe, atomic-windows-arm64.exe
 */

import { $ } from "bun";
import { resolve } from "path";
import { mkdir } from "fs/promises";

const ROOT = resolve(import.meta.dir, "../..");
const DIST = resolve(ROOT, "dist");
const ENTRY = resolve(ROOT, "src/cli.ts");

const BUILD_FLAGS = [
  "--compile",
  "--minify",
  "--no-compile-autoload-dotenv",
  "--no-compile-autoload-bunfig",
] as const;

interface Target {
  bun: string;
  outfile: string;
  defines?: Record<string, string>;
}

const TARGETS: Target[] = [
  { bun: "bun-linux-x64", outfile: "atomic-linux-x64" },
  { bun: "bun-linux-arm64", outfile: "atomic-linux-arm64" },
  { bun: "bun-darwin-x64", outfile: "atomic-darwin-x64" },
  { bun: "bun-darwin-arm64", outfile: "atomic-darwin-arm64" },
  { bun: "bun-windows-x64", outfile: "atomic-windows-x64.exe" },
  // Windows arm64: baseline x64 binary that runs under emulation
  {
    bun: "bun-windows-x64-baseline",
    outfile: "atomic-windows-arm64.exe",
    defines: { __ATOMIC_BASELINE__: '"true"' },
  },
];

async function main(): Promise<void> {
  await mkdir(DIST, { recursive: true });

  await Promise.all(
    TARGETS.map(async (target) => {
      const outfile = resolve(DIST, target.outfile);
      const defineFlags = target.defines
        ? Object.entries(target.defines).flatMap(
            ([k, v]) => [`--define`, `${k}=${v}`],
          )
        : [];

      console.log(`Building ${target.outfile} (${target.bun})…`);
      await $`bun build ${BUILD_FLAGS} ${defineFlags} --target=${target.bun} --outfile ${outfile} ${ENTRY}`;
    }),
  );

  console.log("\nAll binaries built in dist/.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
