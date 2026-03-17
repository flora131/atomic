import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CORRECT_WASM_IMPORT = '"web-tree-sitter/tree-sitter.wasm"';
const BROKEN_WASM_IMPORT = '"web-tree-sitter/web-tree-sitter.wasm"';

export interface WebTreeSitterShimPaths {
  packageDir: string;
  parserWorkerPath: string;
}

export function getDefaultWebTreeSitterShimPaths(): WebTreeSitterShimPaths {
  return {
    packageDir: resolve(import.meta.dir, "../../../node_modules/web-tree-sitter"),
    parserWorkerPath: resolve(import.meta.dir, "../../../node_modules/@opentui/core/parser.worker.js"),
  };
}

function ensureFileCopy(sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath) || existsSync(targetPath)) {
    return;
  }

  copyFileSync(sourcePath, targetPath);
}

function ensurePatchedParserWorkerImport(parserWorkerPath: string): void {
  if (!existsSync(parserWorkerPath)) {
    return;
  }

  const current = readFileSync(parserWorkerPath, "utf8");
  if (!current.includes(BROKEN_WASM_IMPORT)) {
    return;
  }

  writeFileSync(
    parserWorkerPath,
    current.replaceAll(BROKEN_WASM_IMPORT, CORRECT_WASM_IMPORT),
    "utf8",
  );
}

/**
 * Bun resolves the `web-tree-sitter/tree-sitter.wasm` package export but NOT
 * the bare filename `web-tree-sitter/web-tree-sitter.wasm`. OpenTUI's bundled
 * parser worker may ship with the non-resolvable path; this shim:
 *
 * 1. Creates a `web-tree-sitter.wasm` alias (for any code using the filename
 *    directly outside the module resolver).
 * 2. Patches the worker import back to the correct package export path.
 */
export function ensureWebTreeSitterWasmShim(paths: WebTreeSitterShimPaths = getDefaultWebTreeSitterShimPaths()): void {
  const { packageDir, parserWorkerPath } = paths;

  ensureFileCopy(
    resolve(packageDir, "tree-sitter.wasm"),
    resolve(packageDir, "web-tree-sitter.wasm"),
  );
  ensureFileCopy(
    resolve(packageDir, "tree-sitter.wasm.map"),
    resolve(packageDir, "web-tree-sitter.wasm.map"),
  );
  ensurePatchedParserWorkerImport(parserWorkerPath);
}
