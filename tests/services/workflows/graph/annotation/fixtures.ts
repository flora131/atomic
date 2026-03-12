import { join } from "path";
import { homedir } from "os";
import type {
  AtomicWorkflowState,
  Feature,
} from "@/services/workflows/graph/annotation.ts";
import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";

export function createTestFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    category: "test",
    description: "Test feature",
    steps: ["step1", "step2"],
    passes: false,
    ...overrides,
  };
}

export function createTestAtomicState(
  overrides: Partial<AtomicWorkflowState> = {},
): AtomicWorkflowState {
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

export function createTestRalphState(
  overrides: Partial<RalphWorkflowState> = {},
): RalphWorkflowState {
  return {
    executionId: "test-exec-id",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    outputs: {},
    researchDoc: "",
    specDoc: "",
    specApproved: false,
    tasks: [],
    currentTasks: [],
    reviewResult: null,
    rawReviewResult: null,
    fixesApplied: false,
    featureList: [],
    currentFeature: null,
    allFeaturesPassing: false,
    debugReports: [],
    prUrl: null,
    contextWindowUsage: null,
    iteration: 1,
    ralphSessionId: "test-session-id",
    ralphSessionDir: join(
      homedir(),
      ".atomic",
      "workflows",
      "sessions",
      "test-session-id",
    ),
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
