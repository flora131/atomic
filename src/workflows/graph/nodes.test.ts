import { describe, expect, test } from "bun:test";
import { parallelNode, parallelSubagentNode } from "./nodes.ts";
import type { BaseState, ExecutionContext, SubagentStreamResult } from "./types.ts";

interface TestState extends BaseState {
  mapperSource?: string;
}

function createContext(
  overrides: Partial<TestState> = {},
  runtimeOverrides: Partial<NonNullable<ExecutionContext<TestState>["config"]["runtime"]>> = {},
): ExecutionContext<TestState> {
  return {
    state: {
      executionId: "exec-1",
      lastUpdated: new Date(0).toISOString(),
      outputs: {},
      ...overrides,
    },
    config: {
      runtime: runtimeOverrides,
    },
    errors: [],
  };
}

function createMockSpawnParallel(results: SubagentStreamResult[]) {
  return async (): Promise<SubagentStreamResult[]> => results;
}

describe("parallelNode mapper standardization", () => {
  test("uses outputMapper when provided", async () => {
    const outputMapper = (results: Map<string, unknown>) => ({ mapperSource: `size:${results.size}` });
    const node = parallelNode<TestState>({
      id: "parallel",
      branches: ["branch-a"],
      outputMapper,
    });

    const result = await node.execute(createContext());
    const parallelOutput = result.stateUpdate?.outputs?.parallel;
    expect(parallelOutput).toBeDefined();
    const metadata = parallelOutput as {
      outputMapper?: (results: Map<string, unknown>) => Partial<TestState>;
      merge?: (results: Map<string, unknown>) => Partial<TestState>;
    };

    expect(result.goto).toEqual(["branch-a"]);
    expect(metadata.outputMapper).toBe(outputMapper);
    expect(metadata.merge).toBe(outputMapper);
  });

  test("keeps legacy merge as backward-compatible alias", async () => {
    const merge = (results: Map<string, unknown>) => ({ mapperSource: `legacy:${results.size}` });
    const node = parallelNode<TestState>({
      id: "parallel",
      branches: ["branch-a"],
      merge,
    });

    const result = await node.execute(createContext());
    const parallelOutput = result.stateUpdate?.outputs?.parallel;
    expect(parallelOutput).toBeDefined();
    const metadata = parallelOutput as {
      outputMapper?: (results: Map<string, unknown>) => Partial<TestState>;
      merge?: (results: Map<string, unknown>) => Partial<TestState>;
    };

    expect(metadata.outputMapper).toBe(merge);
    expect(metadata.merge).toBe(merge);
  });
});

describe("parallelSubagentNode mapper standardization", () => {
  const mockResult: SubagentStreamResult = {
    agentId: "agent-1",
    success: true,
    output: "ok",
    toolUses: 0,
    durationMs: 1,
  };

  test("uses outputMapper when provided", async () => {
    const node = parallelSubagentNode<TestState>({
      id: "parallel-subagents",
      agents: [{ agentName: "worker", task: "do work" }],
      outputMapper: (results) => ({
        mapperSource: `outputMapper:${results.get("worker-0")?.output ?? "missing"}`,
      }),
    });

    const result = await node.execute(createContext({}, {
      spawnSubagentParallel: createMockSpawnParallel([mockResult]),
    }));
    expect(result.stateUpdate?.mapperSource).toBe("outputMapper:ok");
  });

  test("prefers outputMapper over legacy merge when both are provided", async () => {
    const node = parallelSubagentNode<TestState>({
      id: "parallel-subagents",
      agents: [{ agentName: "worker", task: "do work" }],
      outputMapper: () => ({ mapperSource: "outputMapper" }),
      merge: () => ({ mapperSource: "merge" }),
    });

    const result = await node.execute(createContext({}, {
      spawnSubagentParallel: createMockSpawnParallel([mockResult]),
    }));
    expect(result.stateUpdate?.mapperSource).toBe("outputMapper");
  });

  test("accepts legacy merge mapper", async () => {
    const node = parallelSubagentNode<TestState>({
      id: "parallel-subagents",
      agents: [{ agentName: "worker", task: "do work" }],
      merge: () => ({ mapperSource: "merge" }),
    });

    const result = await node.execute(createContext({}, {
      spawnSubagentParallel: createMockSpawnParallel([mockResult]),
    }));
    expect(result.stateUpdate?.mapperSource).toBe("merge");
  });

  test("throws when neither outputMapper nor merge is provided", () => {
    expect(() =>
      parallelSubagentNode<TestState>({
        id: "parallel-subagents",
        agents: [{ agentName: "worker", task: "do work" }],
      })
    ).toThrow(/requires outputMapper/);
  });
});
