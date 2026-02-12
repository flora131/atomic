/**
 * Unit tests for the state annotation system
 *
 * Tests cover:
 * - Reducer functions (replace, concat, merge, mergeById, etc.)
 * - Annotation factory function
 * - State initialization from schema
 * - State updates with reducers
 * - AtomicWorkflowState creation and updates
 * - Type guards
 */

import { describe, test, expect } from "bun:test";
import {
  Reducers,
  annotation,
  getDefaultValue,
  applyReducer,
  initializeState,
  applyStateUpdate,
  AtomicStateAnnotation,
  createAtomicState,
  updateAtomicState,
  isFeature,
  isAtomicWorkflowState,
  type Annotation,
  type Feature,
  type AtomicWorkflowState,
  type StateFromAnnotation,
} from "../../src/graph/annotation.ts";

// ============================================================================
// Reducer Tests
// ============================================================================

describe("Reducers.replace", () => {
  test("replaces any value with the update", () => {
    expect(Reducers.replace(1, 2)).toBe(2);
    expect(Reducers.replace("old", "new")).toBe("new");
    expect(Reducers.replace({ a: 1 }, { b: 2 })).toEqual({ b: 2 });
    expect(Reducers.replace([1, 2], [3, 4])).toEqual([3, 4]);
  });

  test("handles null and undefined", () => {
    expect(Reducers.replace("value", null as unknown as string)).toBeNull();
    expect(Reducers.replace(null as unknown as string, "value")).toBe("value");
  });
});

