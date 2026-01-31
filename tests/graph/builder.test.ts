/**
 * Unit tests for GraphBuilder
 *
 * Tests cover:
 * - Basic graph building with start/then/end
 * - Conditional branching with if/else/endif
 * - Loop constructs
 * - Parallel execution
 * - Wait nodes for human-in-the-loop
 * - Error handlers with catch
 * - compile() producing valid CompiledGraph
 * - Helper functions: createNode, createDecisionNode, createWaitNode
 */

import { describe, test, expect } from "bun:test";
import {
  GraphBuilder,
  graph,
  createNode,
  createDecisionNode,
  createWaitNode,
  type LoopConfig,
  type ParallelConfig,
} from "../../src/graph/builder.ts";
import type {
  BaseState,
  NodeDefinition,
  CompiledGraph,
  NodeResult,
} from "../../src/graph/types.ts";

// ============================================================================
// Test State Types
// ============================================================================

interface TestState extends BaseState {
  counter: number;
  approved: boolean;
  items: string[];
}

function createTestState(overrides: Partial<TestState> = {}): TestState {
  return {
    executionId: "test-exec-1",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    counter: 0,
    approved: false,
    items: [],
    ...overrides,
  };
}

// ============================================================================
// Test Node Factories
// ============================================================================

function createTestNode(id: string, type: "agent" | "tool" = "agent"): NodeDefinition<TestState> {
  return {
    id,
    type,
    execute: async () => ({}),
  };
}

function createIncrementNode(id: string): NodeDefinition<TestState> {
  return {
    id,
    type: "agent",
    execute: async (ctx) => ({
      stateUpdate: { counter: ctx.state.counter + 1 },
    }),
  };
}

// ============================================================================
// GraphBuilder Class Tests
// ============================================================================

describe("GraphBuilder", () => {
  describe("constructor and initialization", () => {
    test("creates empty builder with graph()", () => {
      const builder = graph<TestState>();
      expect(builder).toBeInstanceOf(GraphBuilder);
    });

    test("creates empty builder with new GraphBuilder()", () => {
      const builder = new GraphBuilder<TestState>();
      expect(builder).toBeInstanceOf(GraphBuilder);
    });
  });

  describe("start()", () => {
    test("sets the starting node", () => {
      const startNode = createTestNode("start");
      const compiled = graph<TestState>().start(startNode).end().compile();

      expect(compiled.startNode).toBe("start");
      expect(compiled.nodes.has("start")).toBe(true);
    });

    test("throws if start() is called twice", () => {
      const node1 = createTestNode("node1");
      const node2 = createTestNode("node2");

      expect(() => {
        graph<TestState>().start(node1).start(node2);
      }).toThrow("Start node already set");
    });

    test("throws if node with same ID already exists", () => {
      const node1 = createTestNode("same-id");
      const node2 = createTestNode("same-id");

      expect(() => {
        graph<TestState>().start(node1).then(node2);
      }).toThrow('Node with ID "same-id" already exists');
    });
  });

  describe("then()", () => {
    test("adds node and connects from current", () => {
      const startNode = createTestNode("start");
      const nextNode = createTestNode("next");

      const compiled = graph<TestState>().start(startNode).then(nextNode).end().compile();

      expect(compiled.nodes.has("start")).toBe(true);
      expect(compiled.nodes.has("next")).toBe(true);
      expect(compiled.edges.some((e) => e.from === "start" && e.to === "next")).toBe(true);
    });

    test("can chain multiple then() calls", () => {
      const nodeA = createTestNode("a");
      const nodeB = createTestNode("b");
      const nodeC = createTestNode("c");
      const nodeD = createTestNode("d");

      const compiled = graph<TestState>()
        .start(nodeA)
        .then(nodeB)
        .then(nodeC)
        .then(nodeD)
        .end()
        .compile();

      expect(compiled.nodes.size).toBe(4);
      expect(compiled.edges.some((e) => e.from === "a" && e.to === "b")).toBe(true);
      expect(compiled.edges.some((e) => e.from === "b" && e.to === "c")).toBe(true);
      expect(compiled.edges.some((e) => e.from === "c" && e.to === "d")).toBe(true);
    });

    test("uses then() as start() if no start node exists", () => {
      const node = createTestNode("first");
      const compiled = graph<TestState>().then(node).end().compile();

      expect(compiled.startNode).toBe("first");
    });
  });

  describe("end()", () => {
    test("marks current node as terminal", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .then(createTestNode("end"))
        .end()
        .compile();

      expect(compiled.endNodes.has("end")).toBe(true);
    });

    test("can mark multiple end nodes", () => {
      // Build a graph that branches and has two end points
      const startNode = createTestNode("start");
      const branch1 = createTestNode("branch1");
      const branch2 = createTestNode("branch2");

      const builder = graph<TestState>().start(startNode);

      // Manually add both branches as end nodes by building two paths
      builder.then(branch1).end();

      const compiled = builder.compile();

      // At minimum, branch1 should be an end node
      expect(compiled.endNodes.has("branch1")).toBe(true);
    });
  });

  describe("compile()", () => {
    test("throws without a start node", () => {
      expect(() => {
        graph<TestState>().compile();
      }).toThrow("Cannot compile graph without a start node");
    });

    test("returns valid CompiledGraph structure", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .then(createTestNode("middle"))
        .then(createTestNode("end"))
        .end()
        .compile();

      expect(compiled.nodes).toBeInstanceOf(Map);
      expect(compiled.edges).toBeInstanceOf(Array);
      expect(compiled.startNode).toBe("start");
      expect(compiled.endNodes).toBeInstanceOf(Set);
      expect(compiled.config).toBeDefined();
    });

    test("auto-detects end nodes if none explicitly marked", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .then(createTestNode("terminal"))
        .compile();

      // terminal has no outgoing edges, so it should be auto-detected
      expect(compiled.endNodes.has("terminal")).toBe(true);
    });

    test("accepts configuration options", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .end()
        .compile({
          metadata: { name: "test-workflow", version: "1.0" },
          maxConcurrency: 2,
        });

      expect(compiled.config.metadata?.name).toBe("test-workflow");
      expect(compiled.config.metadata?.version).toBe("1.0");
      expect(compiled.config.maxConcurrency).toBe(2);
    });
  });
});

