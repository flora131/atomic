/**
 * Tests for state annotation system and reducer functions
 */

import { join } from "path";
import { homedir } from "os";

import { describe, expect, test } from "bun:test";
import {
  annotation,
  applyReducer,
  applyStateUpdate,
  createAtomicState,
  createRalphState,
  getDefaultValue,
  initializeState,
  isAtomicWorkflowState,
  isFeature,
  isRalphWorkflowState,
  Reducers,
  updateAtomicState,
  updateRalphState,
} from "./annotation.ts";
import type { AtomicWorkflowState, Feature, RalphWorkflowState } from "./annotation.ts";
import type { DebugReport } from "./types.ts";

describe("Reducers", () => {
  test("replace reducer returns the update value", () => {
    const result = Reducers.replace(10, 20);
    expect(result).toBe(20);
    
    const objResult = Reducers.replace({ a: 1 }, { a: 2 });
    expect(objResult).toEqual({ a: 2 });
  });

  test("concat reducer concatenates arrays", () => {
    const result = Reducers.concat([1, 2], [3, 4]);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  test("concat reducer handles empty arrays", () => {
    const result1 = Reducers.concat([], [1, 2]);
    expect(result1).toEqual([1, 2]);
    
    const result2 = Reducers.concat([1, 2], []);
    expect(result2).toEqual([1, 2]);
    
    const result3 = Reducers.concat([], []);
    expect(result3).toEqual([]);
  });

  test("merge reducer performs shallow object merge", () => {
    const current: Record<string, number> = { a: 1, b: 2 };
    const update: Record<string, number> = { b: 3, c: 4 };
    const result = Reducers.merge(current, update);
    
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  test("mergeById reducer updates items by ID field", () => {
    interface Item {
      id: string;
      value: number;
    }
    
    const current: Item[] = [
      { id: "1", value: 10 },
      { id: "2", value: 20 },
    ];
    
    const update: Item[] = [
      { id: "2", value: 25 }, // Update existing
      { id: "3", value: 30 }, // Add new
    ];
    
    const reducer = Reducers.mergeById<Item>("id");
    const result = reducer(current, update);
    
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ id: "1", value: 10 });
    expect(result).toContainEqual({ id: "2", value: 25 });
    expect(result).toContainEqual({ id: "3", value: 30 });
  });

  test("mergeById reducer merges properties of existing items", () => {
    interface Item {
      id: string;
      name: string;
      age?: number;
    }
    
    const current: Item[] = [{ id: "1", name: "Alice" }];
    const update: Item[] = [{ id: "1", name: "Alice", age: 30 }];
    
    const reducer = Reducers.mergeById<Item>("id");
    const result = reducer(current, update);
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "1", name: "Alice", age: 30 });
  });

  test("max reducer returns the maximum number", () => {
    expect(Reducers.max(5, 10)).toBe(10);
    expect(Reducers.max(10, 5)).toBe(10);
    expect(Reducers.max(-5, -10)).toBe(-5);
  });

  test("min reducer returns the minimum number", () => {
    expect(Reducers.min(5, 10)).toBe(5);
    expect(Reducers.min(10, 5)).toBe(5);
    expect(Reducers.min(-5, -10)).toBe(-10);
  });

  test("sum reducer adds numbers", () => {
    expect(Reducers.sum(5, 10)).toBe(15);
    expect(Reducers.sum(-5, 10)).toBe(5);
    expect(Reducers.sum(0, 0)).toBe(0);
  });

  test("or reducer performs logical OR", () => {
    expect(Reducers.or(true, true)).toBe(true);
    expect(Reducers.or(true, false)).toBe(true);
    expect(Reducers.or(false, true)).toBe(true);
    expect(Reducers.or(false, false)).toBe(false);
  });

  test("and reducer performs logical AND", () => {
    expect(Reducers.and(true, true)).toBe(true);
    expect(Reducers.and(true, false)).toBe(false);
    expect(Reducers.and(false, true)).toBe(false);
    expect(Reducers.and(false, false)).toBe(false);
  });

  test("ifDefined reducer only updates if value is defined", () => {
    expect(Reducers.ifDefined(10, 20)).toBe(20);
    expect(Reducers.ifDefined(10, null)).toBe(10);
    expect(Reducers.ifDefined(10, undefined)).toBe(10);
    expect(Reducers.ifDefined(10, 0)).toBe(0); // 0 is defined
  });
});

