/**
 * Tree-sitter Asset Embedding for Binary Builds
 *
 * When compiled with `bun build --compile`, the `import ... with { type: "file" }`
 * statements in @opentui/core's pre-bundled chunk resolve paths relative to
 * `import.meta.url`, which points to the binary—not the original package location.
 * This module re-imports all Tree-sitter assets so Bun's compiler embeds them in
 * the binary's virtual filesystem ($bunfs), then overrides the default parser
 * paths via `addDefaultParsers()`.
 */

import { addDefaultParsers } from "@opentui/core";

// -- WASM language grammars --------------------------------------------------
// @ts-expect-error: Bun-specific import attribute for file embedding
import jsWasm from "../../node_modules/@opentui/core/assets/javascript/tree-sitter-javascript.wasm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import tsWasm from "../../node_modules/@opentui/core/assets/typescript/tree-sitter-typescript.wasm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdWasm from "../../node_modules/@opentui/core/assets/markdown/tree-sitter-markdown.wasm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdInlineWasm from "../../node_modules/@opentui/core/assets/markdown_inline/tree-sitter-markdown_inline.wasm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import zigWasm from "../../node_modules/@opentui/core/assets/zig/tree-sitter-zig.wasm" with { type: "file" };

// -- SCM highlight / injection queries ---------------------------------------
// @ts-expect-error: Bun-specific import attribute for file embedding
import jsHighlights from "../../node_modules/@opentui/core/assets/javascript/highlights.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import tsHighlights from "../../node_modules/@opentui/core/assets/typescript/highlights.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdHighlights from "../../node_modules/@opentui/core/assets/markdown/highlights.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdInjections from "../../node_modules/@opentui/core/assets/markdown/injections.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import mdInlineHighlights from "../../node_modules/@opentui/core/assets/markdown_inline/highlights.scm" with { type: "file" };
// @ts-expect-error: Bun-specific import attribute for file embedding
import zigHighlights from "../../node_modules/@opentui/core/assets/zig/highlights.scm" with { type: "file" };

// -- Parser worker -----------------------------------------------------------
// @ts-expect-error: Bun-specific import attribute for file embedding
import parserWorker from "../../node_modules/@opentui/core/parser.worker.js" with { type: "file" };

/**
 * Override default Tree-sitter parsers with embedded asset paths and set the
 * worker path. Must be called before any TreeSitterClient is initialised
 * (i.e. before `createCliRenderer()` or the first `<markdown>` render).
 */
export function initTreeSitterAssets(): void {
  // Point the worker at the embedded file so the TreeSitterClient doesn't try
  // to resolve it relative to import.meta.url of the @opentui/core bundle.
  process.env.OTUI_TREE_SITTER_WORKER_PATH = parserWorker;

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
