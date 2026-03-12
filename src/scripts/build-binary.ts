#!/usr/bin/env bun

import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ensureWebTreeSitterWasmShim } from "@/services/terminal/web-tree-sitter-shim.ts";

type BuildOptions = {
  outfile: string;
  minify: boolean;
  target?: string;
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
    minify: values.minify ?? false,
  };
}

function inferTargetOs(target?: string): NodeJS.Platform {
  if (!target) {
    return process.platform;
  }

  const normalizedTarget = target.toLowerCase();

  if (normalizedTarget.includes("windows") || normalizedTarget.includes("win32")) {
    return "win32";
  }

  if (normalizedTarget.includes("linux")) {
    return "linux";
  }

  if (normalizedTarget.includes("darwin") || normalizedTarget.includes("mac")) {
    return "darwin";
  }

  throw new Error(`Unable to infer target OS from --target ${target}`);
}

function getBunfsRoot(targetOs: NodeJS.Platform): string {
  return targetOs === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
}

const options = parseBuildOptions(Bun.argv.slice(2));

ensureWebTreeSitterWasmShim();

const projectRoot = process.cwd();
const parserWorker = realpathSync(resolve(projectRoot, "node_modules/@opentui/core/parser.worker.js"));
const workerRelativePath = relative(projectRoot, parserWorker).replaceAll("\\", "/");
const compileTargetOs = inferTargetOs(options.target);

const result = await Bun.build({
  entrypoints: ["src/cli.ts", parserWorker],
  minify: options.minify,
  compile: {
    outfile: options.outfile,
    autoloadDotenv: false,
    autoloadBunfig: false,
    ...(options.target ? { target: options.target as never } : {}),
  },
  define: {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(`${getBunfsRoot(compileTargetOs)}${workerRelativePath}`),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
