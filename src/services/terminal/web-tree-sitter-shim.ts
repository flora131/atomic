import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OPEN_TUI_TREE_WASM_IMPORT = '"web-tree-sitter/tree-sitter.wasm"';
const BUN_COMPAT_TREE_WASM_IMPORT = '"web-tree-sitter/web-tree-sitter.wasm"';

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
  if (!current.includes(OPEN_TUI_TREE_WASM_IMPORT)) {
    return;
  }

  writeFileSync(
    parserWorkerPath,
    current.replaceAll(OPEN_TUI_TREE_WASM_IMPORT, BUN_COMPAT_TREE_WASM_IMPORT),
    "utf8",
  );
}

/**
 * Bun currently resolves `web-tree-sitter/web-tree-sitter.wasm` but not the
 * package export alias used by OpenTUI's worker (`web-tree-sitter/tree-sitter.wasm`).
 * Keep both a filesystem shim and a one-line worker patch in place so source
 * runs and compiled binaries can both load the tree-sitter core WASM asset.
 */
export function ensureWebTreeSitterWasmShim(paths: WebTreeSitterShimPaths = getDefaultWebTreeSitterShimPaths()): void {
  const { packageDir, parserWorkerPath } = paths;

  ensureFileCopy(
    resolve(packageDir, "web-tree-sitter.wasm"),
    resolve(packageDir, "tree-sitter.wasm"),
  );
  ensureFileCopy(
    resolve(packageDir, "web-tree-sitter.wasm.map"),
    resolve(packageDir, "tree-sitter.wasm.map"),
  );
  ensurePatchedParserWorkerImport(parserWorkerPath);
}
