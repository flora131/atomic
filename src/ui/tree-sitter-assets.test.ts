import { describe, expect, test } from "bun:test";
import { initTreeSitterAssets } from "./tree-sitter-assets.ts";

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

  test("uses env fallback when compile-time worker path is unavailable", () => {
    withWorkerPathEnv(undefined, () => {
      initTreeSitterAssets();

      expect(process.env.OTUI_TREE_SITTER_WORKER_PATH).toContain("parser.worker.js");
    });
  });
});
