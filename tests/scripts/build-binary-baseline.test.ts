/**
 * Tests for the __ATOMIC_BASELINE__ build-time flag derivation logic
 * in build-binary.ts.
 */

import { describe, test, expect } from "bun:test";
import { deriveIsBaseline } from "@/scripts/build-binary.ts";

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
});