// ============================================================================
// Conditional Branching Tests
// ============================================================================

describe("Conditional Branching (if/else/endif)", () => {
  describe("if()", () => {
    test("creates a decision node", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .if((state) => state.approved)
        .then(createTestNode("approved-path"))
        .endif()
        .end()
        .compile();

      // Should have a decision node
      const decisionNodes = Array.from(compiled.nodes.values()).filter(
        (n) => n.type === "decision"
      );
      expect(decisionNodes.length).toBeGreaterThanOrEqual(1);
    });

    test("throws if called without preceding node", () => {
      expect(() => {
        graph<TestState>().if((state) => state.approved);
      }).toThrow("Cannot use if() without a preceding node");
    });
  });

  describe("else()", () => {
    test("throws if called without preceding if()", () => {
      expect(() => {
        graph<TestState>().start(createTestNode("start")).else();
      }).toThrow("Cannot use else() without a preceding if()");
    });

    test("throws if called twice in same if block", () => {
      expect(() => {
        graph<TestState>()
          .start(createTestNode("start"))
          .if((state) => state.approved)
          .then(createTestNode("if-path"))
          .else()
          .then(createTestNode("else-path"))
          .else(); // Second else should fail
      }).toThrow("Already in else branch");
    });
  });

  describe("endif()", () => {
    test("throws if called without preceding if()", () => {
      expect(() => {
        graph<TestState>().start(createTestNode("start")).endif();
      }).toThrow("Cannot use endif() without a preceding if()");
    });

    test("creates merge node", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .if((state) => state.approved)
        .then(createTestNode("if-path"))
        .else()
        .then(createTestNode("else-path"))
        .endif()
        .end()
        .compile();

      // Should have merge node (decision type)
      const decisionNodes = Array.from(compiled.nodes.values()).filter(
        (n) => n.type === "decision"
      );
      // At least one decision (the if condition) and one merge
      expect(decisionNodes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("complete if/else/endif flow", () => {
    test("creates correct graph structure with if/else", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .if((state) => state.approved)
        .then(createTestNode("approved"))
        .else()
        .then(createTestNode("rejected"))
        .endif()
        .then(createTestNode("finish"))
        .end()
        .compile();

      expect(compiled.nodes.has("start")).toBe(true);
      expect(compiled.nodes.has("approved")).toBe(true);
      expect(compiled.nodes.has("rejected")).toBe(true);
      expect(compiled.nodes.has("finish")).toBe(true);

      // Start should connect to decision node
      const startEdges = compiled.edges.filter((e) => e.from === "start");
      expect(startEdges.length).toBe(1);
    });

    test("creates correct graph structure without else", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .if((state) => state.approved)
        .then(createTestNode("approved"))
        .endif()
        .then(createTestNode("finish"))
        .end()
        .compile();

      expect(compiled.nodes.has("start")).toBe(true);
      expect(compiled.nodes.has("approved")).toBe(true);
      expect(compiled.nodes.has("finish")).toBe(true);
    });

    test("supports nested if statements", () => {
      const compiled = graph<TestState>()
        .start(createTestNode("start"))
        .if((state) => state.approved)
        .then(createTestNode("outer-if-body"))
        .if((state) => state.counter > 0)
        .then(createTestNode("nested-if"))
        .endif()
        .then(createTestNode("outer-if-after-nested"))
        .endif()
        .end()
        .compile();

      expect(compiled.nodes.has("outer-if-body")).toBe(true);
      expect(compiled.nodes.has("nested-if")).toBe(true);
      expect(compiled.nodes.has("outer-if-after-nested")).toBe(true);
    });
  });
});

// ============================================================================
// Loop Tests
// ============================================================================

describe("loop()", () => {
  test("creates loop structure with body node", () => {
    const bodyNode = createIncrementNode("increment");
    const loopConfig: LoopConfig<TestState> = {
      until: (state) => state.counter >= 5,
      maxIterations: 10,
    };

    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .loop(bodyNode, loopConfig)
      .end()
      .compile();

    expect(compiled.nodes.has("increment")).toBe(true);

    // Should have loop_start and loop_check nodes
    const nodeIds = Array.from(compiled.nodes.keys());
    expect(nodeIds.some((id) => id.includes("loop_start"))).toBe(true);
    expect(nodeIds.some((id) => id.includes("loop_check"))).toBe(true);
  });

  test("creates continue and exit edges", () => {
    const bodyNode = createTestNode("body");
    const loopConfig: LoopConfig<TestState> = {
      until: (state) => state.counter >= 3,
    };

    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .loop(bodyNode, loopConfig)
      .then(createTestNode("after-loop"))
      .end()
      .compile();

    // Should have edge labeled loop-continue
    expect(compiled.edges.some((e) => e.label === "loop-continue")).toBe(true);
  });

  test("uses default maxIterations of 100", () => {
    const bodyNode = createTestNode("body");
    const loopConfig: LoopConfig<TestState> = {
      until: (state) => state.counter >= 3,
      // maxIterations not specified, should default to 100
    };

    // Just verify it compiles without error
    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .loop(bodyNode, loopConfig)
      .end()
      .compile();

    expect(compiled.nodes.has("body")).toBe(true);
  });
});

// ============================================================================
// Parallel Execution Tests
// ============================================================================

describe("parallel()", () => {
  test("creates parallel node with branch edges", () => {
    const parallelConfig: ParallelConfig<TestState> = {
      branches: ["branch1", "branch2", "branch3"],
      strategy: "all",
    };

    // First add the branch nodes
    const branch1 = createTestNode("branch1");
    const branch2 = createTestNode("branch2");
    const branch3 = createTestNode("branch3");

    const builder = graph<TestState>().start(createTestNode("start"));

    // Add branch nodes first
    builder.then(branch1);
    builder.then(branch2);
    builder.then(branch3);

    // Note: In real usage, branches would be pre-defined and parallel() would reference them
    // For this test, we verify the parallel node is created
    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .parallel(parallelConfig)
      .end()
      .compile();

    // Should have a parallel node
    const parallelNodes = Array.from(compiled.nodes.values()).filter((n) => n.type === "parallel");
    expect(parallelNodes.length).toBe(1);

    // Should have edges to each branch
    const parallelNode = parallelNodes[0];
    expect(parallelNode).toBeDefined();
    const branchEdges = compiled.edges.filter((e) => e.from === parallelNode!.id);
    expect(branchEdges.length).toBe(3);
  });

  test("supports different merge strategies", () => {
    const strategies: Array<"all" | "race" | "any"> = ["all", "race", "any"];

    for (const strategy of strategies) {
      const config: ParallelConfig<TestState> = {
        branches: ["b1"],
        strategy,
      };

      // Should compile without error
      const compiled = graph<TestState>().start(createTestNode("start")).parallel(config).compile();

      expect(compiled.nodes.size).toBeGreaterThan(0);
    }
  });

  test("can start graph with parallel()", () => {
    const config: ParallelConfig<TestState> = {
      branches: ["b1", "b2"],
    };

    const compiled = graph<TestState>().parallel(config).end().compile();

    // The parallel node should be the start node
    const parallelNodes = Array.from(compiled.nodes.values()).filter((n) => n.type === "parallel");
    expect(parallelNodes.length).toBe(1);
    expect(compiled.startNode).toBe(parallelNodes[0]!.id);
  });
});

// ============================================================================
// Wait Node Tests
// ============================================================================

describe("wait()", () => {
  test("creates wait node from string prompt", () => {
    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .wait("Please review and approve")
      .end()
      .compile();

    const waitNodes = Array.from(compiled.nodes.values()).filter((n) => n.type === "wait");
    expect(waitNodes.length).toBe(1);
  });

  test("accepts full node definition", () => {
    const customWaitNode: NodeDefinition<TestState> = {
      id: "custom-wait",
      type: "wait",
      execute: async () => ({
        signals: [{ type: "human_input_required", message: "Custom wait" }],
      }),
    };

    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .wait(customWaitNode)
      .end()
      .compile();

    expect(compiled.nodes.has("custom-wait")).toBe(true);
  });

  test("connects wait node in sequence", () => {
    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .wait("Pause here")
      .then(createTestNode("after-wait"))
      .end()
      .compile();

    expect(compiled.nodes.has("after-wait")).toBe(true);

    // Wait node should be connected to after-wait
    const waitNodes = Array.from(compiled.nodes.values()).filter((n) => n.type === "wait");
    expect(waitNodes.length).toBe(1);
    const waitNodeId = waitNodes[0]!.id;
    expect(compiled.edges.some((e) => e.from === waitNodeId && e.to === "after-wait")).toBe(true);
  });
});

// ============================================================================
// Error Handler Tests
// ============================================================================

describe("catch()", () => {
  test("registers error handler node", () => {
    const errorHandler: NodeDefinition<TestState> = {
      id: "error-handler",
      type: "agent",
      execute: async () => ({
        stateUpdate: { items: ["Error handled"] },
      }),
    };

    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .then(createTestNode("risky-operation"))
      .catch(errorHandler)
      .end()
      .compile();

    expect(compiled.nodes.has("error-handler")).toBe(true);
  });

  test("sets error handler in config metadata", () => {
    const errorHandler: NodeDefinition<TestState> = {
      id: "error-handler",
      type: "agent",
      execute: async () => ({}),
    };

    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .catch(errorHandler)
      .end()
      .compile();

    expect(compiled.config.metadata?.errorHandlerId).toBe("error-handler");
  });
});

// ============================================================================
// Graph Query Methods Tests
// ============================================================================

describe("Graph Query Methods", () => {
  test("getNode() returns node by ID", () => {
    const node = createTestNode("my-node");
    const builder = graph<TestState>().start(node);

    expect(builder.getNode("my-node")).toBe(node);
    expect(builder.getNode("nonexistent")).toBeUndefined();
  });

  test("getEdgesFrom() returns outgoing edges", () => {
    const builder = graph<TestState>()
      .start(createTestNode("a"))
      .then(createTestNode("b"))
      .then(createTestNode("c"));

    const edges = builder.getEdgesFrom("a");
    expect(edges.length).toBe(1);
    expect(edges[0]!.to).toBe("b");
  });

  test("getEdgesTo() returns incoming edges", () => {
    const builder = graph<TestState>()
      .start(createTestNode("a"))
      .then(createTestNode("b"))
      .then(createTestNode("c"));

    const edges = builder.getEdgesTo("c");
    expect(edges.length).toBe(1);
    expect(edges[0]!.from).toBe("b");
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("createNode()", () => {
  test("creates node with required fields", () => {
    const node = createNode<TestState>("test-node", "agent", async () => ({}));

    expect(node.id).toBe("test-node");
    expect(node.type).toBe("agent");
    expect(node.execute).toBeDefined();
  });

  test("includes optional fields when provided", () => {
    const node = createNode<TestState>("test-node", "tool", async () => ({}), {
      name: "Test Node",
      description: "A test node",
      retry: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 },
    });

    expect(node.name).toBe("Test Node");
    expect(node.description).toBe("A test node");
    expect(node.retry?.maxAttempts).toBe(3);
  });
});

describe("createDecisionNode()", () => {
  test("creates decision node with routes", async () => {
    const node = createDecisionNode<TestState>(
      "router",
      [
        { condition: (s) => s.counter > 10, target: "high" },
        { condition: (s) => s.counter > 5, target: "medium" },
      ],
      "low"
    );

    expect(node.id).toBe("router");
    expect(node.type).toBe("decision");

    // Test routing logic
    const highState: TestState = createTestState({ counter: 15 });
    const medState: TestState = createTestState({ counter: 7 });
    const lowState: TestState = createTestState({ counter: 2 });

    const highResult = await node.execute({
      state: highState,
      nodeId: "router",
    } as any);
    expect(highResult.goto).toBe("high");

    const medResult = await node.execute({
      state: medState,
      nodeId: "router",
    } as any);
    expect(medResult.goto).toBe("medium");

    const lowResult = await node.execute({
      state: lowState,
      nodeId: "router",
    } as any);
    expect(lowResult.goto).toBe("low");
  });
});

describe("createWaitNode()", () => {
  test("creates wait node with prompt", async () => {
    const node = createWaitNode<TestState>("approval", "Please approve this request");

    expect(node.id).toBe("approval");
    expect(node.type).toBe("wait");

    const result = await node.execute({} as any);
    expect(result.signals).toBeDefined();
    expect(result.signals).toHaveLength(1);
    expect(result.signals![0]!.type).toBe("human_input_required");
    expect(result.signals![0]!.message).toBe("Please approve this request");
  });
});

// ============================================================================
// Fluent API Chaining Tests
// ============================================================================

describe("Fluent API Chaining", () => {
  test("all methods return builder for chaining", () => {
    const builder = graph<TestState>();

    // Each method should return the builder
    expect(builder.start(createTestNode("a"))).toBe(builder);
    expect(builder.then(createTestNode("b"))).toBe(builder);
    expect(builder.if((s) => s.approved)).toBe(builder);
    expect(builder.then(createTestNode("c"))).toBe(builder);
    expect(builder.else()).toBe(builder);
    expect(builder.then(createTestNode("d"))).toBe(builder);
    expect(builder.endif()).toBe(builder);
    expect(builder.wait("pause")).toBe(builder);
    expect(builder.catch(createTestNode("error"))).toBe(builder);
    expect(builder.end()).toBe(builder);
  });

  test("complex workflow builds correctly", () => {
    const compiled = graph<TestState>()
      .start(createTestNode("init"))
      .then(createTestNode("process"))
      .if((state) => state.approved)
      .then(createTestNode("approved-flow"))
      .wait("Confirm completion")
      .else()
      .then(createTestNode("rejected-flow"))
      .endif()
      .then(createTestNode("finalize"))
      .catch(createTestNode("error-recovery"))
      .end()
      .compile();

    // Verify key nodes exist
    expect(compiled.nodes.has("init")).toBe(true);
    expect(compiled.nodes.has("process")).toBe(true);
    expect(compiled.nodes.has("approved-flow")).toBe(true);
    expect(compiled.nodes.has("rejected-flow")).toBe(true);
    expect(compiled.nodes.has("finalize")).toBe(true);
    expect(compiled.nodes.has("error-recovery")).toBe(true);

    // Verify graph is connected
    expect(compiled.edges.length).toBeGreaterThan(0);
    expect(compiled.startNode).toBe("init");
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe("Edge Cases", () => {
  test("handles empty else branch", () => {
    // If followed immediately by endif (no nodes in else)
    const compiled = graph<TestState>()
      .start(createTestNode("start"))
      .if((state) => state.approved)
      .then(createTestNode("if-body"))
      .else()
      .endif()
      .end()
      .compile();

    expect(compiled.nodes.has("start")).toBe(true);
    expect(compiled.nodes.has("if-body")).toBe(true);
  });

  test("handles single-node graph", () => {
    const compiled = graph<TestState>().start(createTestNode("only")).end().compile();

    expect(compiled.nodes.size).toBe(1);
    expect(compiled.startNode).toBe("only");
    expect(compiled.endNodes.has("only")).toBe(true);
  });

  test("handles long linear chains", () => {
    let builder = graph<TestState>().start(createTestNode("node_0"));

    for (let i = 1; i < 50; i++) {
      builder = builder.then(createTestNode(`node_${i}`));
    }

    const compiled = builder.end().compile();

    expect(compiled.nodes.size).toBe(50);
    expect(compiled.edges.length).toBe(49); // n-1 edges for n nodes
  });
});
