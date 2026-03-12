import { describe, expect, test } from "bun:test";
import {
  graph,
  type LoopConfig,
  type ParallelConfig,
} from "@/services/workflows/graph/builder.ts";
import type { NodeDefinition } from "@/services/workflows/graph/types.ts";
import {
  testNode1,
  testNode2,
  testNode3,
  type TestState,
} from "./builder.fixtures.ts";

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

    expect(compiled.nodes.size).toBeGreaterThanOrEqual(2);

    const parallelNode = Array.from(compiled.nodes.values()).find((node) => node.type === "parallel");
    expect(parallelNode).toBeDefined();

    const edgeToParallel = compiled.edges.find((edge) => edge.from === "test1");
    expect(edgeToParallel?.to).toBe(parallelNode?.id);

    const branchEdges = compiled.edges.filter((edge) => edge.from === parallelNode?.id);
    expect(branchEdges.length).toBe(2);
    expect(branchEdges.map((edge) => edge.to)).toContain("test2");
    expect(branchEdges.map((edge) => edge.to)).toContain("test3");
  });

  test("parallel execution can be used as start node", () => {
    const parallelConfig: ParallelConfig<TestState> = {
      branches: ["test1", "test2"],
    };

    const builder = graph<TestState>().parallel(parallelConfig);
    const compiled = builder.compile();

    const parallelNode = Array.from(compiled.nodes.values()).find((node) => node.type === "parallel");
    expect(compiled.startNode).toBe(parallelNode!.id);
  });
});

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

    expect(compiled.nodes.size).toBe(4);

    const loopStartNode = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_start_"));
    const loopCheckNode = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_check_"));

    expect(loopStartNode).toBeDefined();
    expect(loopCheckNode).toBeDefined();

    const edgeToBody = compiled.edges.find((edge) => edge.from === loopStartNode);
    expect(edgeToBody?.to).toBe("test2");

    const edgeToCheck = compiled.edges.find((edge) => edge.from === "test2");
    expect(edgeToCheck?.to).toBe(loopCheckNode);

    const continueEdge = compiled.edges.find(
      (edge) => edge.from === loopCheckNode && edge.to === "test2" && edge.label === "loop-continue",
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

    expect(compiled.nodes.size).toBe(5);
    expect(compiled.edges.find((edge) => edge.from === "test2" && edge.to === "test3")).toBeDefined();

    const loopCheckNode = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_check_"));
    const edgeToCheck = compiled.edges.find((edge) => edge.from === "test3");
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

    const loopStartNode = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_start_"));
    expect(compiled.startNode).toBe(loopStartNode!);
  });
});

describe("GraphBuilder - wait nodes", () => {
  test("creates wait node from string prompt", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .wait("Please provide input")
      .end();

    const compiled = builder.compile();

    expect(compiled.nodes.size).toBe(2);

    const waitNode = Array.from(compiled.nodes.values()).find(
      (node) => node.type === "wait" && node.id.startsWith("wait_"),
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

    expect(compiled.nodes.has("error_handler")).toBe(true);
    expect(compiled.config.metadata?.errorHandlerId).toBe("error_handler");
  });
});
