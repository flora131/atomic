/**
 * Tree-sitter Asset Embedding for Binary Builds
 *
 * When compiled with `bun build --compile`, the `import ... with { type: "file" }`
 * statements in @opentui/core's pre-bundled chunk resolve paths relative to
 * `import.meta.url`, which points to the binary—not the original package location.
 * This module re-imports Tree-sitter grammar/query assets so Bun's compiler
 * embeds them in the binary's virtual filesystem ($bunfs), then overrides
 * parser paths via `addDefaultParsers()`. The worker path itself is injected
 * at compile-time by `src/scripts/build-binary.ts` (OpenCode pattern).
 */

import { addDefaultParsers } from "@opentui/core";
import { resolve } from "path";

declare const OTUI_TREE_SITTER_WORKER_PATH: string;


// -- WASM language grammars --------------------------------------------------
// @ts-expect-error: Bun-specific import attribute for file embedding
import jsWasm from "../../../node_modules/@opentui/core/assets/javascript/tree-sitter-javascript.wasm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import tsWasm from "../../../node_modules/@opentui/core/assets/typescript/tree-sitter-typescript.wasm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdWasm from "../../../node_modules/@opentui/core/assets/markdown/tree-sitter-markdown.wasm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdInlineWasm from "../../../node_modules/@opentui/core/assets/markdown_inline/tree-sitter-markdown_inline.wasm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import zigWasm from "../../../node_modules/@opentui/core/assets/zig/tree-sitter-zig.wasm" with { type: "file" };

// -- SCM highlight / injection queries ---------------------------------------
// @ts-expect-error: Bun-specific import attribute for file embedding
import jsHighlights from "../../../node_modules/@opentui/core/assets/javascript/highlights.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import tsHighlights from "../../../node_modules/@opentui/core/assets/typescript/highlights.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdHighlights from "../../../node_modules/@opentui/core/assets/markdown/highlights.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdInjections from "../../../node_modules/@opentui/core/assets/markdown/injections.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdInlineHighlights from "../../../node_modules/@opentui/core/assets/markdown_inline/highlights.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import zigHighlights from "../../../node_modules/@opentui/core/assets/zig/highlights.scm" with { type: "file" };

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
  // OpenCode-style binary builds inject OTUI_TREE_SITTER_WORKER_PATH at compile
  // time. Keep a runtime fallback for local dev/repo installs.
  if (!process.env.OTUI_TREE_SITTER_WORKER_PATH && !getCompileTimeTreeSitterWorkerPath()) {
    process.env.OTUI_TREE_SITTER_WORKER_PATH = getRuntimeTreeSitterWorkerPath();
  }

  addDefaultParsers([
    {
      filetype: "javascript",
      wasm: jsWasm,
      queries: { highlights: [jsHighlights] },
    },
    {
      filetype: "typescript",
      wasm: tsWasm,
      queries: { highlights: [tsHighlights] },
    },
    {
      filetype: "markdown",
      wasm: mdWasm,
      queries: {
        highlights: [mdHighlights],
        injections: [mdInjections],
      },
      injectionMapping: {
        nodeTypes: {
          inline: "markdown_inline",
          pipe_table_cell: "markdown_inline",
        },
        infoStringMap: {
          javascript: "javascript",
          js: "javascript",
          typescript: "typescript",
          ts: "typescript",
          markdown: "markdown",
          md: "markdown",
        },
      },
    },
    {
      filetype: "markdown_inline",
      wasm: mdInlineWasm,
      queries: { highlights: [mdInlineHighlights] },
    },
    {
      filetype: "zig",
      wasm: zigWasm,
      queries: { highlights: [zigHighlights] },
    },
  ]);
}
