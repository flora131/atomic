/**
 * Tests for the __ATOMIC_BASELINE__ build-time flag derivation logic
 * in build-binary.ts.
 *
 * Since build-binary.ts executes Bun.build() at module scope, we test the
 * pure logic (baseline detection and define block construction) in isolation
 * rather than importing the script directly.
 */

import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Replicate the pure logic from build-binary.ts
// ---------------------------------------------------------------------------

function deriveIsBaseline(baselineFlag: boolean, target?: string): boolean {
  return baselineFlag || (target?.includes("baseline") ?? false);
}

function buildDefineBlock(
  isBaseline: boolean,
  workerPath: string,
): Record<string, string> {
  return {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(workerPath),
    ...(isBaseline ? { __ATOMIC_BASELINE__: JSON.stringify(true) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("build-binary baseline flag derivation", () => {
  describe("deriveIsBaseline", () => {
    test("returns true for bun-windows-x64-baseline target", () => {
      expect(deriveIsBaseline(false, "bun-windows-x64-baseline")).toBe(true);
    });

    test("returns true for bun-linux-x64-baseline target", () => {
      expect(deriveIsBaseline(false, "bun-linux-x64-baseline")).toBe(true);
    });

    test("returns true when --baseline flag is set without target", () => {
      expect(deriveIsBaseline(true, undefined)).toBe(true);
    });

    test("returns true when --baseline flag is set with non-baseline target", () => {
      expect(deriveIsBaseline(true, "bun-windows-x64")).toBe(true);
    });

    test("returns false for bun-windows-x64 target (no baseline)", () => {
      expect(deriveIsBaseline(false, "bun-windows-x64")).toBe(false);
    });

    test("returns false for bun-darwin-arm64 target", () => {
      expect(deriveIsBaseline(false, "bun-darwin-arm64")).toBe(false);
    });

    test("returns false when target is undefined (native build)", () => {
      expect(deriveIsBaseline(false, undefined)).toBe(false);
    });

    test("returns false for empty string target", () => {
      expect(deriveIsBaseline(false, "")).toBe(false);
    });
  });

  describe("buildDefineBlock", () => {
    const workerPath = "/$bunfs/root/node_modules/@opentui/core/parser.worker.js";

    test("includes __ATOMIC_BASELINE__ when isBaseline is true", () => {
      const defines = buildDefineBlock(true, workerPath);
      expect(defines).toHaveProperty("__ATOMIC_BASELINE__");
      expect(defines.__ATOMIC_BASELINE__).toBe(JSON.stringify(true));
      expect(defines.OTUI_TREE_SITTER_WORKER_PATH).toBe(JSON.stringify(workerPath));
    });

    test("omits __ATOMIC_BASELINE__ when isBaseline is false", () => {
      const defines = buildDefineBlock(false, workerPath);
      expect(defines).not.toHaveProperty("__ATOMIC_BASELINE__");
      expect(defines.OTUI_TREE_SITTER_WORKER_PATH).toBe(JSON.stringify(workerPath));
    });

    test("define block has exactly 2 keys when baseline is true", () => {
      const defines = buildDefineBlock(true, workerPath);
      expect(Object.keys(defines)).toHaveLength(2);
    });

    test("define block has exactly 1 key when baseline is false", () => {
      const defines = buildDefineBlock(false, workerPath);
      expect(Object.keys(defines)).toHaveLength(1);
    });
  });
});
