/**
 * Unit tests for useStableCallback and useStableValue hooks
 *
 * These tests verify that the module exports the correct symbols and that
 * the hooks are properly typed. Full React lifecycle testing (identity
 * stability across renders) requires a React testing library with
 * renderHook, which will be covered in the integration test task (#14).
 *
 * What we validate here:
 * - Module exports exist and are functions
 * - Default export is useStableCallback
 * - Re-export from hooks/index.ts works
 */

import { describe, test, expect } from "bun:test";

// Direct module imports
import {
  useStableCallback,
  useStableValue,
  default as defaultExport,
} from "@/hooks/use-stable-callback.ts";

// Barrel re-exports from index
import {
  useStableCallback as reExportedCallback,
  useStableValue as reExportedValue,
  useStableCallbackDefault,
} from "@/hooks/index.ts";

// ============================================================================
// Tests: Module Exports
// ============================================================================

describe("use-stable-callback module exports", () => {
  test("useStableCallback is exported as a function", () => {
    expect(typeof useStableCallback).toBe("function");
  });

  test("useStableValue is exported as a function", () => {
    expect(typeof useStableValue).toBe("function");
  });

  test("default export is useStableCallback", () => {
    expect(defaultExport).toBe(useStableCallback);
  });
});

// ============================================================================
// Tests: Barrel Re-exports
// ============================================================================

describe("hooks/index re-exports", () => {
  test("useStableCallback is re-exported from index", () => {
    expect(reExportedCallback).toBe(useStableCallback);
  });

  test("useStableValue is re-exported from index", () => {
    expect(reExportedValue).toBe(useStableValue);
  });

  test("useStableCallbackDefault is re-exported from index", () => {
    expect(useStableCallbackDefault).toBe(useStableCallback);
  });
});
