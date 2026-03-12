import { describe, expect, test } from "bun:test";
import {
  createDecisionNode,
  createNode,
  createWaitNode,
  graph,
} from "@/services/workflows/graph/builder.ts";
import { testStateSchema, testNode1, testNode2, testNode3, type TestState } from "./builder.fixtures.ts";

describe("createNode helper", () => {
  test("creates a basic node definition", () => {
    const node = createNode<TestState>(
      "my_node",
      "tool",
      async () => ({ stateUpdate: { count: 42 } }),
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
      },
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
