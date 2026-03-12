import { describe, expect, test } from "bun:test";
import { executeGraph } from "@/services/workflows/graph/compiled.ts";
import { createNode, graph } from "@/services/workflows/graph/builder.ts";
import type { TestState } from "./compiled.fixtures.ts";

describe("GraphExecutor - Basic Execution", () => {
  test("executes a simple linear graph", async () => {
    const node1 = createNode<TestState>("node1", "tool", async (ctx) => {
      return {
        stateUpdate: {
          counter: 1,
          outputs: { ...ctx.state.outputs, node1: "executed" },
        },
      };
    });

    const node2 = createNode<TestState>("node2", "tool", async (ctx) => {
      return {
        stateUpdate: {
          counter: (ctx.state.counter ?? 0) + 1,
          outputs: { ...ctx.state.outputs, node2: "executed" },
        },
      };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.counter).toBe(2);
    expect(result.state.outputs.node1).toBe("executed");
    expect(result.state.outputs.node2).toBe("executed");
  });

  test("executes single node graph", async () => {
    const node = createNode<TestState>("single", "tool", async () => {
      return {
        stateUpdate: {
          flag: true,
        },
      };
    });

    const workflow = graph<TestState>()
      .start(node)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.flag).toBe(true);
  });

  test("preserves state across multiple nodes", async () => {
    const node1 = createNode<TestState>("node1", "tool", async () => {
      return {
        stateUpdate: {
          messages: ["msg1"],
        },
      };
    });

    const node2 = createNode<TestState>("node2", "tool", async (ctx) => {
      return {
        stateUpdate: {
          messages: [...(ctx.state.messages ?? []), "msg2"],
        },
      };
    });

    const node3 = createNode<TestState>("node3", "tool", async (ctx) => {
      return {
        stateUpdate: {
          messages: [...(ctx.state.messages ?? []), "msg3"],
        },
      };
    });

    const workflow = graph<TestState>()
      .start(node1)
      .then(node2)
      .then(node3)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["msg1", "msg2", "msg3"]);
  });
});

describe("GraphExecutor - Conditional Routing", () => {
  test("routes through if branch when condition is true", async () => {
    const start = createNode<TestState>("start", "tool", async () => {
      return { stateUpdate: { flag: true } };
    });

    const ifNode = createNode<TestState>("if", "tool", async () => {
      return { stateUpdate: { messages: ["if-branch"] } };
    });

    const elseNode = createNode<TestState>("else", "tool", async () => {
      return { stateUpdate: { messages: ["else-branch"] } };
    });

    const end = createNode<TestState>("end", "tool", async (ctx) => {
      return {
        stateUpdate: {
          messages: [...(ctx.state.messages ?? []), "end"],
        },
      };
    });

    const workflow = graph<TestState>()
      .start(start)
      .if((state) => state.flag === true)
      .then(ifNode)
      .else()
      .then(elseNode)
      .endif()
      .then(end)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["if-branch", "end"]);
  });

  test("routes through else branch when condition is false", async () => {
    const start = createNode<TestState>("start", "tool", async () => {
      return { stateUpdate: { flag: false } };
    });

    const ifNode = createNode<TestState>("if", "tool", async () => {
      return { stateUpdate: { messages: ["if-branch"] } };
    });

    const elseNode = createNode<TestState>("else", "tool", async () => {
      return { stateUpdate: { messages: ["else-branch"] } };
    });

    const end = createNode<TestState>("end", "tool", async (ctx) => {
      return {
        stateUpdate: {
          messages: [...(ctx.state.messages ?? []), "end"],
        },
      };
    });

    const workflow = graph<TestState>()
      .start(start)
      .if((state) => state.flag === true)
      .then(ifNode)
      .else()
      .then(elseNode)
      .endif()
      .then(end)
      .end()
      .compile();

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["else-branch", "end"]);
  });

  test("handles goto in node result", async () => {
    const start = createNode<TestState>("start", "tool", async () => {
      return { goto: "target" };
    });

    const skipped = createNode<TestState>("skipped", "tool", async () => {
      return { stateUpdate: { messages: ["skipped"] } };
    });

    const target = createNode<TestState>("target", "tool", async () => {
      return { stateUpdate: { messages: ["target"] } };
    });

    const workflow = graph<TestState>()
      .start(start)
      .then(skipped)
      .end()
      .compile();

    workflow.nodes.set("target", target);
    workflow.edges.push({ from: "start", to: "target" });
    workflow.endNodes.add("target");

    const result = await executeGraph(workflow);

    expect(result.status).toBe("completed");
    expect(result.state.messages).toEqual(["target"]);
  });
});
