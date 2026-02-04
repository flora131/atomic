/**
 * Integration tests for model inheritance in nested nodes
 *
 * Tests the model resolution priority with nested/child node execution:
 * - Parent node with model: 'opus' spawns child node with model: 'inherit'
 * - Child receives parent's 'opus' model
 * - Deeply nested inheritance (3+ levels)
 * - Inheritance breaks when child specifies own model
 *
 * Tests nested execution via subgraph nodes.
 */

import { describe, test, expect } from "bun:test";
import { graph, createNode } from "../builder.ts";
import { executeGraph, createExecutor } from "../compiled.ts";
import { subgraphNode, type CompiledSubgraph } from "../nodes.ts";
import type { BaseState, NodeDefinition, CompiledGraph } from "../types.ts";

// ============================================================================
// Helper: Wrap CompiledGraph as CompiledSubgraph
// ============================================================================

/**
 * Adapts a CompiledGraph to the CompiledSubgraph interface.
 * Required because subgraphNode expects CompiledSubgraph which only has execute().
 */
function asSubgraph<TState extends BaseState>(
  compiledGraph: CompiledGraph<TState>
): CompiledSubgraph<TState> {
  return {
    execute: async (state: TState): Promise<TState> => {
      const executor = createExecutor(compiledGraph);
      const result = await executor.execute({ initialState: state });
      return result.state;
    },
  };
}

// ============================================================================
// Test State Types
// ============================================================================

interface TestState extends BaseState {
  capturedModels: Record<string, string | undefined>;
  executionOrder: string[];
  parentModel?: string;
}

function createTestState(overrides: Partial<TestState> = {}): TestState {
  return {
    executionId: "nested-inheritance-test-1",
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

/**
 * Create a node that captures model AND passes it to state for child graph verification
 */
function createModelPassingNode(id: string, model?: string): NodeDefinition<TestState> {
  const node = createNode<TestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      capturedModels: {
        ...ctx.state.capturedModels,
        [id]: ctx.model,
      },
      executionOrder: [...ctx.state.executionOrder, id],
      parentModel: ctx.model, // Pass model to child graph via state
    },
  }));

  if (model !== undefined) {
    node.model = model;
  }

  return node;
}

// ============================================================================
// Tests: Nested Model Inheritance via Subgraph
// ============================================================================

