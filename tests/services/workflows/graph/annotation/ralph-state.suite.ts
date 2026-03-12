import { describe, expect, test } from "bun:test";
import { join } from "path";
import { homedir } from "os";
import {
  createRalphState,
  isRalphWorkflowState,
  updateRalphState,
} from "@/services/workflows/ralph/state.ts";
import { createAtomicState } from "@/services/workflows/graph/annotation.ts";
import { createTestFeature, createTestRalphState } from "./fixtures.ts";

describe("createRalphState", () => {
  test("creates state with default values", () => {
    const state = createRalphState();

    expect(typeof state.executionId).toBe("string");
    expect(typeof state.ralphSessionId).toBe("string");
    expect(state.ralphSessionDir).toBe(
      join(homedir(), ".atomic", "workflows", "sessions", state.ralphSessionId),
    );
    expect(state.yolo).toBe(false);
    expect(state.yoloPrompt).toBeNull();
    expect(state.yoloComplete).toBe(false);
    expect(state.maxIterations).toBe(100);
    expect(state.shouldContinue).toBe(true);
    expect(state.completedFeatures).toEqual([]);
  });

  test("uses provided executionId", () => {
    expect(createRalphState("my-ralph-exec-id").executionId).toBe("my-ralph-exec-id");
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

  test("uses provided session values", () => {
    const customSessionId = "custom-session-id";
    const stateWithId = createRalphState(undefined, {
      ralphSessionId: customSessionId,
    });
    expect(stateWithId.ralphSessionId).toBe(customSessionId);
    expect(stateWithId.ralphSessionDir).toBe(
      join(homedir(), ".atomic", "workflows", "sessions", customSessionId),
    );

    const stateWithDir = createRalphState(undefined, {
      ralphSessionDir: "/custom/session/dir/",
    });
    expect(stateWithDir.ralphSessionDir).toBe("/custom/session/dir/");
  });

  test("generates unique session IDs for different calls", () => {
    const state1 = createRalphState();
    const state2 = createRalphState();

    expect(state1.ralphSessionId).not.toBe(state2.ralphSessionId);
    expect(state1.executionId).not.toBe(state2.executionId);
  });

  test("inherits atomic workflow defaults", () => {
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
    const updated = updateRalphState(
      createTestRalphState({ iteration: 5 }),
      { shouldContinue: false },
    );

    expect(updated.iteration).toBe(5);
    expect(updated.shouldContinue).toBe(false);
  });

  test("updates multiple fields at once", () => {
    const updated = updateRalphState(createTestRalphState(), {
      yolo: true,
      yoloComplete: true,
      iteration: 10,
    });

    expect(updated.yolo).toBe(true);
    expect(updated.yoloComplete).toBe(true);
    expect(updated.iteration).toBe(10);
  });

  test("updates lastUpdated timestamp", () => {
    const beforeTime = new Date().toISOString();
    const updated = updateRalphState(
      createTestRalphState({ lastUpdated: "2020-01-01T00:00:00.000Z" }),
      { iteration: 2 },
    );
    const afterTime = new Date().toISOString();

    expect(updated.lastUpdated >= beforeTime).toBe(true);
    expect(updated.lastUpdated <= afterTime).toBe(true);
  });

  test("applies concat reducer to completedFeatures", () => {
    const updated = updateRalphState(
      createTestRalphState({ completedFeatures: ["feature1"] }),
      { completedFeatures: ["feature2", "feature3"] },
    );

    expect(updated.completedFeatures).toEqual([
      "feature1",
      "feature2",
      "feature3",
    ]);
  });

  test("preserves original state (immutability)", () => {
    const current = createTestRalphState({ yolo: false });
    updateRalphState(current, { yolo: true });
    expect(current.yolo).toBe(false);
  });
});

describe("isRalphWorkflowState", () => {
  test("returns true for valid RalphWorkflowState", () => {
    expect(isRalphWorkflowState(createTestRalphState())).toBe(true);
  });

  test("returns true for state created by createRalphState", () => {
    expect(isRalphWorkflowState(createRalphState())).toBe(true);
  });

  test("returns false for nullish and primitive values", () => {
    expect(isRalphWorkflowState(null)).toBe(false);
    expect(isRalphWorkflowState(undefined)).toBe(false);
    expect(isRalphWorkflowState("string")).toBe(false);
    expect(isRalphWorkflowState(42)).toBe(false);
  });

  test("returns false when required Ralph fields are invalid", () => {
    const missingSession = createTestRalphState();
    delete (missingSession as unknown as Record<string, unknown>).ralphSessionId;
    expect(isRalphWorkflowState(missingSession)).toBe(false);

    expect(
      isRalphWorkflowState(
        createTestRalphState({ yolo: "yes" as unknown as boolean }),
      ),
    ).toBe(false);
    expect(
      isRalphWorkflowState(
        createTestRalphState({ maxIterations: "100" as unknown as number }),
      ),
    ).toBe(false);
    expect(
      isRalphWorkflowState(
        createTestRalphState({ shouldContinue: 1 as unknown as boolean }),
      ),
    ).toBe(false);
    expect(
      isRalphWorkflowState(
        createTestRalphState({
          completedFeatures: "not-array" as unknown as string[],
        }),
      ),
    ).toBe(false);
  });

  test("returns false for AtomicWorkflowState or malformed values", () => {
    expect(isRalphWorkflowState(createAtomicState())).toBe(false);

    const outputsNull = createTestRalphState();
    (outputsNull as unknown as Record<string, unknown>).outputs = null;
    expect(isRalphWorkflowState(outputsNull)).toBe(false);

    const dirWrong = createTestRalphState();
    (dirWrong as unknown as Record<string, unknown>).ralphSessionDir = 42;
    expect(isRalphWorkflowState(dirWrong)).toBe(false);

    expect(
      isRalphWorkflowState(
        createTestRalphState({ iteration: "five" as unknown as number }),
      ),
    ).toBe(false);
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

  test("supports optional branch and source feature path fields", () => {
    expect(createRalphState().prBranch).toBeUndefined();
    expect(
      createRalphState(undefined, { prBranch: "feature/my-branch" }).prBranch,
    ).toBe("feature/my-branch");
    expect(createRalphState().sourceFeatureListPath).toBeUndefined();
    expect(
      createRalphState(undefined, { sourceFeatureListPath: "/tmp/features.json" })
        .sourceFeatureListPath,
    ).toBe("/tmp/features.json");
  });

  test("passes isRalphWorkflowState type guard", () => {
    expect(
      isRalphWorkflowState(
        createRalphState("custom-id", { yolo: true, maxIterations: 0 }),
      ),
    ).toBe(true);
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
    const current = createTestRalphState({
      featureList: [
        createTestFeature({ description: "feat-A", passes: false }),
        createTestFeature({ description: "feat-B", passes: false }),
      ],
    });

    const updated = updateRalphState(current, {
      featureList: [createTestFeature({ description: "feat-A", passes: true })],
    });

    expect(updated.featureList).toHaveLength(2);
    expect(updated.featureList.find((f) => f.description === "feat-A")!.passes).toBe(true);
    expect(updated.featureList.find((f) => f.description === "feat-B")!.passes).toBe(false);
  });

  test("applies concat reducer to debugReports", () => {
    const updated = updateRalphState(
      createTestRalphState({
        debugReports: [{
          errorSummary: "err1",
          relevantFiles: [],
          suggestedFixes: [],
          generatedAt: "2024-01-01",
        }],
      }),
      {
        debugReports: [{
          errorSummary: "err2",
          relevantFiles: ["file.ts"],
          suggestedFixes: ["fix it"],
          generatedAt: "2024-01-02",
        }],
      },
    );

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
