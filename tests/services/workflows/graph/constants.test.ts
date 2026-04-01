import { describe, expect, test } from "bun:test";
import {
  BACKGROUND_COMPACTION_THRESHOLD,
  BUFFER_EXHAUSTION_THRESHOLD,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_GRAPH_CONFIG,
} from "@/services/workflows/graph/contracts/constants.ts";

// ============================================================================
// Threshold Constants
// ============================================================================

describe("BACKGROUND_COMPACTION_THRESHOLD", () => {
  test("is a number between 0 and 1", () => {
    expect(typeof BACKGROUND_COMPACTION_THRESHOLD).toBe("number");
    expect(BACKGROUND_COMPACTION_THRESHOLD).toBeGreaterThan(0);
    expect(BACKGROUND_COMPACTION_THRESHOLD).toBeLessThan(1);
  });

  test("equals 0.4", () => {
    expect(BACKGROUND_COMPACTION_THRESHOLD).toBe(0.4);
  });
});

describe("BUFFER_EXHAUSTION_THRESHOLD", () => {
  test("is a number between 0 and 1", () => {
    expect(typeof BUFFER_EXHAUSTION_THRESHOLD).toBe("number");
    expect(BUFFER_EXHAUSTION_THRESHOLD).toBeGreaterThan(0);
    expect(BUFFER_EXHAUSTION_THRESHOLD).toBeLessThan(1);
  });

  test("equals 0.6", () => {
    expect(BUFFER_EXHAUSTION_THRESHOLD).toBe(0.6);
  });

  test("is strictly greater than BACKGROUND_COMPACTION_THRESHOLD", () => {
    expect(BUFFER_EXHAUSTION_THRESHOLD).toBeGreaterThan(BACKGROUND_COMPACTION_THRESHOLD);
  });
});

// ============================================================================
// DEFAULT_RETRY_CONFIG
// ============================================================================

describe("DEFAULT_RETRY_CONFIG", () => {
  test("has maxAttempts set to 3", () => {
    expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
  });

  test("has backoffMs set to 1000", () => {
    expect(DEFAULT_RETRY_CONFIG.backoffMs).toBe(1000);
  });

  test("has backoffMultiplier set to 2", () => {
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
  });

  test("does not have a retryOn predicate by default", () => {
    expect(DEFAULT_RETRY_CONFIG.retryOn).toBeUndefined();
  });

  test("has exactly the expected keys", () => {
    const keys = Object.keys(DEFAULT_RETRY_CONFIG).sort();
    expect(keys).toEqual(["backoffMs", "backoffMultiplier", "maxAttempts"]);
  });

  test("all numeric values are positive", () => {
    expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBeGreaterThan(0);
    expect(DEFAULT_RETRY_CONFIG.backoffMs).toBeGreaterThan(0);
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBeGreaterThan(0);
  });
});

// ============================================================================
// DEFAULT_GRAPH_CONFIG
// ============================================================================

describe("DEFAULT_GRAPH_CONFIG", () => {
  test("has maxConcurrency set to 1", () => {
    expect(DEFAULT_GRAPH_CONFIG.maxConcurrency).toBe(1);
  });

  test("has autoCheckpoint set to true", () => {
    expect(DEFAULT_GRAPH_CONFIG.autoCheckpoint).toBe(true);
  });

  test("is a partial GraphConfig (no checkpointer, etc.)", () => {
    expect(DEFAULT_GRAPH_CONFIG.metadata).toBeUndefined();
  });

  test("has exactly the expected keys", () => {
    const keys = Object.keys(DEFAULT_GRAPH_CONFIG).sort();
    expect(keys).toEqual(["autoCheckpoint", "maxConcurrency"]);
  });
});
