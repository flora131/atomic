import { describe, expect, test } from "bun:test";
import { toolNode } from "@/services/workflows/graph/nodes/tool.ts";
import type { BaseState, ExecutionContext } from "@/services/workflows/graph/types.ts";

function makeCtx(state?: Partial<BaseState>): ExecutionContext<BaseState> {
  return {
    state: {
      executionId: "exec_1",
      lastUpdated: new Date().toISOString(),
      outputs: {},
      ...state,
    },
    config: {},
    errors: [],
  };
}

describe("toolNode", () => {
  test("throws when execute is not provided", () => {
    expect(() =>
      toolNode({
        id: "tool_1",
        toolName: "my-tool",
      }),
    ).toThrow('Tool node "tool_1" requires an execute function');
  });

  test("returns a node with type tool", () => {
    const node = toolNode({
      id: "tool_1",
      toolName: "my-tool",
      execute: async () => "result",
    });
    expect(node.type).toBe("tool");
  });

  test("executes with resolved args", async () => {
    let receivedArgs: unknown;
    const node = toolNode<BaseState, { query: string }, string>({
      id: "tool_1",
      toolName: "search",
      args: { query: "hello" },
      execute: async (args) => {
        receivedArgs = args;
        return "found";
      },
    });

    await node.execute(makeCtx());
    expect(receivedArgs).toEqual({ query: "hello" });
  });

  test("resolves dynamic args from state", async () => {
    interface TestState extends BaseState {
      topic: string;
    }

    let receivedArgs: unknown;
    const node = toolNode<TestState, { query: string }, string>({
      id: "tool_1",
      toolName: "search",
      args: (state) => ({ query: state.topic }),
      execute: async (args) => {
        receivedArgs = args;
        return "found";
      },
    });

    const ctx = {
      state: {
        executionId: "exec_1",
        lastUpdated: "",
        outputs: {},
        topic: "workflows",
      },
      config: {},
      errors: [],
    } as ExecutionContext<TestState>;

    await node.execute(ctx);
    expect(receivedArgs).toEqual({ query: "workflows" });
  });

  test("uses outputMapper when provided", async () => {
    const node = toolNode<BaseState, undefined, string>({
      id: "tool_1",
      toolName: "my-tool",
      execute: async () => "result-value",
      outputMapper: (result) => ({
        outputs: { custom: result },
      }),
    });

    const result = await node.execute(makeCtx());
    expect(result.stateUpdate).toEqual({ outputs: { custom: "result-value" } });
  });

  test("uses default output mapping when no outputMapper", async () => {
    const node = toolNode<BaseState, undefined, string>({
      id: "tool_1",
      toolName: "my-tool",
      execute: async () => "result-value",
    });

    const result = await node.execute(makeCtx());
    expect(result.stateUpdate).toBeDefined();
    const outputs = (result.stateUpdate as BaseState).outputs;
    expect(outputs.tool_1).toBe("result-value");
  });

  test("preserves existing outputs in default mapping", async () => {
    const node = toolNode<BaseState, undefined, string>({
      id: "tool_1",
      toolName: "my-tool",
      execute: async () => "new-value",
    });

    const ctx = makeCtx({ outputs: { existing: "old-value" } });
    const result = await node.execute(ctx);
    const outputs = (result.stateUpdate as BaseState).outputs;
    expect(outputs.existing).toBe("old-value");
    expect(outputs.tool_1).toBe("new-value");
  });

  test("uses custom name when provided", () => {
    const node = toolNode({
      id: "tool_1",
      toolName: "my-tool",
      name: "custom-tool",
      execute: async () => "result",
    });
    expect(node.name).toBe("custom-tool");
  });

  test("defaults name to toolName", () => {
    const node = toolNode({
      id: "tool_1",
      toolName: "my-tool",
      execute: async () => "result",
    });
    expect(node.name).toBe("my-tool");
  });

  test("propagates execute errors", async () => {
    const node = toolNode({
      id: "tool_1",
      toolName: "my-tool",
      execute: async () => {
        throw new Error("tool failed");
      },
    });

    expect(node.execute(makeCtx())).rejects.toThrow("tool failed");
  });

  test("passes abort signal to execute", async () => {
    let receivedSignal: AbortSignal | undefined;
    const node = toolNode({
      id: "tool_1",
      toolName: "my-tool",
      execute: async (_args, signal) => {
        receivedSignal = signal;
        return "done";
      },
    });

    await node.execute(makeCtx());
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  test("stores retry config on the node", () => {
    const retry = { maxAttempts: 5, backoffMs: 2000, backoffMultiplier: 3 };
    const node = toolNode({
      id: "tool_1",
      toolName: "my-tool",
      execute: async () => "result",
      retry,
    });
    expect(node.retry).toEqual(retry);
  });
});
