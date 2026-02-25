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
  type SubAgentConfig,
  type ToolBuilderConfig,
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

// ============================================================================
// GRAPH BUILDER: .subagent() METHOD
// ============================================================================

describe("GraphBuilder - .subagent() method", () => {
  test("creates a node with type 'agent' and correct ID", () => {
    const builder = graph<TestState>().subagent({
      id: "analyze-code",
      agent: "codebase-analyzer",
      task: "Analyze the codebase",
    });

    const compiled = builder.compile();

    expect(compiled.nodes.has("analyze-code")).toBe(true);
    const node = compiled.nodes.get("analyze-code");
    expect(node?.type).toBe("agent");
    expect(node?.id).toBe("analyze-code");
  });

  test("maps config.agent to agentName correctly", () => {
    const builder = graph<TestState>().subagent({
      id: "my-subagent",
      agent: "codebase-analyzer",
      task: "Do something",
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("my-subagent");

    // The node should exist with type "agent"
    expect(node?.type).toBe("agent");
    
    // We can verify the agent name is used in the description
    expect(node?.description).toContain("codebase-analyzer");
  });

  test("first .subagent() call auto-sets as start node (no .start() needed)", () => {
    const builder = graph<TestState>().subagent({
      id: "first-agent",
      agent: "codebase-analyzer",
      task: "First task",
    });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("first-agent");
  });

  test("chaining: .subagent().subagent() creates two nodes with an edge", () => {
    const builder = graph<TestState>()
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "First task",
      })
      .subagent({
        id: "agent2",
        agent: "codebase-locator",
        task: "Second task",
      });

    const compiled = builder.compile();

    // Both nodes should exist
    expect(compiled.nodes.has("agent1")).toBe(true);
    expect(compiled.nodes.has("agent2")).toBe(true);

    // Should have an edge from agent1 to agent2
    const edge = compiled.edges.find((e) => e.from === "agent1" && e.to === "agent2");
    expect(edge).toBeDefined();
  });

  test("config fields (name, description, retry) are passed through", () => {
    const builder = graph<TestState>().subagent({
      id: "my-agent",
      agent: "codebase-analyzer",
      task: "Analyze code",
      name: "Code Analyzer",
      description: "Analyzes the codebase structure",
      retry: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 },
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("my-agent");

    expect(node?.name).toBe("Code Analyzer");
    expect(node?.description).toBe("Analyzes the codebase structure");
    expect(node?.retry?.maxAttempts).toBe(3);
    expect(node?.retry?.backoffMs).toBe(1000);
  });

  test("task can be a function that resolves from state", () => {
    const builder = graph<TestState>().subagent({
      id: "dynamic-agent",
      agent: "codebase-analyzer",
      task: (state) => `Analyze ${state.message}`,
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("dynamic-agent");

    expect(node).toBeDefined();
    expect(node?.type).toBe("agent");
  });

  test("systemPrompt can be provided as string", () => {
    const builder = graph<TestState>().subagent({
      id: "custom-agent",
      agent: "codebase-analyzer",
      task: "Analyze",
      systemPrompt: "Custom system prompt",
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("custom-agent");

    expect(node).toBeDefined();
  });

  test("model and tools can be specified", () => {
    const builder = graph<TestState>().subagent({
      id: "restricted-agent",
      agent: "codebase-analyzer",
      task: "Analyze",
      model: "claude-opus-4",
      tools: ["bash", "view"],
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("restricted-agent");

    expect(node).toBeDefined();
    expect(node?.type).toBe("agent");
  });

  test("outputMapper can be provided", () => {
    const builder = graph<TestState>().subagent({
      id: "mapped-agent",
      agent: "codebase-analyzer",
      task: "Analyze",
      outputMapper: (result, state) => ({ message: result.output }),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("mapped-agent");

    expect(node).toBeDefined();
  });
});

// ============================================================================
// GRAPH BUILDER: .tool() METHOD
// ============================================================================

describe("GraphBuilder - .tool() method", () => {
  test("creates a node with type 'tool' and correct ID", () => {
    const builder = graph<TestState>().tool({
      id: "fetch-data",
      execute: async () => ({ data: "result" }),
    });

    const compiled = builder.compile();

    expect(compiled.nodes.has("fetch-data")).toBe(true);
    const node = compiled.nodes.get("fetch-data");
    expect(node?.type).toBe("tool");
    expect(node?.id).toBe("fetch-data");
  });

  test("defaults toolName to config.id when not specified", () => {
    const builder = graph<TestState>().tool({
      id: "my-tool",
      execute: async () => ({}),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("my-tool");

    expect(node).toBeDefined();
    expect(node?.type).toBe("tool");
    // The toolName should default to the id
    expect(node?.name).toBe("my-tool");
  });

  test("uses explicit toolName when provided", () => {
    const builder = graph<TestState>().tool({
      id: "fetch-tool",
      toolName: "http_fetch",
      execute: async () => ({}),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("fetch-tool");

    expect(node).toBeDefined();
    expect(node?.name).toBe("http_fetch");
  });

  test("first .tool() call auto-sets as start node", () => {
    const builder = graph<TestState>().tool({
      id: "first-tool",
      execute: async () => ({}),
    });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("first-tool");
  });

  test("chaining: .tool().tool() creates two nodes with an edge", () => {
    const builder = graph<TestState>()
      .tool({
        id: "tool1",
        execute: async () => ({ result: 1 }),
      })
      .tool({
        id: "tool2",
        execute: async () => ({ result: 2 }),
      });

    const compiled = builder.compile();

    // Both nodes should exist
    expect(compiled.nodes.has("tool1")).toBe(true);
    expect(compiled.nodes.has("tool2")).toBe(true);

    // Should have an edge from tool1 to tool2
    const edge = compiled.edges.find((e) => e.from === "tool1" && e.to === "tool2");
    expect(edge).toBeDefined();
  });

  test("execute function is passed through correctly", () => {
    const executeFn = async () => ({ data: "test" });
    
    const builder = graph<TestState>().tool({
      id: "exec-tool",
      execute: executeFn,
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("exec-tool");

    expect(node).toBeDefined();
    expect(node?.execute).toBeTypeOf("function");
  });

  test("config fields (name, description, retry, timeout) are passed through", () => {
    const builder = graph<TestState>().tool({
      id: "my-tool",
      execute: async () => ({}),
      name: "Data Fetcher",
      description: "Fetches data from API",
      retry: { maxAttempts: 5, backoffMs: 500, backoffMultiplier: 2 },
      timeout: 30000,
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("my-tool");

    expect(node?.name).toBe("Data Fetcher");
    expect(node?.description).toBe("Fetches data from API");
    expect(node?.retry?.maxAttempts).toBe(5);
    expect(node?.retry?.backoffMs).toBe(500);
  });

  test("args can be a static object", () => {
    const builder = graph<TestState>().tool({
      id: "static-args-tool",
      execute: async (args: { url: string }) => ({ data: args.url }),
      args: { url: "https://example.com" },
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("static-args-tool");

    expect(node).toBeDefined();
  });

  test("args can be a function that resolves from state", () => {
    const builder = graph<TestState>().tool({
      id: "dynamic-args-tool",
      execute: async (args: { message: string }) => ({ result: args.message }),
      args: (state) => ({ message: state.message }),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("dynamic-args-tool");

    expect(node).toBeDefined();
  });

  test("outputMapper can be provided", () => {
    const builder = graph<TestState>().tool({
      id: "mapped-tool",
      execute: async () => ({ value: 42 }),
      outputMapper: (result, state) => ({ count: result.value }),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("mapped-tool");

    expect(node).toBeDefined();
  });
});

// ============================================================================
// GRAPH BUILDER: MIXED CHAINING
// ============================================================================

describe("GraphBuilder - mixed chaining", () => {
  test(".subagent().tool().subagent() creates correct 3-node chain", () => {
    const builder = graph<TestState>()
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Analyze",
      })
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .subagent({
        id: "agent2",
        agent: "codebase-locator",
        task: "Locate",
      });

    const compiled = builder.compile();

    // All three nodes should exist
    expect(compiled.nodes.has("agent1")).toBe(true);
    expect(compiled.nodes.has("tool1")).toBe(true);
    expect(compiled.nodes.has("agent2")).toBe(true);

    // Check edges: agent1 -> tool1 -> agent2
    const edge1 = compiled.edges.find((e) => e.from === "agent1" && e.to === "tool1");
    const edge2 = compiled.edges.find((e) => e.from === "tool1" && e.to === "agent2");

    expect(edge1).toBeDefined();
    expect(edge2).toBeDefined();

    // Start node should be agent1
    expect(compiled.startNode).toBe("agent1");
  });

  test(".tool().subagent().tool() creates correct 3-node chain", () => {
    const builder = graph<TestState>()
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Analyze",
      })
      .tool({
        id: "tool2",
        execute: async () => ({}),
      });

    const compiled = builder.compile();

    // All three nodes should exist
    expect(compiled.nodes.has("tool1")).toBe(true);
    expect(compiled.nodes.has("agent1")).toBe(true);
    expect(compiled.nodes.has("tool2")).toBe(true);

    // Check edges: tool1 -> agent1 -> tool2
    const edge1 = compiled.edges.find((e) => e.from === "tool1" && e.to === "agent1");
    const edge2 = compiled.edges.find((e) => e.from === "agent1" && e.to === "tool2");

    expect(edge1).toBeDefined();
    expect(edge2).toBeDefined();

    // Start node should be tool1
    expect(compiled.startNode).toBe("tool1");
  });

  test(".subagent().if(condition).then(node).endif().tool() works with conditionals", () => {
    const builder = graph<TestState>()
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Analyze",
      })
      .if((state) => state.flag)
        .then(testNode2)
      .endif()
      .tool({
        id: "tool1",
        execute: async () => ({}),
      });

    const compiled = builder.compile();

    // All nodes should exist
    expect(compiled.nodes.has("agent1")).toBe(true);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("tool1")).toBe(true);

    // Should have decision and merge nodes
    const nodeIds = Array.from(compiled.nodes.keys());
    const decisionNode = nodeIds.find((id) => id.startsWith("decision_"));
    const mergeNode = nodeIds.find((id) => id.startsWith("merge_"));

    expect(decisionNode).toBeDefined();
    expect(mergeNode).toBeDefined();

    // tool1 should be connected after the merge node
    const edgeToTool = compiled.edges.find((e) => e.from === mergeNode && e.to === "tool1");
    expect(edgeToTool).toBeDefined();
  });

  test(".tool().if({ condition, then, else }).subagent() works with config-based conditionals", () => {
    const builder = graph<TestState>()
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .if({
        condition: (state) => state.flag,
        then: [testNode2],
        else: [testNode3],
      })
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Analyze",
      });

    const compiled = builder.compile();

    // All nodes should exist
    expect(compiled.nodes.has("tool1")).toBe(true);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    expect(compiled.nodes.has("agent1")).toBe(true);

    // agent1 should be connected after the conditional merge
    const nodeIds = Array.from(compiled.nodes.keys());
    const mergeNode = nodeIds.find((id) => id.startsWith("merge_"));
    expect(mergeNode).toBeDefined();

    const edgeToAgent = compiled.edges.find((e) => e.from === mergeNode && e.to === "agent1");
    expect(edgeToAgent).toBeDefined();
  });
});

// ============================================================================
// GRAPH BUILDER: AUTO ENTRY-POINT DETECTION
// ============================================================================

describe("GraphBuilder - auto entry-point detection", () => {
  test("starting with .subagent() (no .start()) sets it as the start node", () => {
    const builder = graph<TestState>().subagent({
      id: "entry-agent",
      agent: "codebase-analyzer",
      task: "Start here",
    });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("entry-agent");
  });

  test("starting with .tool() (no .start()) sets it as the start node", () => {
    const builder = graph<TestState>().tool({
      id: "entry-tool",
      execute: async () => ({}),
    });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("entry-tool");
  });

  test("explicit .start() takes precedence over auto-detection", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Not the start",
      });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("test1");
  });

  test("chaining after .subagent() does not change start node", () => {
    const builder = graph<TestState>()
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "First",
      })
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .subagent({
        id: "agent2",
        agent: "codebase-locator",
        task: "Second",
      });

    const compiled = builder.compile();

    // Start node should still be the first one (agent1)
    expect(compiled.startNode).toBe("agent1");
  });

  test("chaining after .tool() does not change start node", () => {
    const builder = graph<TestState>()
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Second",
      })
      .tool({
        id: "tool2",
        execute: async () => ({}),
      });

    const compiled = builder.compile();

    // Start node should still be the first one (tool1)
    expect(compiled.startNode).toBe("tool1");
  });
});
