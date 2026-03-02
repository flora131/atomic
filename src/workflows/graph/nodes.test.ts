import { describe, expect, test } from "bun:test";
import { contextMonitorNode, parallelNode, parallelSubagentNode } from "./nodes.ts";
import type { BaseState, ContextWindowUsage, ExecutionContext, SubagentStreamResult } from "./types.ts";
import type { ContextUsage, Session } from "../../sdk/types.ts";

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

interface MonitorState extends BaseState {
  contextWindowUsage: ContextWindowUsage | null;
}

function createMonitorContext(
  overrides: Partial<MonitorState> = {},
): ExecutionContext<MonitorState> {
  return {
    state: {
      executionId: "exec-monitor",
      lastUpdated: new Date(0).toISOString(),
      outputs: {},
      contextWindowUsage: null,
      ...overrides,
    },
    config: {},
    errors: [],
  };
}

function createMockMonitoringSession(options: {
  usagePercentage: number;
  hasAutoCompacted: boolean;
  isCompacting?: boolean;
}): { session: Session; getSummarizeCalls: () => number } {
  let summarizeCalls = 0;
  const usage: ContextUsage = {
    inputTokens: 60,
    outputTokens: 0,
    maxTokens: 100,
    usagePercentage: options.usagePercentage,
  };
  const session: Session = {
    id: "ses_monitor",
    send: async () => ({ type: "text", content: "" }),
    stream: async function* () {},
    summarize: async () => {
      summarizeCalls += 1;
    },
    getContextUsage: async () => usage,
    getSystemToolsTokens: () => 0,
    getCompactionState: () => ({
      isCompacting: options.isCompacting ?? false,
      hasAutoCompacted: options.hasAutoCompacted,
    }),
    destroy: async () => {},
  };
  return {
    session,
    getSummarizeCalls: () => summarizeCalls,
  };
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

describe("contextMonitorNode compaction conflict guard", () => {
  test("skips summarize when session has already auto-compacted", async () => {
    const { session, getSummarizeCalls } = createMockMonitoringSession({
      usagePercentage: 60,
      hasAutoCompacted: true,
    });
    const node = contextMonitorNode<MonitorState>({
      id: "context-monitor",
      agentType: "opencode",
      getSession: () => session,
    });

    const result = await node.execute(createMonitorContext());

    expect(getSummarizeCalls()).toBe(0);
    expect(result.stateUpdate?.contextWindowUsage?.usagePercentage).toBe(60);
  });

  test("summarizes when threshold is exceeded and no compaction conflict exists", async () => {
    const { session, getSummarizeCalls } = createMockMonitoringSession({
      usagePercentage: 60,
      hasAutoCompacted: false,
    });
    const node = contextMonitorNode<MonitorState>({
      id: "context-monitor",
      agentType: "opencode",
      getSession: () => session,
    });

    await node.execute(createMonitorContext());

    expect(getSummarizeCalls()).toBe(1);
  });

  test("throws when summarize action is selected without a session", async () => {
    const node = contextMonitorNode<MonitorState>({
      id: "context-monitor",
      agentType: "opencode",
      getSession: () => null,
      getContextUsage: async () => ({
        inputTokens: 60,
        outputTokens: 0,
        maxTokens: 100,
        usagePercentage: 60,
      }),
    });

    await expect(node.execute(createMonitorContext())).rejects.toThrow(
      /no session available for summarization/i,
    );
  });

  test("surfaces summarize failures instead of downgrading to warning signals", async () => {
    const session: Session = {
      id: "ses_monitor_error",
      send: async () => ({ type: "text", content: "" }),
      stream: async function* () {},
      summarize: async () => {
        throw new Error("Compaction timed out");
      },
      getContextUsage: async () => ({
        inputTokens: 60,
        outputTokens: 0,
        maxTokens: 100,
        usagePercentage: 60,
      }),
      getSystemToolsTokens: () => 0,
      getCompactionState: () => ({
        isCompacting: false,
        hasAutoCompacted: false,
      }),
      destroy: async () => {},
    };
    const node = contextMonitorNode<MonitorState>({
      id: "context-monitor",
      agentType: "opencode",
      getSession: () => session,
    });

    await expect(node.execute(createMonitorContext())).rejects.toThrow(/compaction timed out/i);
  });
});