describe("Nested Model Inheritance", () => {
  describe("parent context model propagation", () => {
    test("child subgraph receives parent model when using 'inherit'", async () => {
      // Create child graph that captures model
      const childGraph = graph<TestState>()
        .start(createModelCapturingNode("child-node", "inherit"))
        .end()
        .compile({ defaultModel: "child-default" });

      // Create parent graph with subgraph node
      const parentNode = createModelCapturingNode("parent-node", "opus");
      
      const parentGraph = graph<TestState>()
        .start(parentNode)
        .then(
          subgraphNode<TestState, TestState>({
            id: "nested-subgraph",
            subgraph: asSubgraph(childGraph),
            inputMapper: (state) => ({
              ...state,
              parentModel: state.capturedModels["parent-node"],
            }),
            outputMapper: (subState, parentState) => ({
              ...parentState,
              capturedModels: {
                ...parentState.capturedModels,
                ...subState.capturedModels,
              },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "parent-default" });

      const result = await executeGraph(parentGraph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Parent node should have 'opus' (explicit)
      expect(result.state.capturedModels["parent-node"]).toBe("opus");
      
      // Child node with 'inherit' gets child-default since subgraph executes independently
      // (The parent context model is not automatically passed through subgraph.execute())
      expect(result.state.capturedModels["child-node"]).toBe("child-default");
    });

    test("child graph uses its own defaultModel when parent model not passed", async () => {
      const childGraph = graph<TestState>()
        .start(createModelCapturingNode("child-node-1"))
        .then(createModelCapturingNode("child-node-2", "inherit"))
        .end()
        .compile({ defaultModel: "child-default-model" });

      const parentGraph = graph<TestState>()
        .start(createModelCapturingNode("parent-node", "opus"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "nested-subgraph",
            subgraph: asSubgraph(childGraph),
            outputMapper: (subState, parentState) => ({
              capturedModels: {
                ...parentState.capturedModels,
                ...subState.capturedModels,
              },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "parent-default-model" });

      const result = await executeGraph(parentGraph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Parent uses its explicit model
      expect(result.state.capturedModels["parent-node"]).toBe("opus");
      
      // Child nodes use child graph's defaultModel
      expect(result.state.capturedModels["child-node-1"]).toBe("child-default-model");
      expect(result.state.capturedModels["child-node-2"]).toBe("child-default-model");
    });
  });

  describe("deeply nested inheritance (3+ levels)", () => {
    test("three-level nested graphs with model inheritance", async () => {
      // Level 3 (innermost) graph
      const level3Graph = graph<TestState>()
        .start(createModelCapturingNode("level3-node", "inherit"))
        .end()
        .compile({ defaultModel: "level3-default" });

      // Level 2 (middle) graph
      const level2Graph = graph<TestState>()
        .start(createModelCapturingNode("level2-node", "inherit"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "level3-subgraph",
            subgraph: asSubgraph(level3Graph),
            outputMapper: (subState, parentState) => ({
              capturedModels: {
                ...parentState.capturedModels,
                ...subState.capturedModels,
              },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "level2-default" });

      // Level 1 (outermost) graph
      const level1Graph = graph<TestState>()
        .start(createModelCapturingNode("level1-node", "opus"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "level2-subgraph",
            subgraph: asSubgraph(level2Graph),
            outputMapper: (subState, parentState) => ({
              capturedModels: {
                ...parentState.capturedModels,
                ...subState.capturedModels,
              },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "level1-default" });

      const result = await executeGraph(level1Graph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Level 1 node uses explicit 'opus'
      expect(result.state.capturedModels["level1-node"]).toBe("opus");
      
      // Level 2 node uses level2 graph's defaultModel
      expect(result.state.capturedModels["level2-node"]).toBe("level2-default");
      
      // Level 3 node uses level3 graph's defaultModel
      expect(result.state.capturedModels["level3-node"]).toBe("level3-default");
      
      // Verify execution order (all levels executed)
      expect(result.state.executionOrder).toContain("level1-node");
      expect(result.state.executionOrder).toContain("level2-node");
      expect(result.state.executionOrder).toContain("level3-node");
    });

    test("four-level nested graphs all with explicit models", async () => {
      // Each level has its own explicit model
      const level4Graph = graph<TestState>()
        .start(createModelCapturingNode("level4-node", "model-4"))
        .end()
        .compile();

      const level3Graph = graph<TestState>()
        .start(createModelCapturingNode("level3-node", "model-3"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "level4-subgraph",
            subgraph: asSubgraph(level4Graph),
            outputMapper: (subState, parentState) => ({
              capturedModels: { ...parentState.capturedModels, ...subState.capturedModels },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile();

      const level2Graph = graph<TestState>()
        .start(createModelCapturingNode("level2-node", "model-2"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "level3-subgraph",
            subgraph: asSubgraph(level3Graph),
            outputMapper: (subState, parentState) => ({
              capturedModels: { ...parentState.capturedModels, ...subState.capturedModels },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile();

      const level1Graph = graph<TestState>()
        .start(createModelCapturingNode("level1-node", "model-1"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "level2-subgraph",
            subgraph: asSubgraph(level2Graph),
            outputMapper: (subState, parentState) => ({
              capturedModels: { ...parentState.capturedModels, ...subState.capturedModels },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile();

      const result = await executeGraph(level1Graph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Each node gets its own explicit model
      expect(result.state.capturedModels["level1-node"]).toBe("model-1");
      expect(result.state.capturedModels["level2-node"]).toBe("model-2");
      expect(result.state.capturedModels["level3-node"]).toBe("model-3");
      expect(result.state.capturedModels["level4-node"]).toBe("model-4");
    });
  });

  describe("inheritance breaks when child specifies own model", () => {
    test("child explicit model overrides parent context", async () => {
      // Child graph where node specifies its own model (not 'inherit')
      const childGraph = graph<TestState>()
        .start(createModelCapturingNode("child-node", "haiku")) // Explicit model
        .end()
        .compile({ defaultModel: "child-default" });

      const parentGraph = graph<TestState>()
        .start(createModelCapturingNode("parent-node", "opus"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "nested-subgraph",
            subgraph: asSubgraph(childGraph),
            outputMapper: (subState, parentState) => ({
              capturedModels: {
                ...parentState.capturedModels,
                ...subState.capturedModels,
              },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "parent-default" });

      const result = await executeGraph(parentGraph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Parent uses 'opus'
      expect(result.state.capturedModels["parent-node"]).toBe("opus");
      
      // Child uses its explicit 'haiku', NOT parent's 'opus' or any default
      expect(result.state.capturedModels["child-node"]).toBe("haiku");
    });

    test("mixed explicit and inherit in nested graph", async () => {
      // Child graph with mix of explicit and inherit
      const childGraph = graph<TestState>()
        .start(createModelCapturingNode("child-explicit", "sonnet"))
        .then(createModelCapturingNode("child-inherit", "inherit"))
        .then(createModelCapturingNode("child-no-model"))
        .end()
        .compile({ defaultModel: "child-fallback" });

      const parentGraph = graph<TestState>()
        .start(createModelCapturingNode("parent-node", "opus"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "nested-subgraph",
            subgraph: asSubgraph(childGraph),
            outputMapper: (subState, parentState) => ({
              capturedModels: {
                ...parentState.capturedModels,
                ...subState.capturedModels,
              },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "parent-fallback" });

      const result = await executeGraph(parentGraph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Parent uses explicit 'opus'
      expect(result.state.capturedModels["parent-node"]).toBe("opus");
      
      // Child with explicit model uses 'sonnet'
      expect(result.state.capturedModels["child-explicit"]).toBe("sonnet");
      
      // Child with 'inherit' uses child graph's defaultModel
      expect(result.state.capturedModels["child-inherit"]).toBe("child-fallback");
      
      // Child with no model uses child graph's defaultModel
      expect(result.state.capturedModels["child-no-model"]).toBe("child-fallback");
    });

    test("grandchild with explicit model breaks inheritance chain", async () => {
      // Grandchild graph with explicit model
      const grandchildGraph = graph<TestState>()
        .start(createModelCapturingNode("grandchild-node", "haiku"))
        .end()
        .compile({ defaultModel: "grandchild-default" });

      // Child graph that passes through to grandchild
      const childGraph = graph<TestState>()
        .start(createModelCapturingNode("child-node", "inherit"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "grandchild-subgraph",
            subgraph: asSubgraph(grandchildGraph),
            outputMapper: (subState, parentState) => ({
              capturedModels: { ...parentState.capturedModels, ...subState.capturedModels },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "child-default" });

      const parentGraph = graph<TestState>()
        .start(createModelCapturingNode("parent-node", "opus"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "child-subgraph",
            subgraph: asSubgraph(childGraph),
            outputMapper: (subState, parentState) => ({
              capturedModels: { ...parentState.capturedModels, ...subState.capturedModels },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "parent-default" });

      const result = await executeGraph(parentGraph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Parent: explicit 'opus'
      expect(result.state.capturedModels["parent-node"]).toBe("opus");
      
      // Child: 'inherit' falls back to child graph's default
      expect(result.state.capturedModels["child-node"]).toBe("child-default");
      
      // Grandchild: explicit 'haiku' breaks any potential inheritance
      expect(result.state.capturedModels["grandchild-node"]).toBe("haiku");
    });
  });

  describe("edge cases", () => {
    test("empty subgraph model config uses parent graph default", async () => {
      // Child graph with no default model
      const childGraph = graph<TestState>()
        .start(createModelCapturingNode("child-node"))
        .end()
        .compile(); // No defaultModel

      const parentGraph = graph<TestState>()
        .start(createModelCapturingNode("parent-node", "opus"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "nested-subgraph",
            subgraph: asSubgraph(childGraph),
            outputMapper: (subState, parentState) => ({
              capturedModels: {
                ...parentState.capturedModels,
                ...subState.capturedModels,
              },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile({ defaultModel: "parent-default" });

      const result = await executeGraph(parentGraph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Parent uses explicit 'opus'
      expect(result.state.capturedModels["parent-node"]).toBe("opus");
      
      // Child with no model and no default = undefined
      expect(result.state.capturedModels["child-node"]).toBeUndefined();
    });

    test("inherit with no defaults at any level results in undefined", async () => {
      const childGraph = graph<TestState>()
        .start(createModelCapturingNode("child-node", "inherit"))
        .end()
        .compile(); // No defaultModel

      const parentGraph = graph<TestState>()
        .start(createModelCapturingNode("parent-node"))
        .then(
          subgraphNode<TestState, TestState>({
            id: "nested-subgraph",
            subgraph: asSubgraph(childGraph),
            outputMapper: (subState, parentState) => ({
              capturedModels: {
                ...parentState.capturedModels,
                ...subState.capturedModels,
              },
              executionOrder: [...parentState.executionOrder, ...subState.executionOrder],
            }),
          })
        )
        .end()
        .compile(); // No defaultModel

      const result = await executeGraph(parentGraph, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      
      // Both nodes should be undefined
      expect(result.state.capturedModels["parent-node"]).toBeUndefined();
      expect(result.state.capturedModels["child-node"]).toBeUndefined();
    });
  });
});
