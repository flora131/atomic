import { describe, expect, test } from "bun:test";
import {
  createAtomicState,
  isAtomicWorkflowState,
  updateAtomicState,
} from "@/services/workflows/graph/annotation.ts";
import { createTestAtomicState, createTestFeature } from "./fixtures.ts";

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
    expect(state.iteration).toBe(1);
  });

  test("uses provided executionId", () => {
    expect(createAtomicState("my-custom-execution-id").executionId).toBe(
      "my-custom-execution-id",
    );
  });

  test("generates unique executionId when not provided", () => {
    expect(createAtomicState().executionId).not.toBe(createAtomicState().executionId);
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
    const updated = updateAtomicState(createTestAtomicState(), {
      researchDoc: "New research",
      specDoc: "New spec",
      iteration: 10,
    });

    expect(updated.researchDoc).toBe("New research");
    expect(updated.specDoc).toBe("New spec");
    expect(updated.iteration).toBe(10);
  });

  test("updates lastUpdated timestamp", () => {
    const beforeTime = new Date().toISOString();
    const updated = updateAtomicState(
      createTestAtomicState({ lastUpdated: "2020-01-01T00:00:00.000Z" }),
      { iteration: 2 },
    );
    const afterTime = new Date().toISOString();

    expect(updated.lastUpdated >= beforeTime).toBe(true);
    expect(updated.lastUpdated <= afterTime).toBe(true);
  });

  test("applies concat reducer to debugReports", () => {
    const updated = updateAtomicState(
      createTestAtomicState({
        debugReports: [{
          errorSummary: "error1",
          relevantFiles: [],
          suggestedFixes: [],
          generatedAt: "2024-01-01",
        }],
      }),
      {
        debugReports: [{
          errorSummary: "error2",
          relevantFiles: [],
          suggestedFixes: [],
          generatedAt: "2024-01-02",
        }],
      },
    );

    expect(updated.debugReports).toHaveLength(2);
  });

  test("preserves original state (immutability)", () => {
    const current = createTestAtomicState({ specDoc: "original" });
    updateAtomicState(current, { specDoc: "updated" });
    expect(current.specDoc).toBe("original");
  });
});

describe("isAtomicWorkflowState", () => {
  test("returns true for valid AtomicWorkflowState", () => {
    expect(isAtomicWorkflowState(createTestAtomicState())).toBe(true);
  });

  test("returns true for state created by createAtomicState", () => {
    expect(isAtomicWorkflowState(createAtomicState())).toBe(true);
  });

  test("returns false for nullish and primitive values", () => {
    expect(isAtomicWorkflowState(null)).toBe(false);
    expect(isAtomicWorkflowState(undefined)).toBe(false);
    expect(isAtomicWorkflowState("string")).toBe(false);
    expect(isAtomicWorkflowState(42)).toBe(false);
  });

  test("returns false when required fields are invalid", () => {
    const missingExecutionId = createTestAtomicState();
    delete (missingExecutionId as unknown as Record<string, unknown>).executionId;
    expect(isAtomicWorkflowState(missingExecutionId)).toBe(false);

    expect(
      isAtomicWorkflowState(
        createTestAtomicState({ iteration: "five" as unknown as number }),
      ),
    ).toBe(false);

    expect(
      isAtomicWorkflowState(
        createTestAtomicState({
          featureList: "not-array" as unknown as ReturnType<
            typeof createTestAtomicState
          >["featureList"],
        }),
      ),
    ).toBe(false);
  });
});

describe("createAtomicState — gap coverage", () => {
  test("lastUpdated is a valid ISO-8601 timestamp", () => {
    const state = createAtomicState();
    expect(new Date(state.lastUpdated).toISOString()).toBe(state.lastUpdated);
  });

  test("executionId has UUID-like format when auto-generated", () => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(createAtomicState().executionId)).toBe(true);
  });

  test("passes isAtomicWorkflowState type guard", () => {
    expect(isAtomicWorkflowState(createAtomicState("my-id"))).toBe(true);
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
    const current = createTestAtomicState({
      featureList: [
        createTestFeature({ description: "feat-1", passes: false }),
        createTestFeature({ description: "feat-2", passes: true }),
      ],
    });

    const updated = updateAtomicState(current, {
      featureList: [
        createTestFeature({ description: "feat-1", passes: true }),
        createTestFeature({ description: "feat-3", passes: false }),
      ],
    });

    expect(updated.featureList).toHaveLength(3);
    expect(updated.featureList.find((f) => f.description === "feat-1")!.passes).toBe(true);
    expect(updated.featureList.find((f) => f.description === "feat-2")!.passes).toBe(true);
    expect(updated.featureList.find((f) => f.description === "feat-3")!.passes).toBe(false);
  });

  test("sequential updates accumulate correctly", () => {
    const afterFirst = updateAtomicState(createTestAtomicState({ iteration: 1 }), {
      debugReports: [{
        errorSummary: "err1",
        relevantFiles: [],
        suggestedFixes: [],
        generatedAt: "2024-01-01",
      }],
    });
    const afterSecond = updateAtomicState(afterFirst, {
      debugReports: [{
        errorSummary: "err2",
        relevantFiles: [],
        suggestedFixes: [],
        generatedAt: "2024-01-02",
      }],
    });

    expect(afterSecond.debugReports).toHaveLength(2);
    expect(afterSecond.debugReports[0]!.errorSummary).toBe("err1");
    expect(afterSecond.debugReports[1]!.errorSummary).toBe("err2");
  });

  test("sets currentFeature to a Feature object", () => {
    const feature = createTestFeature({ description: "login page" });
    const updated = updateAtomicState(createTestAtomicState(), {
      currentFeature: feature,
    });

    expect(updated.currentFeature).toEqual(feature);
  });
});

describe("isAtomicWorkflowState — gap coverage", () => {
  test("returns false when object fields have invalid types", () => {
    const outputsNull = createTestAtomicState();
    (outputsNull as unknown as Record<string, unknown>).outputs = null;
    expect(isAtomicWorkflowState(outputsNull)).toBe(false);

    const debugReportsWrong = createTestAtomicState();
    (debugReportsWrong as unknown as Record<string, unknown>).debugReports = "not-an-array";
    expect(isAtomicWorkflowState(debugReportsWrong)).toBe(false);

    const specApprovedWrong = createTestAtomicState();
    (specApprovedWrong as unknown as Record<string, unknown>).specApproved = "true";
    expect(isAtomicWorkflowState(specApprovedWrong)).toBe(false);

    const allFeaturesPassingWrong = createTestAtomicState();
    (allFeaturesPassingWrong as unknown as Record<string, unknown>).allFeaturesPassing = 1;
    expect(isAtomicWorkflowState(allFeaturesPassingWrong)).toBe(false);

    const researchDocWrong = createTestAtomicState();
    (researchDocWrong as unknown as Record<string, unknown>).researchDoc = 42;
    expect(isAtomicWorkflowState(researchDocWrong)).toBe(false);
  });

  test("returns false for an empty object", () => {
    expect(isAtomicWorkflowState({})).toBe(false);
  });
});
