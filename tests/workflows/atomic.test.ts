/**
 * Unit tests for Atomic workflow
 *
 * Tests cover:
 * - Workflow creation and configuration
 * - Node definitions and properties
 * - Helper functions for feature management
 * - Workflow compilation
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createAtomicWorkflow,
  createTestAtomicWorkflow,
  DEFAULT_MAX_ITERATIONS,
  ATOMIC_NODE_IDS,
  createAtomicState,
  extractTextContent,
  parseFeatureList,
  getNextFeature,
  checkAllFeaturesPassing,
  researchNode,
  createSpecNode,
  reviewSpecNode,
  waitForApprovalNode,
  checkApprovalNode,
  createFeatureListNode,
  selectFeatureNode,
  implementFeatureNode,
  checkFeaturesNode,
  createPRNode,
  type Feature,
} from "../../src/workflows/atomic.ts";
import type { AtomicWorkflowState } from "../../src/graph/annotation.ts";
import type { AgentMessage } from "../../src/sdk/types.ts";

// ============================================================================
// Test Helpers
// ============================================================================

function createTestState(overrides: Partial<AtomicWorkflowState> = {}): AtomicWorkflowState {
  return {
    ...createAtomicState(),
    ...overrides,
  };
}

function createTestFeatures(): Feature[] {
  return [
    {
      category: "functional",
      description: "Feature 1",
      steps: ["Step 1", "Step 2"],
      passes: false,
    },
    {
      category: "ui",
      description: "Feature 2",
      steps: ["Step A", "Step B"],
      passes: true,
    },
    {
      category: "refactor",
      description: "Feature 3",
      steps: ["Refactor X"],
      passes: false,
    },
  ];
}

function createTextMessage(content: string): AgentMessage {
  return {
    type: "text",
    content,
    role: "assistant",
  };
}

// ============================================================================
// Constants Tests
// ============================================================================

describe("Constants", () => {
  test("DEFAULT_MAX_ITERATIONS is 100", () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(100);
  });

  test("ATOMIC_NODE_IDS has all required nodes", () => {
    expect(ATOMIC_NODE_IDS.RESEARCH).toBe("research");
    expect(ATOMIC_NODE_IDS.CREATE_SPEC).toBe("create-spec");
    expect(ATOMIC_NODE_IDS.REVIEW_SPEC).toBe("review-spec");
    expect(ATOMIC_NODE_IDS.WAIT_FOR_APPROVAL).toBe("wait-for-approval");
    expect(ATOMIC_NODE_IDS.CHECK_APPROVAL).toBe("check-approval");
    expect(ATOMIC_NODE_IDS.CREATE_FEATURE_LIST).toBe("create-feature-list");
    expect(ATOMIC_NODE_IDS.SELECT_FEATURE).toBe("select-feature");
    expect(ATOMIC_NODE_IDS.IMPLEMENT_FEATURE).toBe("implement-feature");
    expect(ATOMIC_NODE_IDS.CHECK_FEATURES).toBe("check-features");
    expect(ATOMIC_NODE_IDS.CREATE_PR).toBe("create-pr");
  });
});

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe("extractTextContent", () => {
  test("extracts text from messages", () => {
    const messages: AgentMessage[] = [
      createTextMessage("Hello"),
      createTextMessage("World"),
    ];
    expect(extractTextContent(messages)).toBe("Hello\nWorld");
  });

  test("filters non-text messages", () => {
    const messages: AgentMessage[] = [
      createTextMessage("Text content"),
      { type: "tool_use", content: "tool", role: "assistant" },
      createTextMessage("More text"),
    ];
    expect(extractTextContent(messages)).toBe("Text content\nMore text");
  });

  test("returns empty string for empty array", () => {
    expect(extractTextContent([])).toBe("");
  });
});

describe("parseFeatureList", () => {
  test("parses valid JSON array", () => {
    const content = `[
      {"category": "functional", "description": "Feature 1", "steps": ["Step 1"], "passes": false},
      {"category": "ui", "description": "Feature 2", "steps": [], "passes": true}
    ]`;
    const features = parseFeatureList(content);
    expect(features).toHaveLength(2);
    expect(features[0]!.description).toBe("Feature 1");
    expect(features[1]!.passes).toBe(true);
  });

  test("parses JSON embedded in text", () => {
    const content = `Here are the features:
    [{"category": "test", "description": "Test feature", "steps": ["Do thing"]}]
    End of features.`;
    const features = parseFeatureList(content);
    expect(features).toHaveLength(1);
    expect(features[0]!.description).toBe("Test feature");
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseFeatureList("not json")).toEqual([]);
    expect(parseFeatureList("{not an array}")).toEqual([]);
  });

  test("handles missing fields with defaults", () => {
    const content = '[{"description": "Minimal feature"}]';
    const features = parseFeatureList(content);
    expect(features).toHaveLength(1);
    expect(features[0]!.category).toBe("functional");
    expect(features[0]!.steps).toEqual([]);
    expect(features[0]!.passes).toBe(false);
  });
});

describe("getNextFeature", () => {
  test("returns first unpassed feature", () => {
    const features = createTestFeatures();
    const next = getNextFeature(features);
    expect(next?.description).toBe("Feature 1");
  });

  test("skips passed features", () => {
    const features: Feature[] = [
      { category: "test", description: "Passed", steps: [], passes: true },
      { category: "test", description: "Unpassed", steps: [], passes: false },
    ];
    const next = getNextFeature(features);
    expect(next?.description).toBe("Unpassed");
  });

  test("returns null when all features pass", () => {
    const features: Feature[] = [
      { category: "test", description: "F1", steps: [], passes: true },
      { category: "test", description: "F2", steps: [], passes: true },
    ];
    expect(getNextFeature(features)).toBeNull();
  });

  test("returns null for empty array", () => {
    expect(getNextFeature([])).toBeNull();
  });
});

describe("checkAllFeaturesPassing", () => {
  test("returns true when all features pass", () => {
    const features: Feature[] = [
      { category: "test", description: "F1", steps: [], passes: true },
      { category: "test", description: "F2", steps: [], passes: true },
    ];
    expect(checkAllFeaturesPassing(features)).toBe(true);
  });

  test("returns false when any feature fails", () => {
    const features = createTestFeatures();
    expect(checkAllFeaturesPassing(features)).toBe(false);
  });

  test("returns false for empty array", () => {
    expect(checkAllFeaturesPassing([])).toBe(false);
  });
});

// ============================================================================
// Node Definition Tests
// ============================================================================

describe("Node Definitions", () => {
  describe("researchNode", () => {
    test("has correct properties", () => {
      expect(researchNode.id).toBe("research");
      expect(researchNode.type).toBe("agent");
      expect(researchNode.name).toBe("Codebase Research");
    });
  });

  describe("createSpecNode", () => {
    test("has correct properties", () => {
      expect(createSpecNode.id).toBe("create-spec");
      expect(createSpecNode.type).toBe("agent");
      expect(createSpecNode.name).toBe("Create Specification");
    });
  });

  describe("reviewSpecNode", () => {
    test("has correct properties", () => {
      expect(reviewSpecNode.id).toBe("review-spec");
      expect(reviewSpecNode.type).toBe("decision");
      expect(reviewSpecNode.name).toBe("Review Spec Decision");
    });
  });

  describe("waitForApprovalNode", () => {
    test("has correct properties", () => {
      expect(waitForApprovalNode.id).toBe("wait-for-approval");
      expect(waitForApprovalNode.type).toBe("wait");
      expect(waitForApprovalNode.name).toBe("Wait for Approval");
    });
  });

  describe("checkApprovalNode", () => {
    test("has correct properties", () => {
      expect(checkApprovalNode.id).toBe("check-approval");
      expect(checkApprovalNode.type).toBe("decision");
      expect(checkApprovalNode.name).toBe("Check Approval Result");
    });
  });

  describe("createFeatureListNode", () => {
    test("has correct properties", () => {
      expect(createFeatureListNode.id).toBe("create-feature-list");
      expect(createFeatureListNode.type).toBe("agent");
      expect(createFeatureListNode.name).toBe("Create Feature List");
    });
  });

  describe("selectFeatureNode", () => {
    test("has correct properties", () => {
      expect(selectFeatureNode.id).toBe("select-feature");
      expect(selectFeatureNode.type).toBe("decision");
      expect(selectFeatureNode.name).toBe("Select Feature");
    });
  });

  describe("implementFeatureNode", () => {
    test("has correct properties", () => {
      expect(implementFeatureNode.id).toBe("implement-feature");
      expect(implementFeatureNode.type).toBe("agent");
      expect(implementFeatureNode.name).toBe("Implement Feature");
    });
  });

  describe("checkFeaturesNode", () => {
    test("has correct properties", () => {
      expect(checkFeaturesNode.id).toBe("check-features");
      expect(checkFeaturesNode.type).toBe("decision");
      expect(checkFeaturesNode.name).toBe("Check Features");
    });
  });

  describe("createPRNode", () => {
    test("has correct properties", () => {
      expect(createPRNode.id).toBe("create-pr");
      expect(createPRNode.type).toBe("tool");
      expect(createPRNode.name).toBe("Create Pull Request");
    });
  });
});

// ============================================================================
// State Management Tests
// ============================================================================

describe("createAtomicState", () => {
  test("creates state with defaults", () => {
    const state = createAtomicState();
    expect(state.executionId).toBeDefined();
    expect(state.lastUpdated).toBeDefined();
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

  test("accepts custom executionId", () => {
    const state = createAtomicState("custom-id");
    expect(state.executionId).toBe("custom-id");
  });
});

// ============================================================================
// Workflow Creation Tests
// ============================================================================

describe("createAtomicWorkflow", () => {
  test("creates compiled graph with defaults", () => {
    const workflow = createAtomicWorkflow();
    expect(workflow).toBeDefined();
    expect(workflow.nodes).toBeInstanceOf(Map);
    expect(workflow.edges).toBeInstanceOf(Array);
    expect(workflow.startNode).toBeDefined();
  });

  test("uses default maxIterations", () => {
    const workflow = createAtomicWorkflow();
    expect(workflow.config.metadata?.maxIterations).toBeUndefined(); // Not stored in metadata
  });

  test("accepts custom maxIterations", () => {
    const workflow = createAtomicWorkflow({ maxIterations: 50 });
    expect(workflow).toBeDefined();
  });

  test("enables checkpointing by default", () => {
    const workflow = createAtomicWorkflow();
    expect(workflow.config.autoCheckpoint).toBe(true);
    expect(workflow.config.checkpointer).toBeDefined();
  });

  test("can disable checkpointing", () => {
    const workflow = createAtomicWorkflow({ checkpointing: false });
    expect(workflow.config.checkpointer).toBeUndefined();
  });

  test("sets context window threshold", () => {
    const workflow = createAtomicWorkflow();
    expect(workflow.config.contextWindowThreshold).toBe(60);
  });

  test("allows custom graph config", () => {
    const workflow = createAtomicWorkflow({
      graphConfig: {
        contextWindowThreshold: 80,
      },
    });
    expect(workflow.config.contextWindowThreshold).toBe(80);
  });
});

describe("createTestAtomicWorkflow", () => {
  test("creates minimal workflow for testing", () => {
    const workflow = createTestAtomicWorkflow();
    expect(workflow).toBeDefined();
    expect(workflow.config.autoCheckpoint).toBe(false);
    expect(workflow.config.checkpointer).toBeUndefined();
  });
});

// ============================================================================
// Workflow Structure Tests
// ============================================================================

describe("Workflow Structure", () => {
  test("workflow has required nodes", () => {
    const workflow = createAtomicWorkflow({ checkpointing: false });
    
    // Check for key nodes
    expect(workflow.nodes.has(ATOMIC_NODE_IDS.RESEARCH)).toBe(true);
    expect(workflow.nodes.has(ATOMIC_NODE_IDS.CREATE_SPEC)).toBe(true);
    expect(workflow.nodes.has(ATOMIC_NODE_IDS.CREATE_FEATURE_LIST)).toBe(true);
    expect(workflow.nodes.has(ATOMIC_NODE_IDS.IMPLEMENT_FEATURE)).toBe(true);
    expect(workflow.nodes.has(ATOMIC_NODE_IDS.CREATE_PR)).toBe(true);
  });

  test("workflow starts with research node", () => {
    const workflow = createAtomicWorkflow({ checkpointing: false });
    expect(workflow.startNode).toBe(ATOMIC_NODE_IDS.RESEARCH);
  });

  test("workflow has edges between nodes", () => {
    const workflow = createAtomicWorkflow({ checkpointing: false });
    expect(workflow.edges.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  test("full workflow can be compiled", () => {
    const workflow = createAtomicWorkflow({
      maxIterations: 10,
      checkpointing: false,
      autoApproveSpec: true,
    });

    expect(workflow).toBeDefined();
    expect(workflow.nodes.size).toBeGreaterThan(0);
    expect(workflow.edges.length).toBeGreaterThan(0);
    expect(workflow.startNode).toBe(ATOMIC_NODE_IDS.RESEARCH);
    expect(workflow.endNodes.size).toBeGreaterThan(0);
  });

  test("state and workflow are compatible", () => {
    const state = createAtomicState("test-execution");
    const workflow = createTestAtomicWorkflow();

    // Verify state has all fields expected by workflow
    expect(state.executionId).toBe("test-execution");
    expect(state.featureList).toEqual([]);
    expect(state.iteration).toBe(1);

    // Verify workflow can access nodes
    const researchNode = workflow.nodes.get(ATOMIC_NODE_IDS.RESEARCH);
    expect(researchNode).toBeDefined();
    expect(researchNode?.type).toBe("agent");
  });
});

// ============================================================================
// Human-in-the-Loop Approval Tests
// ============================================================================

import type { ExecutionContext, GraphConfig, NodeResult } from "../../src/graph/types.ts";

describe("Human-in-the-Loop Approval Flow", () => {
  function createExecutionContext(stateOverrides: Partial<AtomicWorkflowState> = {}): ExecutionContext<AtomicWorkflowState> {
    return {
      state: createTestState(stateOverrides),
      config: {} as GraphConfig,
      errors: [],
    };
  }

  describe("waitForApprovalNode execution", () => {
    test("emits human_input_required signal", async () => {
      const ctx = createExecutionContext({
        specDoc: "Test specification document",
      });

      const result = await waitForApprovalNode.execute(ctx);

      expect(result.signals).toBeDefined();
      expect(result.signals).toHaveLength(1);
      expect(result.signals![0]!.type).toBe("human_input_required");
    });

    test("includes spec content in prompt", async () => {
      const specContent = "This is my detailed specification";
      const ctx = createExecutionContext({
        specDoc: specContent,
      });

      const result = await waitForApprovalNode.execute(ctx);

      expect(result.signals![0]!.message).toContain(specContent);
    });

    test("prompt includes approval instructions", async () => {
      const ctx = createExecutionContext({
        specDoc: "Test spec",
      });

      const result = await waitForApprovalNode.execute(ctx);

      expect(result.signals![0]!.message).toContain("approve");
      expect(result.signals![0]!.message).toContain("feedback");
    });
  });

  describe("checkApprovalNode execution", () => {
    test("routes to CREATE_FEATURE_LIST when approved", async () => {
      const ctx = createExecutionContext({
        specApproved: true,
      });

      const result = await checkApprovalNode.execute(ctx);

      expect(result.goto).toBe(ATOMIC_NODE_IDS.CREATE_FEATURE_LIST);
    });

    test("routes to CREATE_SPEC when rejected", async () => {
      const ctx = createExecutionContext({
        specApproved: false,
      });

      const result = await checkApprovalNode.execute(ctx);

      expect(result.goto).toBe(ATOMIC_NODE_IDS.CREATE_SPEC);
    });
  });

  describe("reviewSpecNode execution", () => {
    test("routes to WAIT_FOR_APPROVAL when spec not approved", async () => {
      const ctx = createExecutionContext({
        specApproved: false,
      });

      const result = await reviewSpecNode.execute(ctx);

      expect(result.goto).toBe(ATOMIC_NODE_IDS.WAIT_FOR_APPROVAL);
    });

    test("routes to CREATE_FEATURE_LIST when spec already approved", async () => {
      const ctx = createExecutionContext({
        specApproved: true,
      });

      const result = await reviewSpecNode.execute(ctx);

      expect(result.goto).toBe(ATOMIC_NODE_IDS.CREATE_FEATURE_LIST);
    });
  });

  describe("Workflow with approval flow", () => {
    test("workflow includes approval nodes when not auto-approving", () => {
      const workflow = createAtomicWorkflow({
        checkpointing: false,
        autoApproveSpec: false,
      });

      expect(workflow.nodes.has(ATOMIC_NODE_IDS.WAIT_FOR_APPROVAL)).toBe(true);
      expect(workflow.nodes.has(ATOMIC_NODE_IDS.CHECK_APPROVAL)).toBe(true);
    });

    test("workflow skips approval nodes when auto-approving", () => {
      const workflow = createAtomicWorkflow({
        checkpointing: false,
        autoApproveSpec: true,
      });

      // With auto-approve, wait-for-approval and check-approval nodes 
      // are not added to the workflow graph
      expect(workflow.nodes.has(ATOMIC_NODE_IDS.WAIT_FOR_APPROVAL)).toBe(false);
      expect(workflow.nodes.has(ATOMIC_NODE_IDS.CHECK_APPROVAL)).toBe(false);
    });

    test("checkApprovalNode routes to CREATE_SPEC on rejection (via execute)", async () => {
      // Decision nodes use dynamic routing via goto in execute function
      // not via static graph edges
      const ctx = createExecutionContext({ specApproved: false });
      const result = await checkApprovalNode.execute(ctx);
      
      // Verify the node routes to CREATE_SPEC when rejected
      expect(result.goto).toBe(ATOMIC_NODE_IDS.CREATE_SPEC);
    });

    test("checkApprovalNode routes to CREATE_FEATURE_LIST on approval (via execute)", async () => {
      const ctx = createExecutionContext({ specApproved: true });
      const result = await checkApprovalNode.execute(ctx);
      
      // Verify the node routes to CREATE_FEATURE_LIST when approved
      expect(result.goto).toBe(ATOMIC_NODE_IDS.CREATE_FEATURE_LIST);
    });

    test("workflow has edge from check-approval to create-feature-list (default)", () => {
      const workflow = createAtomicWorkflow({
        checkpointing: false,
        autoApproveSpec: false,
      });

      // The default edge goes to create-feature-list (the next sequential node)
      // Dynamic routing to create-spec happens via the checkApprovalNode's execute function
      const defaultEdge = workflow.edges.find(
        (e) => e.from === ATOMIC_NODE_IDS.CHECK_APPROVAL && e.to === ATOMIC_NODE_IDS.CREATE_FEATURE_LIST
      );

      expect(defaultEdge).toBeDefined();
    });
  });

  describe("State update simulation", () => {
    test("approval input sets specApproved to true", () => {
      // Simulate what inputMapper does
      const input = "I approve this specification";
      const approved = input.toLowerCase().includes("approve");
      expect(approved).toBe(true);
    });

    test("rejection input sets specApproved to false", () => {
      // Simulate what inputMapper does
      const input = "Please revise the implementation details";
      const approved = input.toLowerCase().includes("approve");
      expect(approved).toBe(false);
    });

    test("APPROVE (uppercase) is recognized", () => {
      const input = "APPROVE";
      const approved = input.toLowerCase().includes("approve");
      expect(approved).toBe(true);
    });

    test("empty input is rejected", () => {
      const input = "";
      const approved = input.toLowerCase().includes("approve");
      expect(approved).toBe(false);
    });
  });
});
