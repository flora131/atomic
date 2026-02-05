/**
 * Tests for Ralph Workflow
 *
 * Tests the createRalphWorkflow() function and related functionality.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createRalphWorkflow,
  createTestRalphWorkflow,
  RALPH_NODE_IDS,
  type CreateRalphWorkflowConfig,
} from "../../src/workflows/ralph/workflow.ts";
import { RALPH_CONFIG } from "../../src/config/ralph.ts";

// ============================================================================
// CONSTANTS Tests
// ============================================================================

describe("RALPH_NODE_IDS", () => {
  test("defines INIT_SESSION constant", () => {
    expect(RALPH_NODE_IDS.INIT_SESSION).toBe("init-session");
  });

  test("defines CLEAR_CONTEXT constant", () => {
    expect(RALPH_NODE_IDS.CLEAR_CONTEXT).toBe("clear-context");
  });

  test("defines IMPLEMENT_FEATURE constant", () => {
    expect(RALPH_NODE_IDS.IMPLEMENT_FEATURE).toBe("implement-feature");
  });

  test("defines CHECK_COMPLETION constant", () => {
    expect(RALPH_NODE_IDS.CHECK_COMPLETION).toBe("check-completion");
  });

  test("has exactly 4 node IDs", () => {
    // RALPH_NODE_IDS contains: INIT_SESSION, CLEAR_CONTEXT, IMPLEMENT_FEATURE, CHECK_COMPLETION
    // Note: CREATE_PR was removed - PR creation is handled externally
    expect(Object.keys(RALPH_NODE_IDS).length).toBe(4);
  });
});

// ============================================================================
// createRalphWorkflow Tests
// ============================================================================

describe("createRalphWorkflow", () => {
  test("creates a compiled graph with default config", () => {
    const workflow = createRalphWorkflow();

    expect(workflow).toBeDefined();
    expect(workflow.nodes).toBeInstanceOf(Map);
    expect(workflow.startNode).toBeDefined();
  });

  test("creates a compiled graph with custom maxIterations", () => {
    const workflow = createRalphWorkflow({ maxIterations: 50 });

    expect(workflow).toBeDefined();
    expect(workflow.nodes).toBeInstanceOf(Map);
  });

  test("creates a compiled graph with checkpointing disabled", () => {
    const workflow = createRalphWorkflow({ checkpointing: false });

    expect(workflow).toBeDefined();
    expect(workflow.config.checkpointer).toBeUndefined();
  });

  test("creates a compiled graph with custom featureListPath", () => {
    const workflow = createRalphWorkflow({
      featureListPath: "custom/features.json",
    });

    expect(workflow).toBeDefined();
  });

  test("creates a compiled graph in yolo mode", () => {
    const workflow = createRalphWorkflow({
      yolo: true,
      userPrompt: "Implement the authentication system",
    });

    expect(workflow).toBeDefined();
  });

  test("creates a compiled graph with all options", () => {
    const config: CreateRalphWorkflowConfig = {
      maxIterations: 25,
      checkpointing: true,
      featureListPath: "specs/features.json",
      yolo: false,
      userPrompt: undefined,
    };

    const workflow = createRalphWorkflow(config);

    expect(workflow).toBeDefined();
    expect(workflow.nodes).toBeInstanceOf(Map);
    expect(workflow.startNode).toBeDefined();
  });

  test("uses RALPH_CONFIG defaults when no config provided", () => {
    // This test verifies that the workflow uses defaults from RALPH_CONFIG
    // We can't directly inspect the compiled graph's internal config,
    // but we can verify the workflow is created successfully
    const workflow = createRalphWorkflow();

    expect(workflow).toBeDefined();
    // RALPH_CONFIG defaults are used internally
    expect(RALPH_CONFIG.maxIterations).toBe(100);
    expect(RALPH_CONFIG.checkpointing).toBe(true);
  });

  test("compiled graph has expected structure", () => {
    const workflow = createRalphWorkflow();

    // Verify CompiledGraph structure
    expect(workflow.nodes).toBeInstanceOf(Map);
    expect(workflow.edges).toBeInstanceOf(Array);
    expect(typeof workflow.startNode).toBe("string");
    expect(workflow.endNodes).toBeInstanceOf(Set);
    expect(workflow.config).toBeDefined();
  });

  test("workflow has autoCheckpoint enabled by default", () => {
    const workflow = createRalphWorkflow();

    expect(workflow.config.autoCheckpoint).toBe(true);
  });

  test("workflow has contextWindowThreshold set", () => {
    const workflow = createRalphWorkflow();

    expect(workflow.config.contextWindowThreshold).toBe(60);
  });
});

// ============================================================================
// createTestRalphWorkflow Tests
// ============================================================================

describe("createTestRalphWorkflow", () => {
  test("creates a compiled graph with test defaults", () => {
    const workflow = createTestRalphWorkflow();

    expect(workflow).toBeDefined();
    expect(workflow.nodes).toBeInstanceOf(Map);
    expect(workflow.startNode).toBeDefined();
  });

  test("accepts optional config overrides", () => {
    const workflow = createTestRalphWorkflow({
      featureListPath: "test/features.json",
    });

    expect(workflow).toBeDefined();
  });

  test("creates workflow with minimal iterations for testing", () => {
    // Test workflow uses maxIterations: 5 and checkpointing: false
    const workflow = createTestRalphWorkflow();

    expect(workflow).toBeDefined();
    // Test workflow disables checkpointing
    expect(workflow.config.checkpointer).toBeUndefined();
  });

  test("can be created in yolo mode", () => {
    const workflow = createTestRalphWorkflow({
      yolo: true,
      userPrompt: "Test task",
    });

    expect(workflow).toBeDefined();
  });
});

// ============================================================================
// CreateRalphWorkflowConfig Type Tests
// ============================================================================

describe("CreateRalphWorkflowConfig", () => {
  test("all fields are optional", () => {
    // An empty config should be valid
    const config: CreateRalphWorkflowConfig = {};
    const workflow = createRalphWorkflow(config);

    expect(workflow).toBeDefined();
  });

  test("maxIterations accepts number", () => {
    const config: CreateRalphWorkflowConfig = {
      maxIterations: 200,
    };

    expect(typeof config.maxIterations).toBe("number");
  });

  test("checkpointing accepts boolean", () => {
    const config: CreateRalphWorkflowConfig = {
      checkpointing: false,
    };

    expect(typeof config.checkpointing).toBe("boolean");
  });

  test("checkpointing accepts truthy value", () => {
    // Note: checkpointDir was removed - checkpoints are now saved per-session
    // in .ralph/sessions/{sessionId}/checkpoints/ using SessionDirSaver
    const config: CreateRalphWorkflowConfig = {
      checkpointing: true,
    };

    expect(config.checkpointing).toBe(true);
  });

  test("featureListPath accepts string", () => {
    const config: CreateRalphWorkflowConfig = {
      featureListPath: "features.json",
    };

    expect(typeof config.featureListPath).toBe("string");
  });

  test("yolo accepts boolean", () => {
    const config: CreateRalphWorkflowConfig = {
      yolo: true,
    };

    expect(typeof config.yolo).toBe("boolean");
  });

  test("userPrompt accepts string", () => {
    const config: CreateRalphWorkflowConfig = {
      userPrompt: "Do something",
    };

    expect(typeof config.userPrompt).toBe("string");
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Ralph workflow integration", () => {
  test("workflow has expected structure", () => {
    const workflow = createRalphWorkflow();

    // CompiledGraph interface
    expect(workflow.nodes).toBeInstanceOf(Map);
    expect(workflow.edges).toBeInstanceOf(Array);
    expect(workflow.startNode).toBeDefined();
    expect(workflow.endNodes).toBeInstanceOf(Set);
    expect(workflow.config).toBeDefined();
  });

  test("test workflow and regular workflow both compile", () => {
    const regularWorkflow = createRalphWorkflow();
    const testWorkflow = createTestRalphWorkflow();

    expect(regularWorkflow).toBeDefined();
    expect(testWorkflow).toBeDefined();
  });

  test("workflows with different configs are independent", () => {
    const workflow1 = createRalphWorkflow({ maxIterations: 10 });
    const workflow2 = createRalphWorkflow({ maxIterations: 20 });

    // Both should be defined and independent
    expect(workflow1).toBeDefined();
    expect(workflow2).toBeDefined();
    expect(workflow1).not.toBe(workflow2);
  });

  test("workflow contains init session node", () => {
    const workflow = createRalphWorkflow();

    expect(workflow.nodes.has(RALPH_NODE_IDS.INIT_SESSION)).toBe(true);
  });

  test("workflow contains clear context node", () => {
    const workflow = createRalphWorkflow();

    expect(workflow.nodes.has(RALPH_NODE_IDS.CLEAR_CONTEXT)).toBe(true);
  });

  test("workflow contains implement feature node", () => {
    const workflow = createRalphWorkflow();

    expect(workflow.nodes.has(RALPH_NODE_IDS.IMPLEMENT_FEATURE)).toBe(true);
  });

  test("workflow contains check completion node", () => {
    const workflow = createRalphWorkflow();

    expect(workflow.nodes.has(RALPH_NODE_IDS.CHECK_COMPLETION)).toBe(true);
  });

  test("workflow has 4 core Ralph nodes", () => {
    // Note: CREATE_PR node was removed - PR creation is now handled externally
    // The workflow now focuses on feature implementation only
    const workflow = createRalphWorkflow();

    expect(workflow.nodes.has(RALPH_NODE_IDS.INIT_SESSION)).toBe(true);
    expect(workflow.nodes.has(RALPH_NODE_IDS.CLEAR_CONTEXT)).toBe(true);
    expect(workflow.nodes.has(RALPH_NODE_IDS.IMPLEMENT_FEATURE)).toBe(true);
    expect(workflow.nodes.has(RALPH_NODE_IDS.CHECK_COMPLETION)).toBe(true);
  });

  test("workflow starts with init session node", () => {
    const workflow = createRalphWorkflow();

    expect(workflow.startNode).toBe(RALPH_NODE_IDS.INIT_SESSION);
  });
});

// ============================================================================
// clearContextNode Loop Placement Tests
// ============================================================================

describe("clearContextNode loop placement", () => {
  test("clearContextNode is inside the loop, not before it", () => {
    const workflow = createRalphWorkflow();

    // Find the loop_start node (entry point to loop)
    const loopStartNode = Array.from(workflow.nodes.keys()).find((id) =>
      id.includes("loop_start")
    );
    expect(loopStartNode).toBeDefined();

    // clearContextNode should be connected from loop_start (first node in loop body)
    const edgeFromLoopStart = workflow.edges.find(
      (e) => e.from === loopStartNode && e.to === RALPH_NODE_IDS.CLEAR_CONTEXT
    );
    expect(edgeFromLoopStart).toBeDefined();
  });

  test("clearContextNode chains to implementFeatureNode", () => {
    const workflow = createRalphWorkflow();

    // clearContextNode should be connected to implementFeatureNode
    const edgeToImplement = workflow.edges.find(
      (e) =>
        e.from === RALPH_NODE_IDS.CLEAR_CONTEXT &&
        e.to === RALPH_NODE_IDS.IMPLEMENT_FEATURE
    );
    expect(edgeToImplement).toBeDefined();
  });

  test("implementFeatureNode connects to loop_check", () => {
    const workflow = createRalphWorkflow();

    // Find the loop_check node
    const loopCheckNode = Array.from(workflow.nodes.keys()).find((id) =>
      id.includes("loop_check")
    );
    expect(loopCheckNode).toBeDefined();

    // implementFeatureNode should connect to loop_check
    const edgeToLoopCheck = workflow.edges.find(
      (e) => e.from === RALPH_NODE_IDS.IMPLEMENT_FEATURE && e.to === loopCheckNode
    );
    expect(edgeToLoopCheck).toBeDefined();
  });

  test("loop continue edge points to clearContextNode (first in loop body)", () => {
    const workflow = createRalphWorkflow();

    // Find the loop-continue edge
    const continueEdge = workflow.edges.find((e) => e.label === "loop-continue");
    expect(continueEdge).toBeDefined();

    // The continue edge should point to clearContextNode, not implementFeatureNode
    // This ensures clearContextNode runs at the START of each iteration
    expect(continueEdge?.to).toBe(RALPH_NODE_IDS.CLEAR_CONTEXT);
  });

  test("loop structure: start -> clear -> implement -> check", () => {
    const workflow = createRalphWorkflow();

    // Find the loop nodes
    const loopStartNode = Array.from(workflow.nodes.keys()).find((id) =>
      id.includes("loop_start")
    );
    const loopCheckNode = Array.from(workflow.nodes.keys()).find((id) =>
      id.includes("loop_check")
    );

    // Verify the complete chain:
    // 1. loop_start -> clear-context
    const startToClear = workflow.edges.find(
      (e) => e.from === loopStartNode && e.to === RALPH_NODE_IDS.CLEAR_CONTEXT
    );
    expect(startToClear).toBeDefined();

    // 2. clear-context -> implement-feature
    const clearToImplement = workflow.edges.find(
      (e) =>
        e.from === RALPH_NODE_IDS.CLEAR_CONTEXT &&
        e.to === RALPH_NODE_IDS.IMPLEMENT_FEATURE
    );
    expect(clearToImplement).toBeDefined();

    // 3. implement-feature -> loop_check
    const implementToCheck = workflow.edges.find(
      (e) => e.from === RALPH_NODE_IDS.IMPLEMENT_FEATURE && e.to === loopCheckNode
    );
    expect(implementToCheck).toBeDefined();

    // 4. loop_check -> clear-context (continue edge)
    const continueEdge = workflow.edges.find(
      (e) =>
        e.from === loopCheckNode &&
        e.to === RALPH_NODE_IDS.CLEAR_CONTEXT &&
        e.label === "loop-continue"
    );
    expect(continueEdge).toBeDefined();
  });

  test("init node does NOT connect directly to clearContextNode", () => {
    const workflow = createRalphWorkflow();

    // Before the fix, init connected directly to clear, then clear to loop
    // After the fix, init connects to loop_start, and clear is inside the loop
    // So there should be NO direct edge from init to clear
    // Instead: init -> loop_start -> clear -> implement -> loop_check -> clear (continue)

    // Find the loop_start node
    const loopStartNode = Array.from(workflow.nodes.keys()).find((id) =>
      id.includes("loop_start")
    );
    expect(loopStartNode).toBeDefined();

    // init should connect to loop_start, not directly to clear
    const initToLoopStart = workflow.edges.find(
      (e) => e.from === RALPH_NODE_IDS.INIT_SESSION && e.to === loopStartNode
    );
    expect(initToLoopStart).toBeDefined();

    // There should be no edge from init directly to clear
    const initToClear = workflow.edges.find(
      (e) =>
        e.from === RALPH_NODE_IDS.INIT_SESSION && e.to === RALPH_NODE_IDS.CLEAR_CONTEXT
    );
    expect(initToClear).toBeUndefined();
  });
});