describe("Reducers.concat", () => {
  test("concatenates two arrays", () => {
    expect(Reducers.concat([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
    expect(Reducers.concat(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("handles empty arrays", () => {
    expect(Reducers.concat([], [1, 2])).toEqual([1, 2]);
    expect(Reducers.concat([1, 2], [])).toEqual([1, 2]);
    expect(Reducers.concat([], [])).toEqual([]);
  });

  test("handles non-array current value", () => {
    expect(Reducers.concat(null as unknown as number[], [1, 2])).toEqual([1, 2]);
  });
});

describe("Reducers.merge", () => {
  test("merges objects shallowly", () => {
    const result = Reducers.merge({ a: 1, b: 2 }, { b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  test("update overrides current values", () => {
    expect(Reducers.merge({ name: "old" }, { name: "new" })).toEqual({ name: "new" });
  });

  test("handles empty objects", () => {
    expect(Reducers.merge({}, { a: 1 })).toEqual({ a: 1 });
    expect(Reducers.merge({ a: 1 }, {})).toEqual({ a: 1 });
  });
});

describe("Reducers.mergeById", () => {
  interface Item {
    id: number;
    name: string;
    value?: number;
  }

  const mergeByIdReducer = Reducers.mergeById<Item>("id");

  test("adds new items", () => {
    const current: Item[] = [{ id: 1, name: "one" }];
    const update: Item[] = [{ id: 2, name: "two" }];
    expect(mergeByIdReducer(current, update)).toEqual([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ]);
  });

  test("updates existing items by ID", () => {
    const current: Item[] = [{ id: 1, name: "old" }];
    const update: Item[] = [{ id: 1, name: "new" }];
    expect(mergeByIdReducer(current, update)).toEqual([{ id: 1, name: "new" }]);
  });

  test("merges item properties", () => {
    const current: Item[] = [{ id: 1, name: "one", value: 100 }];
    const update: Item[] = [{ id: 1, name: "updated" }];
    expect(mergeByIdReducer(current, update)).toEqual([{ id: 1, name: "updated", value: 100 }]);
  });

  test("handles empty arrays", () => {
    expect(mergeByIdReducer([], [{ id: 1, name: "one" }])).toEqual([{ id: 1, name: "one" }]);
    expect(mergeByIdReducer([{ id: 1, name: "one" }], [])).toEqual([{ id: 1, name: "one" }]);
  });

  test("works with string IDs", () => {
    interface StringItem {
      key: string;
      data: string;
    }
    const mergeByKey = Reducers.mergeById<StringItem>("key");
    const current: StringItem[] = [{ key: "a", data: "old" }];
    const update: StringItem[] = [{ key: "a", data: "new" }, { key: "b", data: "added" }];
    expect(mergeByKey(current, update)).toEqual([
      { key: "a", data: "new" },
      { key: "b", data: "added" },
    ]);
  });
});

describe("Reducers.max", () => {
  test("returns the maximum value", () => {
    expect(Reducers.max(5, 10)).toBe(10);
    expect(Reducers.max(10, 5)).toBe(10);
    expect(Reducers.max(-5, -10)).toBe(-5);
  });
});

describe("Reducers.min", () => {
  test("returns the minimum value", () => {
    expect(Reducers.min(5, 10)).toBe(5);
    expect(Reducers.min(10, 5)).toBe(5);
    expect(Reducers.min(-5, -10)).toBe(-10);
  });
});

describe("Reducers.sum", () => {
  test("sums two numbers", () => {
    expect(Reducers.sum(5, 10)).toBe(15);
    expect(Reducers.sum(-5, 10)).toBe(5);
    expect(Reducers.sum(0, 0)).toBe(0);
  });
});

describe("Reducers.or", () => {
  test("returns logical OR", () => {
    expect(Reducers.or(true, true)).toBe(true);
    expect(Reducers.or(true, false)).toBe(true);
    expect(Reducers.or(false, true)).toBe(true);
    expect(Reducers.or(false, false)).toBe(false);
  });
});

describe("Reducers.and", () => {
  test("returns logical AND", () => {
    expect(Reducers.and(true, true)).toBe(true);
    expect(Reducers.and(true, false)).toBe(false);
    expect(Reducers.and(false, true)).toBe(false);
    expect(Reducers.and(false, false)).toBe(false);
  });
});

describe("Reducers.ifDefined", () => {
  test("returns update if defined", () => {
    expect(Reducers.ifDefined("old", "new")).toBe("new");
    expect(Reducers.ifDefined(0, 5)).toBe(5);
  });

  test("keeps current if update is null or undefined", () => {
    expect(Reducers.ifDefined("value", null)).toBe("value");
    expect(Reducers.ifDefined("value", undefined)).toBe("value");
  });
});

// ============================================================================
// Annotation Factory Tests
// ============================================================================

describe("annotation", () => {
  test("creates annotation with direct default value", () => {
    const ann = annotation(42);
    expect(ann.default).toBe(42);
    expect(ann.reducer).toBeUndefined();
  });

  test("creates annotation with factory default", () => {
    const ann = annotation(() => []);
    expect(typeof ann.default).toBe("function");
    expect((ann.default as () => unknown[])()).toEqual([]);
  });

  test("creates annotation with reducer", () => {
    const ann = annotation(0, Reducers.sum);
    expect(ann.default).toBe(0);
    expect(ann.reducer).toBe(Reducers.sum);
  });
});

describe("getDefaultValue", () => {
  test("returns direct default value", () => {
    const ann = annotation(42);
    expect(getDefaultValue(ann)).toBe(42);
  });

  test("calls factory function for default", () => {
    let callCount = 0;
    const ann = annotation(() => {
      callCount++;
      return "generated";
    });
    expect(getDefaultValue(ann)).toBe("generated");
    expect(callCount).toBe(1);
  });

  test("returns new instance for factory each call", () => {
    const ann = annotation(() => ({ value: 1 }));
    const a = getDefaultValue(ann);
    const b = getDefaultValue(ann);
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // Different object instances
  });
});

describe("applyReducer", () => {
  test("uses annotation reducer when provided", () => {
    const ann = annotation(0, Reducers.sum);
    expect(applyReducer(ann, 5, 3)).toBe(8);
  });

  test("falls back to replace when no reducer", () => {
    const ann = annotation("default");
    expect(applyReducer(ann, "old", "new")).toBe("new");
  });
});

// ============================================================================
// State Initialization Tests
// ============================================================================

describe("initializeState", () => {
  test("creates state from simple schema", () => {
    const schema = {
      count: annotation(0),
      name: annotation("default"),
      enabled: annotation(false),
    };

    const state = initializeState(schema);
    expect(state).toEqual({
      count: 0,
      name: "default",
      enabled: false,
    });
  });

  test("calls factory functions for defaults", () => {
    const schema = {
      items: annotation<string[]>(() => []),
      timestamp: annotation(() => "now"),
    };

    const state = initializeState(schema);
    expect(state.items).toEqual([]);
    expect(state.timestamp).toBe("now");
  });

  test("creates independent instances for each init", () => {
    const schema = {
      items: annotation<string[]>(() => []),
    };

    const state1 = initializeState(schema);
    const state2 = initializeState(schema);

    state1.items.push("item1");
    expect(state1.items).toEqual(["item1"]);
    expect(state2.items).toEqual([]);
  });
});

describe("applyStateUpdate", () => {
  const schema = {
    count: annotation(0, Reducers.sum),
    items: annotation<string[]>([], Reducers.concat),
    name: annotation("default"),
  };

  test("applies update using reducers", () => {
    const current = { count: 5, items: ["a"], name: "original" };
    const update = { count: 3, items: ["b"] };

    const newState = applyStateUpdate(schema, current, update);
    expect(newState.count).toBe(8); // sum: 5 + 3
    expect(newState.items).toEqual(["a", "b"]); // concat
    expect(newState.name).toBe("original"); // unchanged
  });

  test("uses replace for fields without reducer", () => {
    const current = { count: 5, items: ["a"], name: "original" };
    const update = { name: "updated" };

    const newState = applyStateUpdate(schema, current, update);
    expect(newState.name).toBe("updated");
  });

  test("preserves unchanged fields", () => {
    const current = { count: 5, items: ["a"], name: "original" };
    const update = { count: 1 };

    const newState = applyStateUpdate(schema, current, update);
    expect(newState).toEqual({ count: 6, items: ["a"], name: "original" });
  });

  test("returns new object (immutable)", () => {
    const current = { count: 0, items: [], name: "test" };
    const newState = applyStateUpdate(schema, current, { count: 1 });

    expect(newState).not.toBe(current);
    expect(current.count).toBe(0); // Original unchanged
  });
});

// ============================================================================
// AtomicWorkflowState Tests
// ============================================================================

describe("AtomicStateAnnotation", () => {
  test("has all required fields", () => {
    expect(AtomicStateAnnotation.executionId).toBeDefined();
    expect(AtomicStateAnnotation.lastUpdated).toBeDefined();
    expect(AtomicStateAnnotation.outputs).toBeDefined();
    expect(AtomicStateAnnotation.researchDoc).toBeDefined();
    expect(AtomicStateAnnotation.specDoc).toBeDefined();
    expect(AtomicStateAnnotation.specApproved).toBeDefined();
    expect(AtomicStateAnnotation.featureList).toBeDefined();
    expect(AtomicStateAnnotation.currentFeature).toBeDefined();
    expect(AtomicStateAnnotation.allFeaturesPassing).toBeDefined();
    expect(AtomicStateAnnotation.debugReports).toBeDefined();
    expect(AtomicStateAnnotation.prUrl).toBeDefined();
    expect(AtomicStateAnnotation.contextWindowUsage).toBeDefined();
    expect(AtomicStateAnnotation.iteration).toBeDefined();
  });
});

describe("createAtomicState", () => {
  test("creates state with defaults", () => {
    const state = createAtomicState();

    expect(typeof state.executionId).toBe("string");
    expect(state.executionId.length).toBeGreaterThan(0);
    expect(typeof state.lastUpdated).toBe("string");
    expect(state.outputs).toEqual({});
    expect(state.researchDoc).toBe("");
    expect(state.specDoc).toBe("");
    expect(state.specApproved).toBe(false);
    expect(state.featureList).toEqual([]);
    expect(state.currentFeature).toBeNull();
    expect(state.allFeaturesPassing).toBe(false);
    expect(state.debugReports).toEqual([]);
    expect(state.prUrl).toBeNull();
    expect(state.contextWindowUsage).toBeNull();
    expect(state.iteration).toBe(1);
  });

  test("uses provided executionId", () => {
    const state = createAtomicState("custom-id");
    expect(state.executionId).toBe("custom-id");
  });

  test("generates unique executionIds", () => {
    const state1 = createAtomicState();
    const state2 = createAtomicState();
    expect(state1.executionId).not.toBe(state2.executionId);
  });
});

describe("updateAtomicState", () => {
  test("updates specific fields", () => {
    const current = createAtomicState("test-id");
    // Manually set an older timestamp to ensure the test works
    const oldState = { ...current, lastUpdated: "2020-01-01T00:00:00.000Z" };
    const updated = updateAtomicState(oldState, {
      researchDoc: "# Research",
      iteration: 5,
    });

    expect(updated.executionId).toBe("test-id");
    expect(updated.researchDoc).toBe("# Research");
    expect(updated.iteration).toBe(5);
    expect(updated.lastUpdated).not.toBe(oldState.lastUpdated);
  });

  test("concatenates debug reports", () => {
    const current = createAtomicState();
    const report1 = {
      errorSummary: "Error 1",
      relevantFiles: [],
      suggestedFixes: [],
      generatedAt: new Date().toISOString(),
    };
    const report2 = {
      errorSummary: "Error 2",
      relevantFiles: [],
      suggestedFixes: [],
      generatedAt: new Date().toISOString(),
    };

    const state1 = updateAtomicState(current, { debugReports: [report1] });
    const state2 = updateAtomicState(state1, { debugReports: [report2] });

    expect(state2.debugReports).toHaveLength(2);
    const reports = state2.debugReports;
    expect(reports[0]?.errorSummary).toBe("Error 1");
    expect(reports[1]?.errorSummary).toBe("Error 2");
  });

  test("merges feature list by description", () => {
    const current = createAtomicState();
    const feature1: Feature = {
      category: "test",
      description: "Feature 1",
      steps: ["step1"],
      passes: false,
    };
    const feature2: Feature = {
      category: "test",
      description: "Feature 2",
      steps: ["step2"],
      passes: false,
    };

    const state1 = updateAtomicState(current, { featureList: [feature1, feature2] });

    // Update feature1 to passing
    const updatedFeature1: Feature = { ...feature1, passes: true };
    const state2 = updateAtomicState(state1, { featureList: [updatedFeature1] });

    expect(state2.featureList).toHaveLength(2);
    expect(state2.featureList.find((f) => f.description === "Feature 1")?.passes).toBe(true);
    expect(state2.featureList.find((f) => f.description === "Feature 2")?.passes).toBe(false);
  });

  test("returns immutable state", () => {
    const current = createAtomicState();
    const updated = updateAtomicState(current, { iteration: 2 });

    expect(updated).not.toBe(current);
    expect(current.iteration).toBe(1);
    expect(updated.iteration).toBe(2);
  });
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe("isFeature", () => {
  test("returns true for valid Feature", () => {
    const feature: Feature = {
      category: "functional",
      description: "Test feature",
      steps: ["step1", "step2"],
      passes: false,
    };
    expect(isFeature(feature)).toBe(true);
  });

  test("returns false for invalid objects", () => {
    expect(isFeature(null)).toBe(false);
    expect(isFeature(undefined)).toBe(false);
    expect(isFeature({})).toBe(false);
    expect(isFeature({ category: "test" })).toBe(false);
    expect(isFeature({ category: 123, description: "test", steps: [], passes: false })).toBe(
      false
    );
    expect(isFeature({ category: "test", description: "test", steps: "not array", passes: false }))
      .toBe(false);
  });
});

describe("isAtomicWorkflowState", () => {
  test("returns true for valid state", () => {
    const state = createAtomicState();
    expect(isAtomicWorkflowState(state)).toBe(true);
  });

  test("returns false for invalid objects", () => {
    expect(isAtomicWorkflowState(null)).toBe(false);
    expect(isAtomicWorkflowState(undefined)).toBe(false);
    expect(isAtomicWorkflowState({})).toBe(false);
    expect(isAtomicWorkflowState({ executionId: "test" })).toBe(false);
  });

  test("returns false for partial state", () => {
    const partial = {
      executionId: "test",
      lastUpdated: "2024-01-01",
      outputs: {},
      // Missing other required fields
    };
    expect(isAtomicWorkflowState(partial)).toBe(false);
  });
});

// ============================================================================
// Type Inference Tests (Compile-time)
// ============================================================================

describe("Type Inference", () => {
  test("StateFromAnnotation infers correct types", () => {
    const schema = {
      count: annotation(0),
      name: annotation("default"),
      items: annotation<string[]>([]),
    };

    type State = StateFromAnnotation<typeof schema>;

    // This test verifies that TypeScript correctly infers the types
    // If this compiles, the types are correct
    const state: State = {
      count: 42,
      name: "test",
      items: ["a", "b"],
    };

    expect(state.count).toBe(42);
    expect(state.name).toBe("test");
    expect(state.items).toEqual(["a", "b"]);
  });

  test("AtomicWorkflowState has correct field types", () => {
    const state: AtomicWorkflowState = createAtomicState();

    // Type assertions - these will fail at compile time if types are wrong
    const executionId: string = state.executionId;
    const iteration: number = state.iteration;
    const featureList: Feature[] = state.featureList;
    const specApproved: boolean = state.specApproved;

    expect(typeof executionId).toBe("string");
    expect(typeof iteration).toBe("number");
    expect(Array.isArray(featureList)).toBe(true);
    expect(typeof specApproved).toBe("boolean");
  });
});

// ============================================================================
// RalphWorkflowState Tests
// ============================================================================

import {
  RalphStateAnnotation,
  createRalphState,
  updateRalphState,
  isRalphWorkflowState,
  type RalphWorkflowState,
} from "../../src/graph/annotation.ts";

describe("RalphStateAnnotation", () => {
  test("has all required base state fields", () => {
    expect(RalphStateAnnotation.executionId).toBeDefined();
    expect(RalphStateAnnotation.lastUpdated).toBeDefined();
    expect(RalphStateAnnotation.outputs).toBeDefined();
  });

  test("has all required workflow fields", () => {
    expect(RalphStateAnnotation.researchDoc).toBeDefined();
    expect(RalphStateAnnotation.specDoc).toBeDefined();
    expect(RalphStateAnnotation.specApproved).toBeDefined();
    expect(RalphStateAnnotation.featureList).toBeDefined();
    expect(RalphStateAnnotation.currentFeature).toBeDefined();
    expect(RalphStateAnnotation.allFeaturesPassing).toBeDefined();
    expect(RalphStateAnnotation.debugReports).toBeDefined();
    expect(RalphStateAnnotation.prUrl).toBeDefined();
    expect(RalphStateAnnotation.contextWindowUsage).toBeDefined();
    expect(RalphStateAnnotation.iteration).toBeDefined();
  });

  test("has all required Ralph-specific fields", () => {
    expect(RalphStateAnnotation.ralphSessionId).toBeDefined();
    expect(RalphStateAnnotation.ralphSessionDir).toBeDefined();
    expect(RalphStateAnnotation.shouldContinue).toBeDefined();
    expect(RalphStateAnnotation.completedFeatures).toBeDefined();
    expect(RalphStateAnnotation.prBranch).toBeDefined();
  });
});

describe("createRalphState", () => {
  test("creates state with all default values", () => {
    const state = createRalphState();

    // Base state fields
    expect(typeof state.executionId).toBe("string");
    expect(state.executionId.length).toBeGreaterThan(0);
    expect(typeof state.lastUpdated).toBe("string");
    expect(state.outputs).toEqual({});

    // Workflow fields
    expect(state.researchDoc).toBe("");
    expect(state.specDoc).toBe("");
    expect(state.specApproved).toBe(false);
    expect(state.featureList).toEqual([]);
    expect(state.currentFeature).toBeNull();
    expect(state.allFeaturesPassing).toBe(false);
    expect(state.debugReports).toEqual([]);
    expect(state.prUrl).toBeNull();
    expect(state.contextWindowUsage).toBeNull();
    expect(state.iteration).toBe(1);

    // Ralph-specific fields
    expect(typeof state.ralphSessionId).toBe("string");
    expect(state.ralphSessionId.length).toBeGreaterThan(0);
    expect(state.ralphSessionDir).toContain(".ralph/sessions/");
    expect(state.shouldContinue).toBe(true);
    expect(state.completedFeatures).toEqual([]);
  });

  test("uses provided executionId", () => {
    const state = createRalphState("custom-exec-id");
    expect(state.executionId).toBe("custom-exec-id");
  });

  test("generates unique executionIds when not provided", () => {
    const state1 = createRalphState();
    const state2 = createRalphState();
    expect(state1.executionId).not.toBe(state2.executionId);
  });

  test("generates unique ralphSessionIds when not provided", () => {
    const state1 = createRalphState();
    const state2 = createRalphState();
    expect(state1.ralphSessionId).not.toBe(state2.ralphSessionId);
  });

  test("uses provided ralphSessionId and derives sessionDir", () => {
    const state = createRalphState(undefined, {
      ralphSessionId: "test-session-123",
    });

    expect(state.ralphSessionId).toBe("test-session-123");
    expect(state.ralphSessionDir).toBe(".ralph/sessions/test-session-123/");
  });

  test("uses provided sessionDir when explicitly set", () => {
    const state = createRalphState(undefined, {
      ralphSessionId: "test-session-123",
      ralphSessionDir: "/custom/path/to/session/",
    });

    expect(state.ralphSessionId).toBe("test-session-123");
    expect(state.ralphSessionDir).toBe("/custom/path/to/session/");
  });
});

describe("updateRalphState", () => {
  test("updates specific fields while preserving others", () => {
    const current = createRalphState("test-id");
    const oldTimestamp = current.lastUpdated;

    // Small delay to ensure timestamp changes
    const updated = updateRalphState(current, {
      researchDoc: "# Research Document",
      iteration: 5,
      yoloComplete: true,
    });

    expect(updated.executionId).toBe("test-id");
    expect(updated.researchDoc).toBe("# Research Document");
    expect(updated.iteration).toBe(5);
    expect(updated.yoloComplete).toBe(true);
    // Other fields unchanged
  });

  test("concatenates debug reports", () => {
    const current = createRalphState();
    const report1 = {
      errorSummary: "Error 1",
      relevantFiles: [],
      suggestedFixes: [],
      generatedAt: new Date().toISOString(),
    };
    const report2 = {
      errorSummary: "Error 2",
      relevantFiles: [],
      suggestedFixes: [],
      generatedAt: new Date().toISOString(),
    };

    const state1 = updateRalphState(current, { debugReports: [report1] });
    const state2 = updateRalphState(state1, { debugReports: [report2] });

    expect(state2.debugReports).toHaveLength(2);
    expect(state2.debugReports[0]?.errorSummary).toBe("Error 1");
    expect(state2.debugReports[1]?.errorSummary).toBe("Error 2");
  });

  test("concatenates completedFeatures", () => {
    const current = createRalphState();

    const state1 = updateRalphState(current, { completedFeatures: ["feat-001"] });
    const state2 = updateRalphState(state1, { completedFeatures: ["feat-002"] });

    expect(state2.completedFeatures).toEqual(["feat-001", "feat-002"]);
  });

  test("merges feature list by description", () => {
    const current = createRalphState();
    const feature1: Feature = {
      category: "test",
      description: "Feature 1",
      steps: ["step1"],
      passes: false,
    };
    const feature2: Feature = {
      category: "test",
      description: "Feature 2",
      steps: ["step2"],
      passes: false,
    };

    const state1 = updateRalphState(current, { featureList: [feature1, feature2] });

    // Update feature1 to passing
    const updatedFeature1: Feature = { ...feature1, passes: true };
    const state2 = updateRalphState(state1, { featureList: [updatedFeature1] });

    expect(state2.featureList).toHaveLength(2);
    expect(state2.featureList.find((f) => f.description === "Feature 1")?.passes).toBe(true);
    expect(state2.featureList.find((f) => f.description === "Feature 2")?.passes).toBe(false);
  });

  test("returns immutable state", () => {
    const current = createRalphState();
    const updated = updateRalphState(current, { iteration: 2 });

    expect(updated).not.toBe(current);
    expect(current.iteration).toBe(1);
    expect(updated.iteration).toBe(2);
  });

  test("updates lastUpdated timestamp", () => {
    const current = createRalphState();
    const oldTimestamp = "2020-01-01T00:00:00.000Z";
    const stateWithOldTimestamp = { ...current, lastUpdated: oldTimestamp };

    const updated = updateRalphState(stateWithOldTimestamp, { iteration: 2 });

    expect(updated.lastUpdated).not.toBe(oldTimestamp);
    expect(new Date(updated.lastUpdated).getTime()).toBeGreaterThan(
      new Date(oldTimestamp).getTime()
    );
  });
});

describe("isRalphWorkflowState", () => {
  test("returns true for valid RalphWorkflowState", () => {
    const state = createRalphState();
    expect(isRalphWorkflowState(state)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isRalphWorkflowState(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isRalphWorkflowState(undefined)).toBe(false);
  });

  test("returns false for empty object", () => {
    expect(isRalphWorkflowState({})).toBe(false);
  });

  test("returns false for partial state missing base fields", () => {
    const partial = {
      ralphSessionId: "test",
      ralphSessionDir: ".ralph/sessions/test/",
    };
    expect(isRalphWorkflowState(partial)).toBe(false);
  });

  test("returns false for partial state missing ralph-specific fields", () => {
    const partial = {
      executionId: "test",
      lastUpdated: "2024-01-01",
      outputs: {},
      researchDoc: "",
      specDoc: "",
      specApproved: false,
      featureList: [],
      allFeaturesPassing: false,
      debugReports: [],
      iteration: 1,
      // Missing ralph-specific fields
    };
    expect(isRalphWorkflowState(partial)).toBe(false);
  });

  test("returns false when required fields have wrong types", () => {
    const invalidState = {
      ...createRalphState(),
      shouldContinue: "not a boolean", // Wrong type
    };
    expect(isRalphWorkflowState(invalidState)).toBe(false);
  });

  test("returns false when completedFeatures is not an array", () => {
    const invalidState = {
      ...createRalphState(),
      completedFeatures: "not an array",
    };
    expect(isRalphWorkflowState(invalidState)).toBe(false);
  });
});

describe("RalphWorkflowState Type Inference", () => {
  test("RalphWorkflowState has correct field types", () => {
    const state: RalphWorkflowState = createRalphState();

    // Base state field types
    const executionId: string = state.executionId;
    const lastUpdated: string = state.lastUpdated;
    const outputs: Record<string, unknown> = state.outputs;

    // Workflow field types
    const researchDoc: string = state.researchDoc;
    const specDoc: string = state.specDoc;
    const specApproved: boolean = state.specApproved;
    const featureList: Feature[] = state.featureList;
    const currentFeature: Feature | null = state.currentFeature;
    const allFeaturesPassing: boolean = state.allFeaturesPassing;
    const iteration: number = state.iteration;
    const prUrl: string | null = state.prUrl;

    // Ralph-specific field types
    const ralphSessionId: string = state.ralphSessionId;
    const ralphSessionDir: string = state.ralphSessionDir;
    const shouldContinue: boolean = state.shouldContinue;
    const completedFeatures: string[] = state.completedFeatures;

    expect(typeof executionId).toBe("string");
    expect(typeof lastUpdated).toBe("string");
    expect(typeof outputs).toBe("object");
    expect(typeof researchDoc).toBe("string");
    expect(typeof specDoc).toBe("string");
    expect(typeof specApproved).toBe("boolean");
    expect(Array.isArray(featureList)).toBe(true);
    expect(currentFeature === null || typeof currentFeature === "object").toBe(true);
    expect(typeof allFeaturesPassing).toBe("boolean");
    expect(typeof iteration).toBe("number");
    expect(prUrl === null || typeof prUrl === "string").toBe(true);
    expect(typeof ralphSessionId).toBe("string");
    expect(typeof ralphSessionDir).toBe("string");
    expect(typeof shouldContinue).toBe("boolean");
    expect(Array.isArray(completedFeatures)).toBe(true);
  });

  test("optional RalphWorkflowState fields are correctly typed", () => {
    const state: RalphWorkflowState = createRalphState();

    // Optional fields can be undefined
    const prBranch: string | undefined = state.prBranch;
    const sourceFeatureListPath: string | undefined = state.sourceFeatureListPath;
    const maxIterationsReached: boolean | undefined = state.maxIterationsReached;

    expect(prBranch === undefined || typeof prBranch === "string").toBe(true);
    expect(sourceFeatureListPath === undefined || typeof sourceFeatureListPath === "string").toBe(
      true
    );
    expect(maxIterationsReached === undefined || typeof maxIterationsReached === "boolean").toBe(
      true
    );
  });
});