describe("annotation factory", () => {
  test("creates annotation with default value", () => {
    const ann = annotation(42);
    
    expect(ann.default).toBe(42);
    expect(ann.reducer).toBeUndefined();
  });

  test("creates annotation with default value and reducer", () => {
    const ann = annotation(0, Reducers.sum);
    
    expect(ann.default).toBe(0);
    expect(ann.reducer).toBe(Reducers.sum);
  });

  test("creates annotation with factory function", () => {
    const ann = annotation(() => [1, 2, 3]);
    
    expect(typeof ann.default).toBe("function");
    expect((ann.default as () => number[])()).toEqual([1, 2, 3]);
  });
});

describe("getDefaultValue", () => {
  test("returns static default value", () => {
    const ann = annotation(42);
    const value = getDefaultValue(ann);
    
    expect(value).toBe(42);
  });

  test("calls factory function for default value", () => {
    const ann = annotation(() => ({ nested: "object" }));
    const value = getDefaultValue(ann);
    
    expect(value).toEqual({ nested: "object" });
  });

  test("factory function creates new instances", () => {
    const ann = annotation(() => []);
    const value1 = getDefaultValue(ann);
    const value2 = getDefaultValue(ann);
    
    // Should be different instances
    expect(value1).not.toBe(value2);
  });
});

describe("applyReducer", () => {
  test("uses custom reducer when provided", () => {
    const ann = annotation(0, Reducers.sum);
    const result = applyReducer(ann, 10, 5);
    
    expect(result).toBe(15);
  });

  test("falls back to replace when no reducer is provided", () => {
    const ann = annotation(10);
    const result = applyReducer(ann, 10, 20);
    
    expect(result).toBe(20);
  });

  test("applies concat reducer to arrays", () => {
    const ann = annotation<string[]>([], Reducers.concat);
    const result = applyReducer(ann, ["a", "b"], ["c", "d"]);
    
    expect(result).toEqual(["a", "b", "c", "d"]);
  });
});

describe("initializeState", () => {
  test("creates state with default values", () => {
    const schema = {
      counter: annotation(0),
      items: annotation<string[]>([]),
      enabled: annotation(true),
    };
    
    const state = initializeState(schema);
    
    expect(state).toEqual({
      counter: 0,
      items: [],
      enabled: true,
    });
  });

  test("calls factory functions for defaults", () => {
    const schema = {
      timestamp: annotation(() => "2024-01-01"),
      list: annotation(() => [1, 2, 3]),
    };
    
    const state = initializeState(schema);
    
    expect(state.timestamp).toBe("2024-01-01");
    expect(state.list).toEqual([1, 2, 3]);
  });

  test("creates independent state instances", () => {
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
  test("applies updates using reducers", () => {
    const schema = {
      counter: annotation(0, Reducers.sum),
      items: annotation<string[]>([], Reducers.concat),
      name: annotation(""),
    };
    
    const current = {
      counter: 10,
      items: ["a"],
      name: "Alice",
    };
    
    const update = {
      counter: 5,
      items: ["b", "c"],
      name: "Bob",
    };
    
    const result = applyStateUpdate(schema, current, update);
    
    expect(result.counter).toBe(15); // sum
    expect(result.items).toEqual(["a", "b", "c"]); // concat
    expect(result.name).toBe("Bob"); // replace (default)
  });

  test("applies partial updates", () => {
    const schema = {
      a: annotation(0),
      b: annotation(0),
      c: annotation(0),
    };
    
    const current = { a: 1, b: 2, c: 3 };
    const update = { b: 20 };
    
    const result = applyStateUpdate(schema, current, update);
    
    expect(result).toEqual({ a: 1, b: 20, c: 3 });
  });

  test("allows updates to keys not in schema", () => {
    const schema = {
      defined: annotation(0),
    };
    
    const current = { defined: 10 };
    const update = { defined: 20, extra: 999 };
    
    // TypeScript doesn't allow extra keys, but at runtime it works
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = applyStateUpdate(schema, current, update as any);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(result as any).toEqual({ defined: 20, extra: 999 });
  });

  test("preserves current state when update is empty", () => {
    const schema = {
      value: annotation(42),
    };
    
    const current = { value: 100 };
    const update = {};
    
    const result = applyStateUpdate(schema, current, update);
    
    expect(result).toEqual({ value: 100 });
  });

  test("handles complex mergeById reducer", () => {
    interface Feature {
      description: string;
      passes: boolean;
    }
    
    const schema = {
      features: annotation<Feature[]>([], Reducers.mergeById<Feature>("description")),
    };
    
    const current = {
      features: [
        { description: "feature1", passes: false },
        { description: "feature2", passes: true },
      ],
    };
    
    const update = {
      features: [
        { description: "feature1", passes: true }, // Update existing
        { description: "feature3", passes: false }, // Add new
      ],
    };
    
    const result = applyStateUpdate(schema, current, update);
    
    expect(result.features).toHaveLength(3);
    expect(result.features).toContainEqual({ description: "feature1", passes: true });
    expect(result.features).toContainEqual({ description: "feature2", passes: true });
    expect(result.features).toContainEqual({ description: "feature3", passes: false });
  });
});

// ============================================================================
// FACTORY HELPERS FOR TEST DATA
// ============================================================================

/**
 * Creates a valid Feature object for testing
 */
function createTestFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    category: "test",
    description: "Test feature",
    steps: ["step1", "step2"],
    passes: false,
    ...overrides,
  };
}

