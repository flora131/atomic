import { describe, expect, test } from "bun:test";
import {
  decisionNode,
  waitNode,
} from "@/services/workflows/graph/nodes/control.ts";
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

describe("decisionNode", () => {
  test("returns the correct type", () => {
    const node = decisionNode({
      id: "decide",
      routes: [],
      fallback: "default_node",
    });
    expect(node.type).toBe("decision");
  });

  test("evaluates routes in order and returns first match", async () => {
    const node = decisionNode<BaseState>({
      id: "decide",
      routes: [
        { condition: () => false, target: "route_a" },
        { condition: () => true, target: "route_b" },
        { condition: () => true, target: "route_c" },
      ],
      fallback: "fallback_node",
    });

    const result = await node.execute(makeCtx());
    expect(result.goto).toBe("route_b");
  });

  test("routes based on state", async () => {
    interface TestState extends BaseState {
      priority: string;
    }

    const node = decisionNode<TestState>({
      id: "decide",
      routes: [
        {
          condition: (state) => state.priority === "high",
          target: "fast_path",
        },
        {
          condition: (state) => state.priority === "low",
          target: "slow_path",
        },
      ],
      fallback: "normal_path",
    });

    const ctx = {
      state: {
        executionId: "exec_1",
        lastUpdated: "",
        outputs: {},
        priority: "high",
      },
      config: {},
      errors: [],
    } as ExecutionContext<TestState>;

    const result = await node.execute(ctx);
    expect(result.goto).toBe("fast_path");
  });

  test("returns fallback when no route matches", async () => {
    const node = decisionNode<BaseState>({
      id: "decide",
      routes: [
        { condition: () => false, target: "route_a" },
      ],
      fallback: "fallback_node",
    });

    const result = await node.execute(makeCtx());
    expect(result.goto).toBe("fallback_node");
  });

  test("uses custom name when provided", () => {
    const node = decisionNode({
      id: "decide",
      routes: [],
      fallback: "default",
      name: "custom-name",
    });
    expect(node.name).toBe("custom-name");
  });

  test("defaults name to decision", () => {
    const node = decisionNode({
      id: "decide",
      routes: [],
      fallback: "default",
    });
    expect(node.name).toBe("decision");
  });
});

describe("waitNode", () => {
  test("returns the correct type", () => {
    const node = waitNode({ id: "wait_1", prompt: "Continue?" });
    expect(node.type).toBe("wait");
  });

  test("emits human_input_required signal with static prompt", async () => {
    const node = waitNode({ id: "wait_1", prompt: "Are you sure?" });
    const result = await node.execute(makeCtx());

    expect(result.signals).toBeDefined();
    expect(result.signals!.length).toBe(1);
    expect(result.signals![0]!.type).toBe("human_input_required");
    expect(result.signals![0]!.message).toBe("Are you sure?");
  });

  test("resolves dynamic prompt from state", async () => {
    interface TestState extends BaseState {
      step: string;
    }

    const node = waitNode<TestState>({
      id: "wait_1",
      prompt: (state) => `Confirm step: ${state.step}?`,
    });

    const ctx = {
      state: {
        executionId: "exec_1",
        lastUpdated: "",
        outputs: {},
        step: "deploy",
      },
      config: {},
      errors: [],
    } as ExecutionContext<TestState>;

    const result = await node.execute(ctx);
    expect(result.signals![0]!.message).toBe("Confirm step: deploy?");
  });

  test("autoApprove skips signal and returns immediately", async () => {
    const node = waitNode({
      id: "wait_1",
      prompt: "Continue?",
      autoApprove: true,
    });
    const result = await node.execute(makeCtx());

    expect(result.signals).toBeUndefined();
  });

  test("autoApprove with inputMapper returns mapped state", async () => {
    const node = waitNode({
      id: "wait_1",
      prompt: "Continue?",
      autoApprove: true,
      inputMapper: () => ({ outputs: { approved: true } }),
    });
    const result = await node.execute(makeCtx());

    expect(result.stateUpdate).toEqual({ outputs: { approved: true } });
  });

  test("signal data includes nodeId", async () => {
    const node = waitNode({ id: "my_wait", prompt: "Hello" });
    const result = await node.execute(makeCtx());

    const data = result.signals![0]!.data as Record<string, unknown>;
    expect(data.nodeId).toBe("my_wait");
  });
});
