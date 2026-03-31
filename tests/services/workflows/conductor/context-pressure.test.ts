import { describe, expect, test } from "bun:test";
import {
  computePressureLevel,
  createSnapshot,
  createDefaultContextPressureConfig,
  createEmptyAccumulatedPressure,
  accumulateStageSnapshot,
  takeContextSnapshot,
  DEFAULT_ELEVATED_THRESHOLD,
  DEFAULT_CRITICAL_THRESHOLD,
} from "@/services/workflows/conductor/context-pressure.ts";
import type {
  ContextPressureConfig,
  ContextPressureSnapshot,
} from "@/services/workflows/conductor/types.ts";
import type { ContextUsage, Session } from "@/services/agents/types.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
  return {
    inputTokens: 5000,
    outputTokens: 3000,
    maxTokens: 100000,
    usagePercentage: 8,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ContextPressureConfig> = {}): ContextPressureConfig {
  return createDefaultContextPressureConfig(overrides);
}

function makeSnapshot(overrides: Partial<ContextPressureSnapshot> = {}): ContextPressureSnapshot {
  return {
    inputTokens: 5000,
    outputTokens: 3000,
    maxTokens: 100000,
    usagePercentage: 8,
    level: "normal",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeSessionWithUsage(usage: ContextUsage): Session {
  return {
    id: "test-session",
    send: async () => ({ type: "text" as const, content: "" }),
    stream: async function* () {},
    summarize: async () => {},
    getContextUsage: async () => usage,
    getSystemToolsTokens: () => 0,
    destroy: async () => {},
  };
}

function makeSessionThatThrows(): Session {
  return {
    id: "failing-session",
    send: async () => ({ type: "text" as const, content: "" }),
    stream: async function* () {},
    summarize: async () => {},
    getContextUsage: async () => { throw new Error("No query completed"); },
    getSystemToolsTokens: () => 0,
    destroy: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("context-pressure", () => {
  // -------------------------------------------------------------------------
  // Default Config Factory
  // -------------------------------------------------------------------------

  describe("createDefaultContextPressureConfig", () => {
    test("returns sensible defaults matching graph-level constants", () => {
      const config = createDefaultContextPressureConfig();

      expect(config.elevatedThreshold).toBe(DEFAULT_ELEVATED_THRESHOLD);
      expect(config.criticalThreshold).toBe(DEFAULT_CRITICAL_THRESHOLD);
    });

    test("defaults are 40/60", () => {
      const config = createDefaultContextPressureConfig();

      expect(config.elevatedThreshold).toBe(40);
      expect(config.criticalThreshold).toBe(60);
    });

    test("accepts partial overrides", () => {
      const config = createDefaultContextPressureConfig({
        criticalThreshold: 80,
      });

      expect(config.elevatedThreshold).toBe(40);
      expect(config.criticalThreshold).toBe(80);
    });
  });

  // -------------------------------------------------------------------------
  // Pressure Level Computation
  // -------------------------------------------------------------------------

  describe("computePressureLevel", () => {
    const config = makeConfig();

    test("returns 'normal' when usage is below elevated threshold", () => {
      expect(computePressureLevel(0, config)).toBe("normal");
      expect(computePressureLevel(10, config)).toBe("normal");
      expect(computePressureLevel(39.9, config)).toBe("normal");
    });

    test("returns 'elevated' when usage is at or above elevated but below critical", () => {
      expect(computePressureLevel(40, config)).toBe("elevated");
      expect(computePressureLevel(50, config)).toBe("elevated");
      expect(computePressureLevel(59.9, config)).toBe("elevated");
    });

    test("returns 'critical' when usage is at or above critical threshold", () => {
      expect(computePressureLevel(60, config)).toBe("critical");
      expect(computePressureLevel(75, config)).toBe("critical");
      expect(computePressureLevel(100, config)).toBe("critical");
    });

    test("respects custom thresholds", () => {
      const custom = makeConfig({ elevatedThreshold: 30, criticalThreshold: 50 });

      expect(computePressureLevel(25, custom)).toBe("normal");
      expect(computePressureLevel(30, custom)).toBe("elevated");
      expect(computePressureLevel(49, custom)).toBe("elevated");
      expect(computePressureLevel(50, custom)).toBe("critical");
    });

    test("handles edge case where elevated equals critical", () => {
      const same = makeConfig({ elevatedThreshold: 50, criticalThreshold: 50 });

      expect(computePressureLevel(49, same)).toBe("normal");
      expect(computePressureLevel(50, same)).toBe("critical");
    });
  });

  // -------------------------------------------------------------------------
  // Snapshot Creation
  // -------------------------------------------------------------------------

  describe("createSnapshot", () => {
    test("converts ContextUsage to ContextPressureSnapshot", () => {
      const usage = makeUsage({ usagePercentage: 30 });
      const config = makeConfig();
      const snapshot = createSnapshot(usage, config);

      expect(snapshot.inputTokens).toBe(usage.inputTokens);
      expect(snapshot.outputTokens).toBe(usage.outputTokens);
      expect(snapshot.maxTokens).toBe(usage.maxTokens);
      expect(snapshot.usagePercentage).toBe(30);
      expect(snapshot.level).toBe("normal");
      expect(typeof snapshot.timestamp).toBe("string");
    });

    test("assigns correct pressure level based on usage", () => {
      const config = makeConfig();

      expect(createSnapshot(makeUsage({ usagePercentage: 20 }), config).level).toBe("normal");
      expect(createSnapshot(makeUsage({ usagePercentage: 50 }), config).level).toBe("elevated");
      expect(createSnapshot(makeUsage({ usagePercentage: 70 }), config).level).toBe("critical");
    });

    test("includes ISO timestamp", () => {
      const snapshot = createSnapshot(makeUsage(), makeConfig());
      expect(() => new Date(snapshot.timestamp)).not.toThrow();
      expect(snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // -------------------------------------------------------------------------
  // takeContextSnapshot (async session integration)
  // -------------------------------------------------------------------------

  describe("takeContextSnapshot", () => {
    test("captures snapshot from session.getContextUsage()", async () => {
      const usage = makeUsage({ usagePercentage: 55, inputTokens: 10000 });
      const session = makeSessionWithUsage(usage);
      const config = makeConfig();

      const snapshot = await takeContextSnapshot(session, config);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.inputTokens).toBe(10000);
      expect(snapshot!.usagePercentage).toBe(55);
      expect(snapshot!.level).toBe("elevated");
    });

    test("returns null when getContextUsage() throws", async () => {
      const session = makeSessionThatThrows();
      const config = makeConfig();

      const snapshot = await takeContextSnapshot(session, config);

      expect(snapshot).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Accumulated Pressure
  // -------------------------------------------------------------------------

  describe("accumulated pressure", () => {
    test("createEmptyAccumulatedPressure returns zeroed state", () => {
      const empty = createEmptyAccumulatedPressure();

      expect(empty.totalInputTokens).toBe(0);
      expect(empty.totalOutputTokens).toBe(0);
      expect(empty.stageSnapshots.size).toBe(0);
    });

    test("accumulateStageSnapshot adds tokens and stores snapshot", () => {
      const empty = createEmptyAccumulatedPressure();
      const snapshot = makeSnapshot({ inputTokens: 5000, outputTokens: 3000 });

      const result = accumulateStageSnapshot(empty, "planner", snapshot);

      expect(result.totalInputTokens).toBe(5000);
      expect(result.totalOutputTokens).toBe(3000);
      expect(result.stageSnapshots.size).toBe(1);
      expect(result.stageSnapshots.get("planner")).toBe(snapshot);
      // Original is not mutated
      expect(empty.totalInputTokens).toBe(0);
    });

    test("accumulateStageSnapshot accumulates across multiple stages", () => {
      let acc = createEmptyAccumulatedPressure();

      acc = accumulateStageSnapshot(acc, "planner",
        makeSnapshot({ inputTokens: 1000, outputTokens: 500 }));
      acc = accumulateStageSnapshot(acc, "orchestrator",
        makeSnapshot({ inputTokens: 8000, outputTokens: 4000 }));
      acc = accumulateStageSnapshot(acc, "reviewer",
        makeSnapshot({ inputTokens: 2000, outputTokens: 1000 }));

      expect(acc.totalInputTokens).toBe(11000);
      expect(acc.totalOutputTokens).toBe(5500);
      expect(acc.stageSnapshots.size).toBe(3);
    });

  });
});