/**
 * Creates a valid AtomicWorkflowState for testing
 */
function createTestAtomicState(overrides: Partial<AtomicWorkflowState> = {}): AtomicWorkflowState {
  return {
    executionId: "test-exec-id",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    outputs: {},
    researchDoc: "",
    specDoc: "",
    specApproved: false,
    featureList: [],
    currentFeature: null,
    allFeaturesPassing: false,
    debugReports: [],
    prUrl: null,
    contextWindowUsage: null,
    iteration: 1,
    ...overrides,
  };
}

/**
 * Creates a valid RalphWorkflowState for testing
 */
function createTestRalphState(overrides: Partial<RalphWorkflowState> = {}): RalphWorkflowState {
  return {
    executionId: "test-exec-id",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    outputs: {},
    researchDoc: "",
    specDoc: "",
    specApproved: false,
    featureList: [],
    currentFeature: null,
    allFeaturesPassing: false,
    debugReports: [],
    prUrl: null,
    contextWindowUsage: null,
    iteration: 1,
    ralphSessionId: "test-session-id",
    ralphSessionDir: join(homedir(), ".atomic", "workflows", "sessions", "test-session-id"),
    yolo: false,
    yoloPrompt: null,
    yoloComplete: false,
    maxIterations: 100,
    shouldContinue: true,
    prBranch: undefined,
    completedFeatures: [],
    sourceFeatureListPath: undefined,
    maxIterationsReached: undefined,
    ...overrides,
  };
}

// ============================================================================
// ATOMIC STATE FACTORY TESTS
// ============================================================================

describe("createAtomicState", () => {
  test("creates state with default values", () => {
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
    const customId = "my-custom-execution-id";
    const state = createAtomicState(customId);
    
    expect(state.executionId).toBe(customId);
  });

  test("generates unique executionId when not provided", () => {
    const state1 = createAtomicState();
    const state2 = createAtomicState();
    
    expect(state1.executionId).not.toBe(state2.executionId);
  });

  test("sets lastUpdated to current timestamp", () => {
    const beforeTime = new Date().toISOString();
    const state = createAtomicState();
    const afterTime = new Date().toISOString();
    
    expect(state.lastUpdated >= beforeTime).toBe(true);
    expect(state.lastUpdated <= afterTime).toBe(true);
  });
});

