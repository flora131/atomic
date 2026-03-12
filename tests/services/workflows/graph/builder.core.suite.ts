import { describe, expect, test } from "bun:test";
import {
  GraphBuilder,
  graph,
  type IfConfig,
} from "@/services/workflows/graph/builder.ts";
import type { NodeDefinition } from "@/services/workflows/graph/types.ts";
import {
  testNode1,
  testNode2,
  testNode3,
  type TestState,
} from "./builder.fixtures.ts";

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
      builder.then(testNode1);
    }).toThrow('Node with ID "test1" already exists');
  });
});

describe("GraphBuilder - conditional branches", () => {
  test("creates if/endif branch structure", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .if((state) => state.flag === true)
      .then(testNode2)
      .endif()
      .end();

    const compiled = builder.compile();

    expect(compiled.nodes.size).toBe(4);

    const nodeIds = Array.from(compiled.nodes.keys());
    const decisionNode = nodeIds.find((id) => id.startsWith("decision_"));
    const mergeNode = nodeIds.find((id) => id.startsWith("merge_"));

    expect(decisionNode).toBeDefined();
    expect(mergeNode).toBeDefined();

    const edgeFromTest1 = compiled.edges.find((edge) => edge.from === "test1");
    expect(edgeFromTest1?.to).toBe(decisionNode);

    const edgeToTest2 = compiled.edges.find((edge) => edge.to === "test2");
    expect(edgeToTest2?.from).toBe(decisionNode);
    expect(edgeToTest2?.label).toBe("if-true");

    const edgeFromTest2 = compiled.edges.find((edge) => edge.from === "test2");
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

    expect(compiled.nodes.size).toBe(5);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);

    const edgeToTest2 = compiled.edges.find((edge) => edge.to === "test2");
    const edgeToTest3 = compiled.edges.find((edge) => edge.to === "test3");

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
        .else();
    }).toThrow("Already in else branch");
  });
});

describe("GraphBuilder - config-based conditional", () => {
  test("creates if config with then and else branches", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .if({
        condition: (state) => state.flag === true,
        then: [testNode2],
        else: [testNode3],
      } satisfies IfConfig<TestState>)
      .end();

    const compiled = builder.compile();

    expect(compiled.nodes.size).toBe(5);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);

    const edgeToTest2 = compiled.edges.find((edge) => edge.to === "test2");
    const edgeToTest3 = compiled.edges.find((edge) => edge.to === "test3");

    expect(edgeToTest2?.label).toBe("if-true");
    expect(edgeToTest3?.label).toBe("if-false");
  });

  test("creates if config with only then branch", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .if({
        condition: (state) => state.flag === true,
        then: [testNode2],
      } satisfies IfConfig<TestState>)
      .end();

    const compiled = builder.compile();

    expect(compiled.nodes.size).toBe(4);

    const nodeIds = Array.from(compiled.nodes.keys());
    const decisionNode = nodeIds.find((id) => id.startsWith("decision_"));
    const mergeNode = nodeIds.find((id) => id.startsWith("merge_"));

    expect(decisionNode).toBeDefined();
    expect(mergeNode).toBeDefined();

    const edgeToTest2 = compiled.edges.find((edge) => edge.to === "test2");
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
      } satisfies IfConfig<TestState>)
      .end();

    const compiled = builder.compile();

    expect(compiled.nodes.has("test1")).toBe(true);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    expect(compiled.nodes.has("test4")).toBe(true);
    expect(compiled.edges.find((edge) => edge.to === "test2")).toBeDefined();
    expect(compiled.edges.find((edge) => edge.to === "test3")).toBeDefined();
    expect(compiled.edges.find((edge) => edge.to === "test4")).toBeDefined();
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
      } satisfies IfConfig<TestState>)
      .end();

    const compiled = builder.compile();

    expect(compiled.nodes.has("test1")).toBe(true);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    expect(compiled.nodes.has("test4")).toBe(true);
    expect(compiled.nodes.has("test5")).toBe(true);
    expect(compiled.edges.find((edge) => edge.to === "test2")).toBeDefined();
    expect(compiled.edges.find((edge) => edge.to === "test3")).toBeDefined();
    expect(compiled.edges.find((edge) => edge.to === "test4")).toBeDefined();
    expect(compiled.edges.find((edge) => edge.to === "test5")).toBeDefined();
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
      } satisfies IfConfig<TestState>)
      .end();

    const compiled = builder.compile();

    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    expect(compiled.nodes.has("test4")).toBe(true);
    expect(compiled.nodes.has("test5")).toBe(true);
    expect(compiled.edges.find((edge) => edge.from === "test2" && edge.to === "test3")).toBeDefined();
    expect(compiled.edges.find((edge) => edge.from === "test4" && edge.to === "test5")).toBeDefined();
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
      } satisfies IfConfig<TestState>)
      .then(testNode4)
      .end();

    const compiled = builder.compile();

    expect(compiled.nodes.has("test4")).toBe(true);

    const nodeIds = Array.from(compiled.nodes.keys());
    const mergeNode = nodeIds.find((id) => id.startsWith("merge_"));

    expect(mergeNode).toBeDefined();
    expect(compiled.edges.find((edge) => edge.from === mergeNode && edge.to === "test4")).toBeDefined();
  });
});
