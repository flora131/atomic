import { describe, expect, test } from "bun:test";
import { subgraphNode } from "@/services/workflows/graph/nodes/subgraph.ts";
import type { CompiledSubgraph } from "@/services/workflows/graph/nodes/subgraph.ts";
import type { BaseState, ExecutionContext } from "@/services/workflows/graph/types.ts";

function makeCtx(
  state?: Partial<BaseState>,
  runtime?: Record<string, unknown>,
): ExecutionContext<BaseState> {
  return {
    state: {
      executionId: "exec_1",
      lastUpdated: new Date().toISOString(),
      outputs: {},
      ...state,
    },
    config: { runtime },
    errors: [],
  };
}

describe("subgraphNode", () => {
  test("returns a node with type subgraph", () => {
    const sub: CompiledSubgraph<BaseState> = {
      execute: async (state) => state,
    };
    const node = subgraphNode({ id: "sub_1", subgraph: sub });
    expect(node.type).toBe("subgraph");
  });

  test("executes inline subgraph", async () => {
    const sub: CompiledSubgraph<BaseState> = {
      execute: async (state) => ({
        ...state,
        outputs: { ...state.outputs, sub_result: "done" },
      }),
    };

    const node = subgraphNode({ id: "sub_1", subgraph: sub });
    const result = await node.execute(makeCtx());

    expect(result.stateUpdate).toBeDefined();
    const outputs = (result.stateUpdate as BaseState).outputs;
    expect(outputs.sub_1).toBeDefined();
  });

  test("passes parent state through to subgraph by default", async () => {
    let receivedState: BaseState | undefined;
    const sub: CompiledSubgraph<BaseState> = {
      execute: async (state) => {
        receivedState = state;
        return state;
      },
    };

    const node = subgraphNode({ id: "sub_1", subgraph: sub });
    const ctx = makeCtx({ outputs: { parent_data: "hello" } });
    await node.execute(ctx);

    expect(receivedState).toBeDefined();
    expect(receivedState!.outputs.parent_data).toBe("hello");
  });

  test("uses inputMapper to transform state before subgraph", async () => {
    interface SubState extends BaseState {
      input: string;
    }

    let receivedInput: string | undefined;
    const sub: CompiledSubgraph<SubState> = {
      execute: async (state) => {
        receivedInput = state.input;
        return state;
      },
    };

    const node = subgraphNode<BaseState, SubState>({
      id: "sub_1",
      subgraph: sub,
      inputMapper: (parentState) => ({
        executionId: parentState.executionId,
        lastUpdated: parentState.lastUpdated,
        outputs: {},
        input: "mapped-input",
      }),
    });

    await node.execute(makeCtx());
    expect(receivedInput).toBe("mapped-input");
  });

  test("uses outputMapper to transform result back", async () => {
    const sub: CompiledSubgraph<BaseState> = {
      execute: async (state) => ({
        ...state,
        outputs: { ...state.outputs, result: "sub-result" },
      }),
    };

    const node = subgraphNode({
      id: "sub_1",
      subgraph: sub,
      outputMapper: (subState) => ({
        outputs: { mapped_result: subState.outputs.result },
      }),
    });

    const result = await node.execute(makeCtx());
    expect(result.stateUpdate).toEqual({
      outputs: { mapped_result: "sub-result" },
    });
  });

  test("default output stores subState under node id in outputs", async () => {
    const sub: CompiledSubgraph<BaseState> = {
      execute: async (state) => state,
    };

    const node = subgraphNode({ id: "sub_1", subgraph: sub });
    const result = await node.execute(makeCtx());

    const outputs = (result.stateUpdate as BaseState).outputs;
    expect(outputs.sub_1).toBeDefined();
  });

  test("resolves string ref via workflow resolver", async () => {
    const sub: CompiledSubgraph<BaseState> = {
      execute: async (state) => ({
        ...state,
        outputs: { ...state.outputs, resolved: true },
      }),
    };

    const node = subgraphNode({ id: "sub_1", subgraph: "my-workflow" });
    const ctx = makeCtx({}, {
      workflowResolver: (name: string) => (name === "my-workflow" ? sub : null),
    });

    const result = await node.execute(ctx);
    expect(result.stateUpdate).toBeDefined();
  });

  test("throws when string ref used without resolver", async () => {
    const node = subgraphNode({ id: "sub_1", subgraph: "my-workflow" });

    expect(node.execute(makeCtx())).rejects.toThrow(
      "No workflow resolver configured",
    );
  });

  test("throws when resolver returns null", async () => {
    const node = subgraphNode({ id: "sub_1", subgraph: "missing-workflow" });
    const ctx = makeCtx({}, {
      workflowResolver: () => null,
    });

    expect(node.execute(ctx)).rejects.toThrow("Workflow not found");
  });

  test("uses custom name when provided", () => {
    const sub: CompiledSubgraph<BaseState> = {
      execute: async (state) => state,
    };
    const node = subgraphNode({ id: "sub_1", subgraph: sub, name: "my-sub" });
    expect(node.name).toBe("my-sub");
  });
});