describe("updateAtomicState", () => {
  test("updates single field while preserving others", () => {
    const current = createTestAtomicState({ iteration: 5 });
    const updated = updateAtomicState(current, { specApproved: true });
    
    expect(updated.iteration).toBe(5);
    expect(updated.specApproved).toBe(true);
    expect(updated.executionId).toBe(current.executionId);
  });

  test("updates multiple fields at once", () => {
    const current = createTestAtomicState();
    const updated = updateAtomicState(current, {
      researchDoc: "New research",
      specDoc: "New spec",
      iteration: 10,
    });
    
    expect(updated.researchDoc).toBe("New research");
    expect(updated.specDoc).toBe("New spec");
    expect(updated.iteration).toBe(10);
  });

  test("updates lastUpdated timestamp", () => {
    const current = createTestAtomicState({ lastUpdated: "2020-01-01T00:00:00.000Z" });
    const beforeTime = new Date().toISOString();
    const updated = updateAtomicState(current, { iteration: 2 });
    const afterTime = new Date().toISOString();
    
    expect(updated.lastUpdated >= beforeTime).toBe(true);
    expect(updated.lastUpdated <= afterTime).toBe(true);
  });

  test("applies concat reducer to debugReports", () => {
    const current = createTestAtomicState({
      debugReports: [{ errorSummary: "error1", relevantFiles: [], suggestedFixes: [], generatedAt: "2024-01-01" }],
    });
    const updated = updateAtomicState(current, {
      debugReports: [{ errorSummary: "error2", relevantFiles: [], suggestedFixes: [], generatedAt: "2024-01-02" }],
    });
    
    expect(updated.debugReports).toHaveLength(2);
  });

  test("preserves original state (immutability)", () => {
    const current = createTestAtomicState({ specDoc: "original" });
    updateAtomicState(current, { specDoc: "updated" });
    
    expect(current.specDoc).toBe("original");
  });
});

// ============================================================================
// TYPE GUARD TESTS
// ============================================================================

