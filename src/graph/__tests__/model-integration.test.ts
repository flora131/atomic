/**
 * Integration test for graph execution with per-node model configuration
 *
 * Tests a graph with 3 nodes having different model configurations:
 * - Node 1: explicit model ('opus')
 * - Node 2: model: 'inherit'
 * - Node 3: no model specified
 *
 * Verifies correct model resolution at each node.
 */

import { describe, test, expect } from "bun:test";
import { graph, createNode } from "../builder.ts";
import { executeGraph } from "../compiled.ts";
import type { BaseState, NodeDefinition } from "../types.ts";

// ============================================================================
// Test State Types
// ============================================================================

interface TestState extends BaseState {
  capturedModels: Record<string, string | undefined>;
  executionOrder: string[];
}

function createTestState(overrides: Partial<TestState> = {}): TestState {
  return {
    executionId: "integration-test-1",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    capturedModels: {},
    executionOrder: [],
    ...overrides,
  };
}

// ============================================================================
// Helper: Create a node that captures its resolved model
// ============================================================================

function createModelCapturingNode(id: string, model?: string): NodeDefinition<TestState> {
  const node = createNode<TestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      capturedModels: {
        ...ctx.state.capturedModels,
        [id]: ctx.model,
      },
      executionOrder: [...ctx.state.executionOrder, id],
    },
  }));

  if (model !== undefined) {
    node.model = model;
  }

  return node;
}

// ============================================================================
// Integration Tests
// ============================================================================

describe("Model Integration Tests", () => {
  test("graph with 3 nodes: explicit model, inherit, and no model", async () => {
    // Create 3 nodes with different model configurations:
    // - Node 1: model: 'opus' (explicit)
    // - Node 2: model: 'inherit' (inherits from parent context or default)
    // - Node 3: no model specified (uses default)
    const node1 = createModelCapturingNode("node1", "opus");
    const node2 = createModelCapturingNode("node2", "inherit");
    const node3 = createModelCapturingNode("node3");

    const compiled = graph<TestState>()
      .start(node1)
      .then(node2)
      .then(node3)
      .end()
      .compile({ defaultModel: "sonnet" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    // Verify execution completed successfully
    expect(result.status).toBe("completed");

    // Verify execution order
    expect(result.state.executionOrder).toEqual(["node1", "node2", "node3"]);

    // Assert Node 1 gets 'opus' (explicit model)
    expect(result.state.capturedModels["node1"]).toBe("opus");

    // Assert Node 2 gets 'sonnet' (inherits from defaultModel since no parent context model)
    expect(result.state.capturedModels["node2"]).toBe("sonnet");

    // Assert Node 3 gets 'sonnet' (default model)
    expect(result.state.capturedModels["node3"]).toBe("sonnet");
  });

  test("all nodes inherit when no explicit models are set", async () => {
    const node1 = createModelCapturingNode("node1");
    const node2 = createModelCapturingNode("node2");
    const node3 = createModelCapturingNode("node3");

    const compiled = graph<TestState>()
      .start(node1)
      .then(node2)
      .then(node3)
      .end()
      .compile({ defaultModel: "haiku" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");

    // All nodes should use the default model
    expect(result.state.capturedModels["node1"]).toBe("haiku");
    expect(result.state.capturedModels["node2"]).toBe("haiku");
    expect(result.state.capturedModels["node3"]).toBe("haiku");
  });

  test("each node can have a different explicit model", async () => {
    const node1 = createModelCapturingNode("node1", "opus");
    const node2 = createModelCapturingNode("node2", "sonnet");
    const node3 = createModelCapturingNode("node3", "haiku");

    const compiled = graph<TestState>()
      .start(node1)
      .then(node2)
      .then(node3)
      .end()
      .compile({ defaultModel: "default-unused" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");

    // Each node uses its own explicit model
    expect(result.state.capturedModels["node1"]).toBe("opus");
    expect(result.state.capturedModels["node2"]).toBe("sonnet");
    expect(result.state.capturedModels["node3"]).toBe("haiku");
  });

  test("no default model results in undefined for unspecified nodes", async () => {
    const node1 = createModelCapturingNode("node1", "opus");
    const node2 = createModelCapturingNode("node2", "inherit");
    const node3 = createModelCapturingNode("node3");

    const compiled = graph<TestState>()
      .start(node1)
      .then(node2)
      .then(node3)
      .end()
      .compile(); // No defaultModel

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");

    // Node 1 has explicit model
    expect(result.state.capturedModels["node1"]).toBe("opus");

    // Node 2 with 'inherit' and no default = undefined
    expect(result.state.capturedModels["node2"]).toBeUndefined();

    // Node 3 with no model and no default = undefined
    expect(result.state.capturedModels["node3"]).toBeUndefined();
  });
});
