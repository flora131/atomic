#!/usr/bin/env bun

import { parseArgs } from "node:util";

type BuildOptions = {
  outfile: string;
  minify: boolean;
  target?: string;
  baseline: boolean;
};

function parseCompileTarget(target: string): string {
  if (!target.startsWith("bun-")) {
    throw new Error(`Invalid --target ${target}. Expected bun-<os>-<arch>.`);
  }

  return target;
}

function parseBuildOptions(argv: string[]): BuildOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      outfile: { type: "string" },
      target: { type: "string" },
      baseline: { type: "boolean", default: false },
      minify: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!values.outfile) {
    throw new Error("Missing required --outfile <path> argument");
  }

  return {
    outfile: values.outfile,
    target: values.target ? parseCompileTarget(values.target) : undefined,
    baseline: values.baseline ?? false,
    minify: values.minify ?? false,
  };
}

export function deriveIsBaseline(baselineFlag: boolean, target?: string): boolean {
  return baselineFlag || (target?.includes("baseline") ?? false);
}


if (import.meta.main) {
  const options = parseBuildOptions(Bun.argv.slice(2));
  const isBaseline = deriveIsBaseline(options.baseline, options.target);

  const result = await Bun.build({
    entrypoints: ["src/cli.ts"],
    minify: options.minify,
    compile: {
      outfile: options.outfile,
      autoloadDotenv: false,
      autoloadBunfig: false,
      ...(options.target ? { target: options.target as never } : {}),
    },
    define: isBaseline ? { __ATOMIC_BASELINE__: JSON.stringify(true) } : {},
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
}