describe("isFeature", () => {
  test("returns true for valid Feature object", () => {
    const feature = createTestFeature();
    expect(isFeature(feature)).toBe(true);
  });

  test("returns true for Feature with all required fields", () => {
    const feature: Feature = {
      category: "functional",
      description: "Add login button",
      steps: ["step1", "step2", "step3"],
      passes: true,
    };
    expect(isFeature(feature)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isFeature(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isFeature(undefined)).toBe(false);
  });

  test("returns false for non-object types", () => {
    expect(isFeature("string")).toBe(false);
    expect(isFeature(42)).toBe(false);
    expect(isFeature(true)).toBe(false);
  });

  test("returns false when category is missing", () => {
    const invalid = { description: "test", steps: [], passes: false };
    expect(isFeature(invalid)).toBe(false);
  });

  test("returns false when description is missing", () => {
    const invalid = { category: "test", steps: [], passes: false };
    expect(isFeature(invalid)).toBe(false);
  });

  test("returns false when steps is not an array", () => {
    const invalid = { category: "test", description: "test", steps: "not-array", passes: false };
    expect(isFeature(invalid)).toBe(false);
  });

  test("returns false when passes is not a boolean", () => {
    const invalid = { category: "test", description: "test", steps: [], passes: "yes" };
    expect(isFeature(invalid)).toBe(false);
  });
});

describe("isAtomicWorkflowState", () => {
  test("returns true for valid AtomicWorkflowState", () => {
    const state = createTestAtomicState();
    expect(isAtomicWorkflowState(state)).toBe(true);
  });

  test("returns true for state created by createAtomicState", () => {
    const state = createAtomicState();
    expect(isAtomicWorkflowState(state)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isAtomicWorkflowState(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isAtomicWorkflowState(undefined)).toBe(false);
  });

  test("returns false for non-object types", () => {
    expect(isAtomicWorkflowState("string")).toBe(false);
    expect(isAtomicWorkflowState(42)).toBe(false);
  });

  test("returns false when executionId is missing", () => {
    const state = createTestAtomicState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (state as any).executionId;
    expect(isAtomicWorkflowState(state)).toBe(false);
  });

  test("returns false when iteration is not a number", () => {
    const state = createTestAtomicState({ iteration: "five" as unknown as number });
    expect(isAtomicWorkflowState(state)).toBe(false);
  });

  test("returns false when featureList is not an array", () => {
    const state = createTestAtomicState({ featureList: "not-array" as unknown as Feature[] });
    expect(isAtomicWorkflowState(state)).toBe(false);
  });
});

// ============================================================================
// RALPH STATE FACTORY TESTS
// ============================================================================

describe("createRalphState", () => {
  test("creates state with default values", () => {
    const state = createRalphState();
    
    expect(typeof state.executionId).toBe("string");
    expect(typeof state.ralphSessionId).toBe("string");
    expect(state.ralphSessionDir).toBe(join(homedir(), ".atomic", "workflows", "sessions", state.ralphSessionId));
    expect(state.yolo).toBe(false);
    expect(state.yoloPrompt).toBeNull();
    expect(state.yoloComplete).toBe(false);
    expect(state.maxIterations).toBe(100);
    expect(state.shouldContinue).toBe(true);
    expect(state.completedFeatures).toEqual([]);
  });

  test("uses provided executionId", () => {
    const customId = "my-ralph-exec-id";
    const state = createRalphState(customId);
    
    expect(state.executionId).toBe(customId);
  });

  test("uses provided options for ralph-specific fields", () => {
    const state = createRalphState(undefined, {
      yolo: true,
      yoloPrompt: "Build something cool",
      maxIterations: 50,
    });
    
    expect(state.yolo).toBe(true);
    expect(state.yoloPrompt).toBe("Build something cool");
    expect(state.maxIterations).toBe(50);
  });

  test("uses provided ralphSessionId", () => {
    const customSessionId = "custom-session-id";
    const state = createRalphState(undefined, {
      ralphSessionId: customSessionId,
    });
    
    expect(state.ralphSessionId).toBe(customSessionId);
    expect(state.ralphSessionDir).toBe(join(homedir(), ".atomic", "workflows", "sessions", customSessionId));
  });

  test("uses provided ralphSessionDir", () => {
    const customDir = "/custom/session/dir/";
    const state = createRalphState(undefined, {
      ralphSessionDir: customDir,
    });
    
    expect(state.ralphSessionDir).toBe(customDir);
  });

  test("generates unique session IDs for different calls", () => {
    const state1 = createRalphState();
    const state2 = createRalphState();
    
    expect(state1.ralphSessionId).not.toBe(state2.ralphSessionId);
    expect(state1.executionId).not.toBe(state2.executionId);
  });

  test("inherits all AtomicWorkflowState fields with correct defaults", () => {
    const state = createRalphState();
    
    expect(state.outputs).toEqual({});
    expect(state.researchDoc).toBe("");
    expect(state.specDoc).toBe("");
    expect(state.specApproved).toBe(false);
    expect(state.featureList).toEqual([]);
    expect(state.allFeaturesPassing).toBe(false);
    expect(state.debugReports).toEqual([]);
    expect(state.iteration).toBe(1);
  });
});

describe("updateRalphState", () => {
  test("updates single field while preserving others", () => {
    const current = createTestRalphState({ iteration: 5 });
    const updated = updateRalphState(current, { shouldContinue: false });
    
    expect(updated.iteration).toBe(5);
    expect(updated.shouldContinue).toBe(false);
  });

  test("updates multiple fields at once", () => {
    const current = createTestRalphState();
    const updated = updateRalphState(current, {
      yolo: true,
      yoloComplete: true,
      iteration: 10,
    });
    
    expect(updated.yolo).toBe(true);
    expect(updated.yoloComplete).toBe(true);
    expect(updated.iteration).toBe(10);
  });

  test("updates lastUpdated timestamp", () => {
    const current = createTestRalphState({ lastUpdated: "2020-01-01T00:00:00.000Z" });
    const beforeTime = new Date().toISOString();
    const updated = updateRalphState(current, { iteration: 2 });
    const afterTime = new Date().toISOString();
    
    expect(updated.lastUpdated >= beforeTime).toBe(true);
    expect(updated.lastUpdated <= afterTime).toBe(true);
  });

  test("applies concat reducer to completedFeatures", () => {
    const current = createTestRalphState({
      completedFeatures: ["feature1"],
    });
    const updated = updateRalphState(current, {
      completedFeatures: ["feature2", "feature3"],
    });
    
    expect(updated.completedFeatures).toEqual(["feature1", "feature2", "feature3"]);
  });

  test("preserves original state (immutability)", () => {
    const current = createTestRalphState({ yolo: false });
    updateRalphState(current, { yolo: true });
    
    expect(current.yolo).toBe(false);
  });
});

describe("isRalphWorkflowState", () => {
  test("returns true for valid RalphWorkflowState", () => {
    const state = createTestRalphState();
    expect(isRalphWorkflowState(state)).toBe(true);
  });

  test("returns true for state created by createRalphState", () => {
    const state = createRalphState();
    expect(isRalphWorkflowState(state)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isRalphWorkflowState(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isRalphWorkflowState(undefined)).toBe(false);
  });

  test("returns false for non-object types", () => {
    expect(isRalphWorkflowState("string")).toBe(false);
    expect(isRalphWorkflowState(42)).toBe(false);
  });

  test("returns false when ralphSessionId is missing", () => {
    const state = createTestRalphState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (state as any).ralphSessionId;
    expect(isRalphWorkflowState(state)).toBe(false);
  });

  test("returns false when yolo is not a boolean", () => {
    const state = createTestRalphState({ yolo: "yes" as unknown as boolean });
    expect(isRalphWorkflowState(state)).toBe(false);
  });

  test("returns false when maxIterations is not a number", () => {
    const state = createTestRalphState({ maxIterations: "100" as unknown as number });
    expect(isRalphWorkflowState(state)).toBe(false);
  });

  test("returns false when shouldContinue is not a boolean", () => {
    const state = createTestRalphState({ shouldContinue: 1 as unknown as boolean });
    expect(isRalphWorkflowState(state)).toBe(false);
  });

  test("returns false when completedFeatures is not an array", () => {
    const state = createTestRalphState({ completedFeatures: "not-array" as unknown as string[] });
    expect(isRalphWorkflowState(state)).toBe(false);
  });

  test("returns false for AtomicWorkflowState (missing ralph fields)", () => {
    const atomicState = createAtomicState();
    expect(isRalphWorkflowState(atomicState)).toBe(false);
  });

  test("returns false when outputs is null", () => {
    const state = createTestRalphState();
    (state as unknown as Record<string, unknown>).outputs = null;
    expect(isRalphWorkflowState(state)).toBe(false);
  });

  test("returns false when ralphSessionDir is not a string", () => {
    const state = createTestRalphState();
    (state as unknown as Record<string, unknown>).ralphSessionDir = 42;
    expect(isRalphWorkflowState(state)).toBe(false);
  });

  test("returns false when iteration is not a number", () => {
    const state = createTestRalphState({ iteration: "five" as unknown as number });
    expect(isRalphWorkflowState(state)).toBe(false);
  });
});

// ============================================================================
// GAP COVERAGE TESTS
// ============================================================================

describe("createAtomicState — gap coverage", () => {
  test("lastUpdated is a valid ISO-8601 timestamp", () => {
    const state = createAtomicState();
    const parsed = new Date(state.lastUpdated);
    expect(parsed.toISOString()).toBe(state.lastUpdated);
  });

  test("executionId has UUID-like format when auto-generated", () => {
    const state = createAtomicState();
    // crypto.randomUUID() produces a v4 UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(state.executionId)).toBe(true);
  });

  test("passes isAtomicWorkflowState type guard", () => {
    const state = createAtomicState("my-id");
    expect(isAtomicWorkflowState(state)).toBe(true);
  });
});

describe("updateAtomicState — gap coverage", () => {
  test("empty update preserves all fields except lastUpdated", () => {
    const current = createTestAtomicState({
      researchDoc: "some research",
      specApproved: true,
      iteration: 7,
    });
    const updated = updateAtomicState(current, {});

    expect(updated.researchDoc).toBe("some research");
    expect(updated.specApproved).toBe(true);
    expect(updated.iteration).toBe(7);
    expect(updated.executionId).toBe(current.executionId);
  });

  test("applies mergeById reducer on featureList", () => {
    const feature1 = createTestFeature({ description: "feat-1", passes: false });
    const feature2 = createTestFeature({ description: "feat-2", passes: true });
    const current = createTestAtomicState({ featureList: [feature1, feature2] });

    const updated = updateAtomicState(current, {
      featureList: [
        createTestFeature({ description: "feat-1", passes: true }),
        createTestFeature({ description: "feat-3", passes: false }),
      ],
    });

    expect(updated.featureList).toHaveLength(3);
    const feat1 = updated.featureList.find((f) => f.description === "feat-1");
    expect(feat1).toBeDefined();
    expect(feat1!.passes).toBe(true);
    const feat2 = updated.featureList.find((f) => f.description === "feat-2");
    expect(feat2).toBeDefined();
    expect(feat2!.passes).toBe(true);
    const feat3 = updated.featureList.find((f) => f.description === "feat-3");
    expect(feat3).toBeDefined();
    expect(feat3!.passes).toBe(false);
  });

  test("sequential updates accumulate correctly", () => {
    const current = createTestAtomicState({ iteration: 1 });
    const afterFirst = updateAtomicState(current, {
      debugReports: [{ errorSummary: "err1", relevantFiles: [], suggestedFixes: [], generatedAt: "2024-01-01" }],
    });
    const afterSecond = updateAtomicState(afterFirst, {
      debugReports: [{ errorSummary: "err2", relevantFiles: [], suggestedFixes: [], generatedAt: "2024-01-02" }],
    });

    expect(afterSecond.debugReports).toHaveLength(2);
    expect(afterSecond.debugReports[0]!.errorSummary).toBe("err1");
    expect(afterSecond.debugReports[1]!.errorSummary).toBe("err2");
  });

  test("sets currentFeature to a Feature object", () => {
    const current = createTestAtomicState();
    const feature = createTestFeature({ description: "login page" });
    const updated = updateAtomicState(current, { currentFeature: feature });

    expect(updated.currentFeature).toEqual(feature);
  });
});

describe("isFeature — gap coverage", () => {
  test("returns true for Feature with empty steps array", () => {
    const feature = createTestFeature({ steps: [] });
    expect(isFeature(feature)).toBe(true);
  });

  test("returns true for Feature with extra properties", () => {
    const feature = { ...createTestFeature(), extraProp: "hello", anotherProp: 42 };
    expect(isFeature(feature)).toBe(true);
  });

  test("returns false for empty object", () => {
    expect(isFeature({})).toBe(false);
  });

  test("returns false when category is a number instead of string", () => {
    const invalid = { category: 123, description: "test", steps: [], passes: false };
    expect(isFeature(invalid)).toBe(false);
  });
});

describe("isAtomicWorkflowState — gap coverage", () => {
  test("returns false when outputs is null", () => {
    const state = createTestAtomicState();
    (state as unknown as Record<string, unknown>).outputs = null;
    expect(isAtomicWorkflowState(state)).toBe(false);
  });

  test("returns false when debugReports is not an array", () => {
    const state = createTestAtomicState();
    (state as unknown as Record<string, unknown>).debugReports = "not-an-array";
    expect(isAtomicWorkflowState(state)).toBe(false);
  });

  test("returns false when specApproved is not a boolean", () => {
    const state = createTestAtomicState();
    (state as unknown as Record<string, unknown>).specApproved = "true";
    expect(isAtomicWorkflowState(state)).toBe(false);
  });

  test("returns false when allFeaturesPassing is not a boolean", () => {
    const state = createTestAtomicState();
    (state as unknown as Record<string, unknown>).allFeaturesPassing = 1;
    expect(isAtomicWorkflowState(state)).toBe(false);
  });

  test("returns false when researchDoc is not a string", () => {
    const state = createTestAtomicState();
    (state as unknown as Record<string, unknown>).researchDoc = 42;
    expect(isAtomicWorkflowState(state)).toBe(false);
  });

  test("returns false for an empty object", () => {
    expect(isAtomicWorkflowState({})).toBe(false);
  });
});

describe("createRalphState — gap coverage", () => {
  test("options spread overrides explicit defaults", () => {
    const state = createRalphState("exec-1", {
      researchDoc: "initial research",
      specApproved: true,
      iteration: 5,
    });

    expect(state.executionId).toBe("exec-1");
    expect(state.researchDoc).toBe("initial research");
    expect(state.specApproved).toBe(true);
    expect(state.iteration).toBe(5);
  });

  test("prBranch is undefined by default", () => {
    const state = createRalphState();
    expect(state.prBranch).toBeUndefined();
  });

  test("prBranch can be set via options", () => {
    const state = createRalphState(undefined, { prBranch: "feature/my-branch" });
    expect(state.prBranch).toBe("feature/my-branch");
  });

  test("sourceFeatureListPath is undefined by default", () => {
    const state = createRalphState();
    expect(state.sourceFeatureListPath).toBeUndefined();
  });

  test("sourceFeatureListPath can be set via options", () => {
    const state = createRalphState(undefined, { sourceFeatureListPath: "/tmp/features.json" });
    expect(state.sourceFeatureListPath).toBe("/tmp/features.json");
  });

  test("passes isRalphWorkflowState type guard", () => {
    const state = createRalphState("custom-id", { yolo: true, maxIterations: 0 });
    expect(isRalphWorkflowState(state)).toBe(true);
  });
});

describe("updateRalphState — gap coverage", () => {
  test("empty update preserves all fields except lastUpdated", () => {
    const current = createTestRalphState({
      yolo: true,
      yoloPrompt: "build something",
      maxIterations: 50,
      iteration: 3,
    });
    const updated = updateRalphState(current, {});

    expect(updated.yolo).toBe(true);
    expect(updated.yoloPrompt).toBe("build something");
    expect(updated.maxIterations).toBe(50);
    expect(updated.iteration).toBe(3);
    expect(updated.ralphSessionId).toBe(current.ralphSessionId);
  });

  test("applies mergeById reducer on featureList", () => {
    const f1 = createTestFeature({ description: "feat-A", passes: false });
    const f2 = createTestFeature({ description: "feat-B", passes: false });
    const current = createTestRalphState({ featureList: [f1, f2] });

    const updated = updateRalphState(current, {
      featureList: [createTestFeature({ description: "feat-A", passes: true })],
    });

    expect(updated.featureList).toHaveLength(2);
    const fA = updated.featureList.find((f) => f.description === "feat-A");
    expect(fA).toBeDefined();
    expect(fA!.passes).toBe(true);
    const fB = updated.featureList.find((f) => f.description === "feat-B");
    expect(fB).toBeDefined();
    expect(fB!.passes).toBe(false);
  });

  test("applies concat reducer to debugReports", () => {
    const current = createTestRalphState({
      debugReports: [{ errorSummary: "err1", relevantFiles: [], suggestedFixes: [], generatedAt: "2024-01-01" }],
    });
    const updated = updateRalphState(current, {
      debugReports: [{ errorSummary: "err2", relevantFiles: ["file.ts"], suggestedFixes: ["fix it"], generatedAt: "2024-01-02" }],
    });

    expect(updated.debugReports).toHaveLength(2);
    expect(updated.debugReports[0]!.errorSummary).toBe("err1");
    expect(updated.debugReports[1]!.errorSummary).toBe("err2");
    expect(updated.debugReports[1]!.relevantFiles).toEqual(["file.ts"]);
  });

  test("sequential updates produce valid state", () => {
    let state = createTestRalphState();
    state = updateRalphState(state, { iteration: 2, completedFeatures: ["feat-1"] });
    state = updateRalphState(state, { iteration: 3, completedFeatures: ["feat-2"] });
    state = updateRalphState(state, { shouldContinue: false });

    expect(state.iteration).toBe(3);
    expect(state.completedFeatures).toEqual(["feat-1", "feat-2"]);
    expect(state.shouldContinue).toBe(false);
    expect(isRalphWorkflowState(state)).toBe(true);
  });
});
