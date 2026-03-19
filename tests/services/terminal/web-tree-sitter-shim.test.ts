import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureWebTreeSitterWasmShim,
  type WebTreeSitterShimPaths,
} from "@/services/terminal/web-tree-sitter-shim.ts";

async function createShimFixture(): Promise<{
  root: string;
  paths: WebTreeSitterShimPaths;
}> {
  const root = await mkdtemp(join(tmpdir(), "web-tree-sitter-shim-"));
  const packageDir = join(root, "node_modules", "web-tree-sitter");
  const parserWorkerPath = join(root, "node_modules", "@opentui", "core", "parser.worker.js");

  await mkdir(packageDir, { recursive: true });
  await mkdir(join(root, "node_modules", "@opentui", "core"), { recursive: true });

  await writeFile(join(packageDir, "tree-sitter.wasm"), "wasm-binary", "utf8");
  await writeFile(join(packageDir, "tree-sitter.wasm.map"), "wasm-map", "utf8");
  await writeFile(
    parserWorkerPath,
    'await import("web-tree-sitter/web-tree-sitter.wasm", { with: { type: "wasm" } });\n',
    "utf8",
  );

  return {
    root,
    paths: {
      packageDir,
      parserWorkerPath,
    },
  };
}

describe("ensureWebTreeSitterWasmShim", () => {
  test("creates Bun-compatible wasm aliases and patches the OpenTUI worker import", async () => {
    const fixture = await createShimFixture();

    try {
      ensureWebTreeSitterWasmShim(fixture.paths);
      ensureWebTreeSitterWasmShim(fixture.paths);

      expect(await readFile(join(fixture.paths.packageDir, "web-tree-sitter.wasm"), "utf8")).toBe("wasm-binary");
      expect(await readFile(join(fixture.paths.packageDir, "web-tree-sitter.wasm.map"), "utf8")).toBe("wasm-map");

      const parserWorker = await readFile(fixture.paths.parserWorkerPath, "utf8");
      expect(parserWorker.includes('"web-tree-sitter/web-tree-sitter.wasm"')).toBe(false);
      expect(parserWorker.includes('"web-tree-sitter/tree-sitter.wasm"')).toBe(true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
