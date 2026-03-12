import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { TreeSitterClient, getDataPaths } from "@opentui/core";
import { initTreeSitterAssets } from "@/services/terminal/tree-sitter-assets.ts";

function withWorkerPathEnv(envPath: string | undefined, callback: () => void): void {
  const originalEnvPath = process.env.OTUI_TREE_SITTER_WORKER_PATH;

  if (envPath === undefined) {
    delete process.env.OTUI_TREE_SITTER_WORKER_PATH;
  } else {
    process.env.OTUI_TREE_SITTER_WORKER_PATH = envPath;
  }

  try {
    callback();
  } finally {
    if (originalEnvPath === undefined) {
      delete process.env.OTUI_TREE_SITTER_WORKER_PATH;
    } else {
      process.env.OTUI_TREE_SITTER_WORKER_PATH = originalEnvPath;
    }
  }
}

describe("initTreeSitterAssets worker configuration", () => {
  test("keeps existing env worker path untouched", () => {
    withWorkerPathEnv("/tmp/custom-worker.js", () => {
      initTreeSitterAssets();

      expect(process.env.OTUI_TREE_SITTER_WORKER_PATH).toBe("/tmp/custom-worker.js");
    });
  });

  test("uses env fallback when compile-time worker path is unavailable", async () => {
    withWorkerPathEnv(undefined, () => {
      initTreeSitterAssets();

      expect(process.env.OTUI_TREE_SITTER_WORKER_PATH).toContain("parser.worker.js");
      expect(existsSync(process.env.OTUI_TREE_SITTER_WORKER_PATH ?? "")).toBe(true);
    });

    const client = new TreeSitterClient({ dataPath: getDataPaths().globalDataPath });

    await client.initialize();

    const result = await client.highlightOnce("# Title\n\n- one\n- two", "markdown");

    expect(result.error).toBeUndefined();
    expect(result.highlights?.length ?? 0).toBeGreaterThan(0);

    await client.destroy();
  });
});
