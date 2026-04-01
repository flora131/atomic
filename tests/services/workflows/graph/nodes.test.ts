import { describe, expect, test } from "bun:test";
import { agentNode, parallelNode, parallelSubagentNode } from "@/services/workflows/graph/nodes.ts";
import { askUserNode } from "@/services/workflows/graph/nodes/control.ts";
import type { AskUserQuestionEventData, AskUserWaitState } from "@/services/workflows/graph/nodes/control.ts";
import type { BaseState, ExecutionContext, SubagentStreamResult } from "@/services/workflows/graph/types.ts";
import type { CodingAgentClient, Session, SessionConfig } from "@/services/agents/types.ts";

interface TestState extends BaseState {
  mapperSource?: string;
}

function createContext(
  overrides: Partial<TestState> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy spawn props removed from GraphRuntimeDependencies
  runtimeOverrides: Record<string, any> = {},
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

describe("agentNode session instructions", () => {
  test("does not inject enhanced instructions by default", async () => {
    const createSessionCalls: SessionConfig[] = [];
    const session: Session = {
      id: "ses_agent_node",
      send: async () => ({ type: "text", content: "", role: "assistant" }),
      stream: async function* () {
        yield { type: "text", content: "done", role: "assistant" } as const;
      },
      summarize: async () => {},
      getContextUsage: async () => ({
        inputTokens: 1,
        outputTokens: 1,
        maxTokens: 100,
        usagePercentage: 2,
      }),
      getSystemToolsTokens: () => 0,
      destroy: async () => {},
    };

    const client: CodingAgentClient = {
      agentType: "opencode",
      createSession: async (config = {}) => {
        createSessionCalls.push(config);
        return session;
      },
      resumeSession: async () => null,
      on: () => () => {},
      registerTool: () => {},
      start: async () => {},
      stop: async () => {},
      getModelDisplayInfo: async () => ({ model: "mock", tier: "mock" }),
      getSystemToolsTokens: () => null,
    };

    const node = agentNode<TestState>({
      id: "agent-node",
      agentType: "opencode",
      buildMessage: () => "Analyze repo state",
    });

    await node.execute(createContext({}, {
      clientProvider: () => client,
    }));

    expect(createSessionCalls).toEqual([
      {
        model: undefined,
        additionalInstructions: undefined,
        tools: undefined,
      },
    ]);
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

type AskUserTestState = BaseState & AskUserWaitState;

function createAskUserContext(
  overrides: Partial<AskUserTestState> = {},
): ExecutionContext<AskUserTestState> {
  return {
    state: {
      executionId: "exec-ask",
      lastUpdated: new Date(0).toISOString(),
      outputs: {},
      ...overrides,
    },
    config: {},
    errors: [],
  };
}

describe("askUserNode multiSelect and dslAskUser fields", () => {
  test("passes multiSelect through to event data when true", async () => {
    const node = askUserNode<AskUserTestState>({
      id: "ask-multi",
      options: {
        question: "Pick frameworks",
        header: "Multi-select",
        options: [
          { label: "React" },
          { label: "Vue" },
        ],
        multiSelect: true,
      },
    });

    const result = await node.execute(createAskUserContext());
    const signal = result.signals?.[0];
    expect(signal).toBeDefined();
    const data = signal!.data as unknown as AskUserQuestionEventData;
    expect(data.multiSelect).toBe(true);
    expect(data.question).toBe("Pick frameworks");
    expect(data.header).toBe("Multi-select");
    expect(data.options).toHaveLength(2);
  });

  test("multiSelect defaults to undefined when not provided", async () => {
    const node = askUserNode<AskUserTestState>({
      id: "ask-single",
      options: {
        question: "Pick one",
        options: [{ label: "A" }],
      },
    });

    const result = await node.execute(createAskUserContext());
    const data = result.signals?.[0]?.data as unknown as AskUserQuestionEventData;
    expect(data.multiSelect).toBeUndefined();
  });

  test("multiSelect is resolved from dynamic options function", async () => {
    const node = askUserNode<AskUserTestState>({
      id: "ask-dynamic",
      options: (_state) => ({
        question: "Dynamic question",
        multiSelect: true,
        options: [{ label: "X" }],
      }),
    });

    const result = await node.execute(createAskUserContext());
    const data = result.signals?.[0]?.data as unknown as AskUserQuestionEventData;
    expect(data.multiSelect).toBe(true);
  });

  test("emits event data with multiSelect via ctx.emit", async () => {
    let emittedData: Record<string, unknown> | undefined;
    const node = askUserNode<AskUserTestState>({
      id: "ask-emit",
      options: {
        question: "Choose",
        multiSelect: true,
      },
    });

    const ctx = createAskUserContext();
    ctx.emit = (_type: string, data?: Record<string, unknown>) => {
      emittedData = data;
    };

    await node.execute(ctx);
    expect(emittedData).toBeDefined();
    expect((emittedData as unknown as AskUserQuestionEventData).multiSelect).toBe(true);
  });

  test("AskUserQuestionEventData accepts dslAskUser field", () => {
    const data: AskUserQuestionEventData = {
      requestId: "req-1",
      question: "Test",
      nodeId: "node-1",
      dslAskUser: true,
    };
    expect(data.dslAskUser).toBe(true);
  });

  test("AskUserQuestionEventData accepts both multiSelect and dslAskUser", () => {
    const data: AskUserQuestionEventData = {
      requestId: "req-2",
      question: "Test",
      nodeId: "node-2",
      multiSelect: true,
      dslAskUser: true,
    };
    expect(data.multiSelect).toBe(true);
    expect(data.dslAskUser).toBe(true);
  });

  test("sets wait state in stateUpdate", async () => {
    const node = askUserNode<AskUserTestState>({
      id: "ask-wait",
      options: {
        question: "Waiting",
        multiSelect: false,
      },
    });

    const result = await node.execute(createAskUserContext());
    expect(result.stateUpdate?.__waitingForInput).toBe(true);
    expect(result.stateUpdate?.__waitNodeId).toBe("ask-wait");
    expect(result.stateUpdate?.__askUserRequestId).toBeDefined();
  });
});
