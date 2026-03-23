import type {
  AtomicWorkflowState,
  Feature,
} from "@/services/workflows/graph/annotation.ts";

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
