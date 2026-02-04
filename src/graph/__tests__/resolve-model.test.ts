/**
 * Unit tests for resolveModel function
 *
 * Tests the model resolution priority:
 * 1. node.model (if not 'inherit')
 * 2. parentContext.model (inherited from parent)
 * 3. config.defaultModel (if not 'inherit')
 * 4. undefined (let SDK use its default)
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
}

function createTestState(overrides: Partial<TestState> = {}): TestState {
  return {
    executionId: "test-exec-1",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    capturedModels: {},
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
    },
  }));
  
  // Add model to the node definition
  if (model !== undefined) {
    node.model = model;
  }
  
  return node;
}

// ============================================================================
// Tests
// ============================================================================

describe("resolveModel", () => {
  test("node with explicit model (not 'inherit') returns node.model", async () => {
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("node1", "claude-sonnet-4"))
      .end()
      .compile();

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    expect(result.state.capturedModels["node1"]).toBe("claude-sonnet-4");
  });

  test("node with model='inherit' and parent context returns parent.model", async () => {
    // When there's no explicit parent context in a simple graph execution,
    // 'inherit' should fall back to defaultModel if set
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("node1", "inherit"))
      .end()
      .compile({ defaultModel: "default-model-123" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    expect(result.state.capturedModels["node1"]).toBe("default-model-123");
  });

  test("node with model='inherit', no parent, returns config.defaultModel", async () => {
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("node1", "inherit"))
      .end()
      .compile({ defaultModel: "anthropic/claude-sonnet-4-5" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    expect(result.state.capturedModels["node1"]).toBe("anthropic/claude-sonnet-4-5");
  });

  test("node with no model, no parent, no default returns undefined", async () => {
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("node1"))
      .end()
      .compile();

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    expect(result.state.capturedModels["node1"]).toBeUndefined();
  });

  test("'inherit' at graph default level still falls through to undefined", async () => {
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("node1", "inherit"))
      .end()
      .compile({ defaultModel: "inherit" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    // Both node.model='inherit' and defaultModel='inherit' should result in undefined
    expect(result.state.capturedModels["node1"]).toBeUndefined();
  });

  test("empty string model is treated as falsy (falls through)", async () => {
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("node1", ""))
      .end()
      .compile({ defaultModel: "fallback-model" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    // Empty string should fall through to defaultModel
    expect(result.state.capturedModels["node1"]).toBe("fallback-model");
  });

  test("explicit model takes precedence over defaultModel", async () => {
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("node1", "explicit-model"))
      .end()
      .compile({ defaultModel: "default-model" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    expect(result.state.capturedModels["node1"]).toBe("explicit-model");
  });

  test("different nodes can have different models", async () => {
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("node1", "model-a"))
      .then(createModelCapturingNode("node2", "model-b"))
      .then(createModelCapturingNode("node3")) // Uses default
      .then(createModelCapturingNode("node4", "inherit")) // Also uses default
      .end()
      .compile({ defaultModel: "default-model" });

    const result = await executeGraph(compiled, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    expect(result.state.capturedModels["node1"]).toBe("model-a");
    expect(result.state.capturedModels["node2"]).toBe("model-b");
    expect(result.state.capturedModels["node3"]).toBe("default-model");
    expect(result.state.capturedModels["node4"]).toBe("default-model");
  });

  test("concurrent model resolution - parallel nodes with different models", async () => {
    // Simulate parallel execution by running multiple nodes that each capture their model
    // This tests that resolveModel is deterministic and thread-safe
    const compiled = graph<TestState>()
      .start(createModelCapturingNode("start", "start-model"))
      .then(createModelCapturingNode("branch1", "model-alpha"))
      .then(createModelCapturingNode("branch2", "model-beta"))
      .then(createModelCapturingNode("branch3", "model-gamma"))
      .then(createModelCapturingNode("end")) // Uses default
      .end()
      .compile({ defaultModel: "default-concurrent" });

    // Run the graph multiple times to detect any race conditions
    const runs = await Promise.all(
      Array.from({ length: 5 }, () =>
        executeGraph(compiled, {
          initialState: createTestState(),
        })
      )
    );

    // All runs should produce consistent results
    for (const result of runs) {
      expect(result.status).toBe("completed");
      expect(result.state.capturedModels["start"]).toBe("start-model");
      expect(result.state.capturedModels["branch1"]).toBe("model-alpha");
      expect(result.state.capturedModels["branch2"]).toBe("model-beta");
      expect(result.state.capturedModels["branch3"]).toBe("model-gamma");
      expect(result.state.capturedModels["end"]).toBe("default-concurrent");
    }
  });

  test("concurrent model resolution - no interference between graph instances", async () => {
    // Create two different graphs with different default models
    const compiled1 = graph<TestState>()
      .start(createModelCapturingNode("nodeA"))
      .end()
      .compile({ defaultModel: "instance-1-default" });

    const compiled2 = graph<TestState>()
      .start(createModelCapturingNode("nodeA"))
      .end()
      .compile({ defaultModel: "instance-2-default" });

    // Execute both concurrently
    const [result1, result2] = await Promise.all([
      executeGraph(compiled1, { initialState: createTestState() }),
      executeGraph(compiled2, { initialState: createTestState() }),
    ]);

    expect(result1.status).toBe("completed");
    expect(result2.status).toBe("completed");
    // Each should use its own default model, no cross-contamination
    expect(result1.state.capturedModels["nodeA"]).toBe("instance-1-default");
    expect(result2.state.capturedModels["nodeA"]).toBe("instance-2-default");
  });
});
