import { describe, expect, test } from "bun:test";
import {
  computePressureLevel,
  createSnapshot,
  createDefaultContextPressureConfig,
  shouldContinueSession,
  buildContinuationPrompt,
  createContinuationRecord,
  createEmptyAccumulatedPressure,
  accumulateStageSnapshot,
  accumulateContinuation,
  takeContextSnapshot,
  DEFAULT_ELEVATED_THRESHOLD,
  DEFAULT_CRITICAL_THRESHOLD,
  DEFAULT_MAX_CONTINUATIONS_PER_STAGE,
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
      expect(config.maxContinuationsPerStage).toBe(DEFAULT_MAX_CONTINUATIONS_PER_STAGE);
      expect(config.enableContinuation).toBe(true);
    });

    test("defaults are 45/60/3/true", () => {
      const config = createDefaultContextPressureConfig();

      expect(config.elevatedThreshold).toBe(45);
      expect(config.criticalThreshold).toBe(60);
      expect(config.maxContinuationsPerStage).toBe(3);
      expect(config.enableContinuation).toBe(true);
    });

    test("accepts partial overrides", () => {
      const config = createDefaultContextPressureConfig({
        criticalThreshold: 80,
        enableContinuation: false,
      });

      expect(config.elevatedThreshold).toBe(45);
      expect(config.criticalThreshold).toBe(80);
      expect(config.maxContinuationsPerStage).toBe(3);
      expect(config.enableContinuation).toBe(false);
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
      expect(computePressureLevel(44.9, config)).toBe("normal");
    });

    test("returns 'elevated' when usage is at or above elevated but below critical", () => {
      expect(computePressureLevel(45, config)).toBe("elevated");
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
  // Continuation Decision
  // -------------------------------------------------------------------------

  describe("shouldContinueSession", () => {
    test("returns true when pressure is critical and within continuation limit", () => {
      const snapshot = makeSnapshot({ level: "critical", usagePercentage: 70 });
      const config = makeConfig();

      expect(shouldContinueSession(snapshot, config, 0)).toBe(true);
      expect(shouldContinueSession(snapshot, config, 1)).toBe(true);
      expect(shouldContinueSession(snapshot, config, 2)).toBe(true);
    });

    test("returns false when continuation limit is reached", () => {
      const snapshot = makeSnapshot({ level: "critical", usagePercentage: 70 });
      const config = makeConfig({ maxContinuationsPerStage: 3 });

      expect(shouldContinueSession(snapshot, config, 3)).toBe(false);
      expect(shouldContinueSession(snapshot, config, 5)).toBe(false);
    });

    test("returns false when pressure is not critical", () => {
      const config = makeConfig();

      expect(shouldContinueSession(
        makeSnapshot({ level: "normal" }),
        config,
        0,
      )).toBe(false);

      expect(shouldContinueSession(
        makeSnapshot({ level: "elevated" }),
        config,
        0,
      )).toBe(false);
    });

    test("returns false when continuation is disabled", () => {
      const snapshot = makeSnapshot({ level: "critical", usagePercentage: 70 });
      const config = makeConfig({ enableContinuation: false });

      expect(shouldContinueSession(snapshot, config, 0)).toBe(false);
    });

    test("returns false when max continuations is 0", () => {
      const snapshot = makeSnapshot({ level: "critical", usagePercentage: 70 });
      const config = makeConfig({ maxContinuationsPerStage: 0 });

      expect(shouldContinueSession(snapshot, config, 0)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Continuation Prompt Building
  // -------------------------------------------------------------------------

  describe("buildContinuationPrompt", () => {
    test("includes original prompt", () => {
      const prompt = buildContinuationPrompt("Build auth module", "partial response", 0);

      expect(prompt).toContain("Build auth module");
    });

    test("includes partial response", () => {
      const prompt = buildContinuationPrompt("task", "Created file src/auth.ts", 0);

      expect(prompt).toContain("Created file src/auth.ts");
    });

    test("includes continuation index (1-based)", () => {
      expect(buildContinuationPrompt("t", "r", 0)).toContain("continuation #1");
      expect(buildContinuationPrompt("t", "r", 2)).toContain("continuation #3");
    });

    test("includes instructions to continue without repeating", () => {
      const prompt = buildContinuationPrompt("task", "partial", 0);

      expect(prompt).toContain("Continue the task");
      expect(prompt).toContain("Do not repeat work");
    });

    test("truncates long partial responses to preserve recent work", () => {
      const longResponse = "X".repeat(20000);
      const prompt = buildContinuationPrompt("task", longResponse, 0);

      // The prompt should be shorter than original + overhead
      expect(prompt.length).toBeLessThan(longResponse.length);
      expect(prompt).toContain("truncated");
    });

    test("does not truncate short responses", () => {
      const shortResponse = "Created file src/auth.ts\nAdded login function";
      const prompt = buildContinuationPrompt("task", shortResponse, 0);

      expect(prompt).not.toContain("truncated");
      expect(prompt).toContain(shortResponse);
    });
  });

  // -------------------------------------------------------------------------
  // Continuation Record Factory
  // -------------------------------------------------------------------------

  describe("createContinuationRecord", () => {
    test("creates a record with all fields", () => {
      const snapshot = makeSnapshot({ level: "critical" });
      const record = createContinuationRecord("orchestrator", 0, snapshot, "partial work");

      expect(record.stageId).toBe("orchestrator");
      expect(record.continuationIndex).toBe(0);
      expect(record.triggerSnapshot).toBe(snapshot);
      expect(record.partialResponse).toBe("partial work");
      expect(typeof record.timestamp).toBe("string");
    });

    test("preserves different continuation indices", () => {
      const snapshot = makeSnapshot();
      const r0 = createContinuationRecord("s", 0, snapshot, "a");
      const r1 = createContinuationRecord("s", 1, snapshot, "b");
      const r2 = createContinuationRecord("s", 2, snapshot, "c");

      expect(r0.continuationIndex).toBe(0);
      expect(r1.continuationIndex).toBe(1);
      expect(r2.continuationIndex).toBe(2);
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
      expect(empty.totalContinuations).toBe(0);
      expect(empty.stageSnapshots.size).toBe(0);
      expect(empty.continuations).toHaveLength(0);
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

    test("accumulateContinuation increments count and appends record", () => {
      const empty = createEmptyAccumulatedPressure();
      const snapshot = makeSnapshot({ level: "critical" });
      const record = createContinuationRecord("orchestrator", 0, snapshot, "partial");

      const result = accumulateContinuation(empty, record);

      expect(result.totalContinuations).toBe(1);
      expect(result.continuations).toHaveLength(1);
      expect(result.continuations[0]).toBe(record);
      // Original is not mutated
      expect(empty.totalContinuations).toBe(0);
    });

    test("accumulateContinuation preserves existing state", () => {
      let acc = createEmptyAccumulatedPressure();
      acc = accumulateStageSnapshot(acc, "planner",
        makeSnapshot({ inputTokens: 5000, outputTokens: 3000 }));

      const record = createContinuationRecord("orchestrator", 0,
        makeSnapshot({ level: "critical" }), "partial");
      acc = accumulateContinuation(acc, record);

      expect(acc.totalInputTokens).toBe(5000);
      expect(acc.totalOutputTokens).toBe(3000);
      expect(acc.totalContinuations).toBe(1);
      expect(acc.stageSnapshots.size).toBe(1);
    });

    test("multiple continuations accumulate correctly", () => {
      let acc = createEmptyAccumulatedPressure();
      const snapshot = makeSnapshot({ level: "critical" });

      acc = accumulateContinuation(acc,
        createContinuationRecord("orch", 0, snapshot, "p1"));
      acc = accumulateContinuation(acc,
        createContinuationRecord("orch", 1, snapshot, "p2"));
      acc = accumulateContinuation(acc,
        createContinuationRecord("orch", 2, snapshot, "p3"));

      expect(acc.totalContinuations).toBe(3);
      expect(acc.continuations).toHaveLength(3);
      expect(acc.continuations[0]!.continuationIndex).toBe(0);
      expect(acc.continuations[1]!.continuationIndex).toBe(1);
      expect(acc.continuations[2]!.continuationIndex).toBe(2);
    });
  });
});
