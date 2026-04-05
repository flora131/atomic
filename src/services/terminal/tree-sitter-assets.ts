/**
 * Tree-sitter Asset Embedding for Binary Builds
 *
 * When compiled with `bun build --compile`, the `import ... with { type: "file" }`
 * statements in @opentui/core's pre-bundled chunk resolve paths relative to
 * `import.meta.url`, which points to the binary—not the original package location.
 *
 * The generated `src/parsers.ts` (via `bun run update:parsers`) re-imports
 * Tree-sitter grammar/query assets so Bun's compiler embeds them in the
 * binary's virtual filesystem ($bunfs), then overrides parser paths via
 * `addDefaultParsers()`. The worker path itself is injected at compile-time
 * by `src/scripts/build-binary.ts`.
 */

import { addDefaultParsers } from "@opentui/core";
import { resolve } from "path";
import { ensureWebTreeSitterWasmShim } from "@/services/terminal/web-tree-sitter-shim.ts";
import { getParsers } from "@/parsers.ts";

declare const OTUI_TREE_SITTER_WORKER_PATH: string;

function getCompileTimeTreeSitterWorkerPath(): string | undefined {
  if (
    typeof OTUI_TREE_SITTER_WORKER_PATH === "undefined" ||
    OTUI_TREE_SITTER_WORKER_PATH.length === 0
  ) {
    return undefined;
  }

  return OTUI_TREE_SITTER_WORKER_PATH;
}

function getRuntimeTreeSitterWorkerPath(): string {
  return resolve(import.meta.dir, "../../../node_modules/@opentui/core/parser.worker.js");
}

/**
 * Override default Tree-sitter parsers with embedded asset paths and set the
 * worker path. Must be called before any TreeSitterClient is initialised
 * (i.e. before `createCliRenderer()` or the first `<markdown>` render).
 */
export function initTreeSitterAssets(): void {
  ensureWebTreeSitterWasmShim();

  // OpenCode-style binary builds inject OTUI_TREE_SITTER_WORKER_PATH at compile
  // time. Keep a runtime fallback for local dev/repo installs.
  if (!process.env.OTUI_TREE_SITTER_WORKER_PATH && !getCompileTimeTreeSitterWorkerPath()) {
    process.env.OTUI_TREE_SITTER_WORKER_PATH = getRuntimeTreeSitterWorkerPath();
  }

  addDefaultParsers(getParsers());
}
