/**
 * Tests for GraphBuilder and graph construction
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  GraphBuilder,
  graph,
  createNode,
  createDecisionNode,
  createWaitNode,
  type LoopConfig,
  type ParallelConfig,
  type IfConfig,
} from "./builder.ts";
import type { BaseState, NodeDefinition } from "./types.ts";

// ============================================================================
// TEST STATE INTERFACE
// ============================================================================

interface TestState extends BaseState {
  count: number;
  flag: boolean;
  message: string;
}

const testStateSchema: z.ZodType<TestState> = z.object({
  executionId: z.string(),
  lastUpdated: z.string(),
  outputs: z.record(z.string(), z.unknown()),
  count: z.number(),
  flag: z.boolean(),
  message: z.string(),
});

// ============================================================================
// TEST HELPER NODES
// ============================================================================

const testNode1: NodeDefinition<TestState> = {
  id: "test1",
  type: "tool",
  execute: async () => ({ stateUpdate: { count: 1 } }),
};

const testNode2: NodeDefinition<TestState> = {
  id: "test2",
  type: "tool",
  execute: async () => ({ stateUpdate: { count: 2 } }),
};

const testNode3: NodeDefinition<TestState> = {
  id: "test3",
  type: "tool",
  execute: async () => ({ stateUpdate: { count: 3 } }),
};

// ============================================================================
// GRAPH BUILDER: BASIC CONSTRUCTION
// ============================================================================

describe("GraphBuilder - basic construction", () => {
  test("creates an empty builder via factory function", () => {
    const builder = graph<TestState>();
    expect(builder).toBeInstanceOf(GraphBuilder);
  });

  test("starts a graph with a single node", () => {
    const builder = graph<TestState>().start(testNode1);
    const compiled = builder.compile();

    expect(compiled.startNode).toBe("test1");
    expect(compiled.nodes.size).toBe(1);
    expect(compiled.nodes.get("test1")).toEqual(testNode1);
  });

  test("chains nodes with then()", () => {
    const builder = graph<TestState>().start(testNode1).then(testNode2).then(testNode3);
    const compiled = builder.compile();

    expect(compiled.nodes.size).toBe(3);
    expect(compiled.edges.length).toBe(2);
    expect(compiled.edges[0]).toMatchObject({ from: "test1", to: "test2" });
    expect(compiled.edges[1]).toMatchObject({ from: "test2", to: "test3" });
  });

  test("marks terminal node with end()", () => {
    const builder = graph<TestState>().start(testNode1).then(testNode2).end();
    const compiled = builder.compile();

    expect(compiled.endNodes.has("test2")).toBe(true);
  });

  test("infers end nodes when not explicitly marked", () => {
    const builder = graph<TestState>().start(testNode1).then(testNode2);
    const compiled = builder.compile();

    // test2 has no outgoing edges, so it should be an end node
    expect(compiled.endNodes.has("test2")).toBe(true);
  });

  test("throws error when starting graph twice", () => {
    expect(() => {
      graph<TestState>().start(testNode1).start(testNode2);
    }).toThrow("Start node already set");
  });

  test("throws error when compiling without start node", () => {
    expect(() => {
      graph<TestState>().compile();
    }).toThrow("Cannot compile graph without a start node");
  });

  test("throws error when adding duplicate node ID", () => {
    const builder = graph<TestState>().start(testNode1);
    
    expect(() => {
      builder.then(testNode1); // Same node ID
    }).toThrow('Node with ID "test1" already exists');
  });
});

// ============================================================================
// GRAPH BUILDER: CONDITIONAL BRANCHES
// ============================================================================

describe("GraphBuilder - conditional branches", () => {
  test("creates if/endif branch structure", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .if((state) => state.flag === true)
        .then(testNode2)
      .endif()
      .end();
    
    const compiled = builder.compile();

    // Should have: test1, decision node, test2, merge node
    expect(compiled.nodes.size).toBe(4);
    
    // Find the decision and merge nodes
    const nodeIds = Array.from(compiled.nodes.keys());
    const decisionNode = nodeIds.find(id => id.startsWith("decision_"));
    const mergeNode = nodeIds.find(id => id.startsWith("merge_"));
    
    expect(decisionNode).toBeDefined();
    expect(mergeNode).toBeDefined();
    
    // Check edges: test1 -> decision, decision -> test2, test2 -> merge
    const edgeFromTest1 = compiled.edges.find(e => e.from === "test1");
    expect(edgeFromTest1?.to).toBe(decisionNode);
    
    const edgeToTest2 = compiled.edges.find(e => e.to === "test2");
    expect(edgeToTest2?.from).toBe(decisionNode);
    expect(edgeToTest2?.label).toBe("if-true");
    
    const edgeFromTest2 = compiled.edges.find(e => e.from === "test2");
    expect(edgeFromTest2?.to).toBe(mergeNode);
  });

  test("creates if/else/endif branch structure", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .if((state) => state.flag === true)
        .then(testNode2)
      .else()
        .then(testNode3)
      .endif()
      .end();
    
    const compiled = builder.compile();

    // Should have: test1, decision, test2, test3, merge
    expect(compiled.nodes.size).toBe(5);
    
    // Check that both branch nodes exist
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    
    // Check edges to both branches
    const edgeToTest2 = compiled.edges.find(e => e.to === "test2");
    const edgeToTest3 = compiled.edges.find(e => e.to === "test3");
    
    expect(edgeToTest2?.label).toBe("if-true");
    expect(edgeToTest3?.label).toBe("if-false");
  });

  test("throws error on else() without preceding if()", () => {
    expect(() => {
      graph<TestState>().start(testNode1).else();
    }).toThrow("Cannot use else() without a preceding if()");
  });

  test("throws error on endif() without preceding if()", () => {
    expect(() => {
      graph<TestState>().start(testNode1).endif();
    }).toThrow("Cannot use endif() without a preceding if()");
  });

  test("throws error on if() without preceding node", () => {
    expect(() => {
      graph<TestState>().if((state) => state.flag);
    }).toThrow("Cannot use if() without a preceding node");
  });

  test("throws error on duplicate else()", () => {
    expect(() => {
      graph<TestState>()
        .start(testNode1)
        .if((state) => state.flag)
          .then(testNode2)
        .else()
          .then(testNode3)
        .else(); // Duplicate else
    }).toThrow("Already in else branch");
  });
});

// ============================================================================
// GRAPH BUILDER: CONFIG-BASED CONDITIONAL
// ============================================================================

describe("GraphBuilder - config-based conditional", () => {
  test("creates if config with then and else branches", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .if({
        condition: (state) => state.flag === true,
        then: [testNode2],
        else: [testNode3],
      })
      .end();
    
    const compiled = builder.compile();

    // Should have: test1, decision, test2, test3, merge
    expect(compiled.nodes.size).toBe(5);
    
    // Check that both branch nodes exist
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    
    // Check edges to both branches
    const edgeToTest2 = compiled.edges.find(e => e.to === "test2");
    const edgeToTest3 = compiled.edges.find(e => e.to === "test3");
    
    expect(edgeToTest2?.label).toBe("if-true");
    expect(edgeToTest3?.label).toBe("if-false");
  });

  test("creates if config with only then branch", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .if({
        condition: (state) => state.flag === true,
        then: [testNode2],
      })
      .end();
    
    const compiled = builder.compile();

    // Should have: test1, decision node, test2, merge node
    expect(compiled.nodes.size).toBe(4);
    
    // Find the decision and merge nodes
    const nodeIds = Array.from(compiled.nodes.keys());
    const decisionNode = nodeIds.find(id => id.startsWith("decision_"));
    const mergeNode = nodeIds.find(id => id.startsWith("merge_"));
    
    expect(decisionNode).toBeDefined();
    expect(mergeNode).toBeDefined();
    
    // Check edges
    const edgeToTest2 = compiled.edges.find(e => e.to === "test2");
    expect(edgeToTest2?.from).toBe(decisionNode);
    expect(edgeToTest2?.label).toBe("if-true");
  });

  test("creates if config with else_if branch", () => {
    const testNode4: NodeDefinition<TestState> = {
      id: "test4",
      type: "tool",
      execute: async () => ({ stateUpdate: { count: 4 } }),
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .if({
        condition: (state) => state.count > 10,
        then: [testNode2],
        else_if: [
          {
            condition: (state) => state.count > 5,
            then: [testNode3],
          },
        ],
        else: [testNode4],
      })
      .end();
    
    const compiled = builder.compile();

    // Should have: test1, multiple decision/merge nodes, test2, test3, test4
    expect(compiled.nodes.has("test1")).toBe(true);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    expect(compiled.nodes.has("test4")).toBe(true);
    
    // Check that all branch nodes exist
    const edgeToTest2 = compiled.edges.find(e => e.to === "test2");
    const edgeToTest3 = compiled.edges.find(e => e.to === "test3");
    const edgeToTest4 = compiled.edges.find(e => e.to === "test4");
    
    expect(edgeToTest2).toBeDefined();
    expect(edgeToTest3).toBeDefined();
    expect(edgeToTest4).toBeDefined();
  });

  test("creates if config with multiple else_if branches", () => {
    const testNode4: NodeDefinition<TestState> = {
      id: "test4",
      type: "tool",
      execute: async () => ({ stateUpdate: { count: 4 } }),
    };

    const testNode5: NodeDefinition<TestState> = {
      id: "test5",
      type: "tool",
      execute: async () => ({ stateUpdate: { count: 5 } }),
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .if({
        condition: (state) => state.count > 20,
        then: [testNode2],
        else_if: [
          {
            condition: (state) => state.count > 15,
            then: [testNode3],
          },
          {
            condition: (state) => state.count > 10,
            then: [testNode4],
          },
        ],
        else: [testNode5],
      })
      .end();
    
    const compiled = builder.compile();

    // All branch nodes should exist
    expect(compiled.nodes.has("test1")).toBe(true);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    expect(compiled.nodes.has("test4")).toBe(true);
    expect(compiled.nodes.has("test5")).toBe(true);
    
    // Check that all branches are connected
    expect(compiled.edges.find(e => e.to === "test2")).toBeDefined();
    expect(compiled.edges.find(e => e.to === "test3")).toBeDefined();
    expect(compiled.edges.find(e => e.to === "test4")).toBeDefined();
    expect(compiled.edges.find(e => e.to === "test5")).toBeDefined();
  });

  test("creates if config with multiple nodes per branch", () => {
    const testNode4: NodeDefinition<TestState> = {
      id: "test4",
      type: "tool",
      execute: async () => ({ stateUpdate: { count: 4 } }),
    };

    const testNode5: NodeDefinition<TestState> = {
      id: "test5",
      type: "tool",
      execute: async () => ({ stateUpdate: { count: 5 } }),
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .if({
        condition: (state) => state.flag === true,
        then: [testNode2, testNode3],
        else: [testNode4, testNode5],
      })
      .end();
    
    const compiled = builder.compile();

    // All nodes should exist
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    expect(compiled.nodes.has("test4")).toBe(true);
    expect(compiled.nodes.has("test5")).toBe(true);
    
    // test2 should be followed by test3
    const edgeTest2ToTest3 = compiled.edges.find(e => e.from === "test2" && e.to === "test3");
    expect(edgeTest2ToTest3).toBeDefined();
    
    // test4 should be followed by test5
    const edgeTest4ToTest5 = compiled.edges.find(e => e.from === "test4" && e.to === "test5");
    expect(edgeTest4ToTest5).toBeDefined();
  });

  test("can chain after config-based if", () => {
    const testNode4: NodeDefinition<TestState> = {
      id: "test4",
      type: "tool",
      execute: async () => ({ stateUpdate: { count: 4 } }),
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .if({
        condition: (state) => state.flag === true,
        then: [testNode2],
        else: [testNode3],
      })
      .then(testNode4)
      .end();
    
    const compiled = builder.compile();

    // test4 should be connected after the merge node
    expect(compiled.nodes.has("test4")).toBe(true);
    
    // Find merge node and check it connects to test4
    const nodeIds = Array.from(compiled.nodes.keys());
    const mergeNode = nodeIds.find(id => id.startsWith("merge_"));
    
    expect(mergeNode).toBeDefined();
    const edgeMergeToTest4 = compiled.edges.find(e => e.from === mergeNode && e.to === "test4");
    expect(edgeMergeToTest4).toBeDefined();
  });
});

// ============================================================================
// GRAPH BUILDER: PARALLEL EXECUTION
// ============================================================================

describe("GraphBuilder - parallel execution", () => {
  test("creates parallel execution structure", () => {
    const parallelConfig: ParallelConfig<TestState> = {
      branches: ["test2", "test3"],
      strategy: "all",
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .parallel(parallelConfig);
    
    const compiled = builder.compile();

    // Should have test1 and a parallel node
    expect(compiled.nodes.size).toBeGreaterThanOrEqual(2);
    
    // Find the parallel node
    const parallelNode = Array.from(compiled.nodes.values()).find(n => n.type === "parallel");
    expect(parallelNode).toBeDefined();
    
    // Check edge from test1 to parallel node
    const edgeToParallel = compiled.edges.find(e => e.from === "test1");
    expect(edgeToParallel?.to).toBe(parallelNode?.id);
    
    // Check edges to branches
    const branchEdges = compiled.edges.filter(e => e.from === parallelNode?.id);
    expect(branchEdges.length).toBe(2);
    expect(branchEdges.map(e => e.to)).toContain("test2");
    expect(branchEdges.map(e => e.to)).toContain("test3");
  });

  test("parallel execution can be used as start node", () => {
    const parallelConfig: ParallelConfig<TestState> = {
      branches: ["test1", "test2"],
    };

    const builder = graph<TestState>().parallel(parallelConfig);
    const compiled = builder.compile();
    
    // Parallel node should be the start node
    const parallelNode = Array.from(compiled.nodes.values()).find(n => n.type === "parallel");
    expect(compiled.startNode).toBe(parallelNode!.id);
  });
});

// ============================================================================
// GRAPH BUILDER: LOOP CONSTRUCTS
// ============================================================================

describe("GraphBuilder - loop constructs", () => {
  test("creates loop with single node body", () => {
    const loopConfig: LoopConfig<TestState> = {
      until: (state) => state.count >= 10,
      maxIterations: 5,
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .loop(testNode2, loopConfig);
    
    const compiled = builder.compile();

    // Should have: test1, loop_start, test2, loop_check
    expect(compiled.nodes.size).toBe(4);
    
    // Find loop nodes
    const loopStartNode = Array.from(compiled.nodes.keys()).find(id => id.startsWith("loop_start_"));
    const loopCheckNode = Array.from(compiled.nodes.keys()).find(id => id.startsWith("loop_check_"));
    
    expect(loopStartNode).toBeDefined();
    expect(loopCheckNode).toBeDefined();
    
    // Check loop structure: loop_start -> test2 -> loop_check
    const edgeToBody = compiled.edges.find(e => e.from === loopStartNode);
    expect(edgeToBody?.to).toBe("test2");
    
    const edgeToCheck = compiled.edges.find(e => e.from === "test2");
    expect(edgeToCheck?.to).toBe(loopCheckNode);
    
    // Check loop continuation edge
    const continueEdge = compiled.edges.find(e => 
      e.from === loopCheckNode && e.to === "test2" && e.label === "loop-continue"
    );
    expect(continueEdge).toBeDefined();
    expect(continueEdge?.condition).toBeDefined();
  });

  test("creates loop with multi-node body", () => {
    const loopConfig: LoopConfig<TestState> = {
      until: (state) => state.flag === true,
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .loop([testNode2, testNode3], loopConfig);
    
    const compiled = builder.compile();

    // Should have: test1, loop_start, test2, test3, loop_check
    expect(compiled.nodes.size).toBe(5);
    
    // Check body nodes are chained: test2 -> test3
    const bodyEdge = compiled.edges.find(e => e.from === "test2" && e.to === "test3");
    expect(bodyEdge).toBeDefined();
    
    // Check test3 connects to loop_check
    const loopCheckNode = Array.from(compiled.nodes.keys()).find(id => id.startsWith("loop_check_"));
    const edgeToCheck = compiled.edges.find(e => e.from === "test3");
    expect(edgeToCheck?.to).toBe(loopCheckNode);
  });

  test("throws error on empty loop body", () => {
    const loopConfig: LoopConfig<TestState> = {
      until: (state) => state.flag === true,
    };

    expect(() => {
      graph<TestState>().start(testNode1).loop([], loopConfig);
    }).toThrow("Loop body must contain at least one node");
  });

  test("loop can be used as start node", () => {
    const loopConfig: LoopConfig<TestState> = {
      until: (state) => state.count >= 10,
    };

    const builder = graph<TestState>().loop(testNode1, loopConfig);
    const compiled = builder.compile();
    
    // Loop start node should be the graph start
    const loopStartNode = Array.from(compiled.nodes.keys()).find(id => id.startsWith("loop_start_"));
    expect(compiled.startNode).toBe(loopStartNode!);
  });
});

// ============================================================================
// GRAPH BUILDER: WAIT NODES
// ============================================================================

describe("GraphBuilder - wait nodes", () => {
  test("creates wait node from string prompt", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .wait("Please provide input")
      .end();
    
    const compiled = builder.compile();

    // Should have: test1, wait node
    expect(compiled.nodes.size).toBe(2);
    
    // Find the wait node
    const waitNode = Array.from(compiled.nodes.values()).find(n => 
      n.type === "wait" && n.id.startsWith("wait_")
    );
    expect(waitNode).toBeDefined();
  });

  test("creates wait node from node definition", () => {
    const customWaitNode: NodeDefinition<TestState> = {
      id: "custom_wait",
      type: "wait",
      execute: async () => ({
        signals: [{ type: "human_input_required", message: "Custom wait" }],
      }),
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .wait(customWaitNode)
      .end();
    
    const compiled = builder.compile();

    expect(compiled.nodes.has("custom_wait")).toBe(true);
    expect(compiled.nodes.get("custom_wait")?.type).toBe("wait");
  });
});

// ============================================================================
// GRAPH BUILDER: ERROR HANDLING
// ============================================================================

describe("GraphBuilder - error handling", () => {
  test("registers error handler with catch()", () => {
    const errorHandler: NodeDefinition<TestState> = {
      id: "error_handler",
      type: "tool",
      execute: async () => ({ stateUpdate: { message: "Error handled" } }),
    };

    const builder = graph<TestState>()
      .start(testNode1)
      .then(testNode2)
      .catch(errorHandler)
      .end();
    
    const compiled = builder.compile();

    // Error handler should be in nodes
    expect(compiled.nodes.has("error_handler")).toBe(true);
    
    // Error handler ID should be in metadata
    expect(compiled.config.metadata?.errorHandlerId).toBe("error_handler");
  });
});

// ============================================================================
// GRAPH BUILDER: HELPER FUNCTIONS
// ============================================================================

describe("createNode helper", () => {
  test("creates a basic node definition", () => {
    const node = createNode<TestState>(
      "my_node",
      "tool",
      async () => ({ stateUpdate: { count: 42 } })
    );

    expect(node.id).toBe("my_node");
    expect(node.type).toBe("tool");
    expect(node.execute).toBeTypeOf("function");
  });

  test("creates node with optional fields", () => {
    const node = createNode<TestState>(
      "my_node",
      "agent",
      async () => ({}),
      {
        name: "My Node",
        description: "Test node",
        inputSchema: testStateSchema,
        outputSchema: testStateSchema,
        retry: { maxAttempts: 5, backoffMs: 500, backoffMultiplier: 2 },
        isRecoveryNode: true,
      }
    );

    expect(node.name).toBe("My Node");
    expect(node.description).toBe("Test node");
    expect(node.inputSchema).toBe(testStateSchema);
    expect(node.outputSchema).toBe(testStateSchema);
    expect(node.retry?.maxAttempts).toBe(5);
    expect(node.isRecoveryNode).toBe(true);
  });
});

describe("createDecisionNode helper", () => {
  test("creates decision node with routes", () => {
    const routes = [
      { condition: (state: TestState) => state.count > 10, target: "high" },
      { condition: (state: TestState) => state.count > 5, target: "medium" },
    ];

    const node = createDecisionNode<TestState>("decision", routes, "low");

    expect(node.id).toBe("decision");
    expect(node.type).toBe("decision");
    expect(node.execute).toBeTypeOf("function");
  });

  test("decision node execute returns goto for matching condition", async () => {
    const routes = [
      { condition: (state: TestState) => state.count > 10, target: "high" },
    ];

    const node = createDecisionNode<TestState>("decision", routes, "low");
    
    const state: TestState = {
      executionId: "test",
      lastUpdated: new Date().toISOString(),
      outputs: {},
      count: 15,
      flag: false,
      message: "",
    };

    const result = await node.execute({ state, config: {}, errors: [] });
    expect(result.goto).toBe("high");
  });

  test("decision node execute returns fallback when no condition matches", async () => {
    const routes = [
      { condition: (state: TestState) => state.count > 10, target: "high" },
    ];

    const node = createDecisionNode<TestState>("decision", routes, "low");
    
    const state: TestState = {
      executionId: "test",
      lastUpdated: new Date().toISOString(),
      outputs: {},
      count: 5,
      flag: false,
      message: "",
    };

    const result = await node.execute({ state, config: {}, errors: [] });
    expect(result.goto).toBe("low");
  });
});

describe("createWaitNode helper", () => {
  test("creates wait node with prompt", () => {
    const node = createWaitNode<TestState>("wait1", "Enter your name");

    expect(node.id).toBe("wait1");
    expect(node.type).toBe("wait");
    expect(node.execute).toBeTypeOf("function");
  });

  test("wait node execute returns human_input_required signal", async () => {
    const node = createWaitNode<TestState>("wait1", "Enter your name");
    
    const result = await node.execute({
      state: {
        executionId: "test",
        lastUpdated: new Date().toISOString(),
        outputs: {},
        count: 0,
        flag: false,
        message: "",
      },
      config: {},
      errors: [],
    });

    expect(result.signals).toBeDefined();
    expect(result.signals?.length).toBe(1);
    expect(result.signals?.[0]?.type).toBe("human_input_required");
    expect(result.signals?.[0]?.message).toBe("Enter your name");
  });
});

// ============================================================================
// GRAPH BUILDER: QUERY METHODS
// ============================================================================

describe("GraphBuilder - query methods", () => {
  test("getNode returns node by ID", () => {
    const builder = graph<TestState>().start(testNode1).then(testNode2);
    
    expect(builder.getNode("test1")).toEqual(testNode1);
    expect(builder.getNode("test2")).toEqual(testNode2);
    expect(builder.getNode("nonexistent")).toBeUndefined();
  });

  test("getEdgesFrom returns outgoing edges", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .then(testNode2)
      .then(testNode3);
    
    const edges = builder.getEdgesFrom("test1");
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ from: "test1", to: "test2" });
  });

  test("getEdgesTo returns incoming edges", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .then(testNode2)
      .then(testNode3);
    
    const edges = builder.getEdgesTo("test2");
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ from: "test1", to: "test2" });
  });

  test("getEdgesFrom returns empty array for node with no outgoing edges", () => {
    const builder = graph<TestState>().start(testNode1);
    
    const edges = builder.getEdgesFrom("test1");
    expect(edges).toEqual([]);
  });

  test("getEdgesTo returns empty array for start node", () => {
    const builder = graph<TestState>().start(testNode1).then(testNode2);
    
    const edges = builder.getEdgesTo("test1");
    expect(edges).toEqual([]);
  });
});
