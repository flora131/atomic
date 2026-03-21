import { describe, expect, test, mock } from "bun:test";
import { subagentNode } from "@/services/workflows/graph/nodes/subagent.ts";
import type {
  BaseState,
  ExecutionContext,
  SubagentStreamResult,
} from "@/services/workflows/graph/types.ts";
import type {
  AgentMessage,
  Session,
  SessionConfig,
} from "@/services/agents/types.ts";

// ---------------------------------------------------------------------------
// Test State
// ---------------------------------------------------------------------------

interface TestState extends BaseState {
  specDoc?: string;
  customField?: string;
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockSession(
  response: string,
  id = "session-test",
): { session: Session; destroyCalls: number[] } {
  const tracker = { destroyCalls: [] as number[] };
  const session: Session = {
    id,
    send: async () => ({ type: "text" as const, content: response }),
    stream: async function* (
      _message: string,
      _options?: { agent?: string; abortSignal?: AbortSignal },
    ) {
      yield { type: "text" as const, content: response } as AgentMessage;
    },
    summarize: async () => {},
    getContextUsage: async () => ({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 100000,
      usagePercentage: 0.15,
    }),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {
      tracker.destroyCalls.push(Date.now());
    }),
  };
  return { session, destroyCalls: tracker.destroyCalls };
}

function createMultiChunkSession(
  chunks: string[],
  id = "session-multi",
): { session: Session; destroyCalls: number[] } {
  const tracker = { destroyCalls: [] as number[] };
  const session: Session = {
    id,
    send: async () => ({ type: "text" as const, content: chunks.join("") }),
    stream: async function* (
      _message: string,
      _options?: { agent?: string; abortSignal?: AbortSignal },
    ) {
      for (const chunk of chunks) {
        yield { type: "text" as const, content: chunk } as AgentMessage;
      }
    },
    summarize: async () => {},
    getContextUsage: async () => ({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 100000,
      usagePercentage: 0.15,
    }),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {
      tracker.destroyCalls.push(Date.now());
    }),
  };
  return { session, destroyCalls: tracker.destroyCalls };
}

function createFailingSession(
  errorMessage: string,
): { session: Session; destroyCalls: number[] } {
  const tracker = { destroyCalls: [] as number[] };
  const session: Session = {
    id: "session-fail",
    send: async () => {
      throw new Error(errorMessage);
    },
    stream: async function* () {
      throw new Error(errorMessage);
    },
    summarize: async () => {},
    getContextUsage: async () => ({
      inputTokens: 0,
      outputTokens: 0,
      maxTokens: 100000,
      usagePercentage: 0,
    }),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {
      tracker.destroyCalls.push(Date.now());
    }),
  };
  return { session, destroyCalls: tracker.destroyCalls };
}

function createContext(
  overrides: Partial<TestState> = {},
  runtimeOverrides: Partial<
    NonNullable<ExecutionContext<TestState>["config"]["runtime"]>
  > = {},
  ctxOverrides: Partial<ExecutionContext<TestState>> = {},
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
    ...ctxOverrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("subagentNode session-based execution", () => {
  test("throws when createSession is not provided in runtime", async () => {
    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "Plan the work",
    });

    await expect(node.execute(createContext())).rejects.toThrow(
      /createSession not initialized/,
    );
  });

  test("creates a session and streams the task prompt", async () => {
    const { session } = createMockSession("Here is the plan");
    const createSessionCalls: (SessionConfig | undefined)[] = [];
    const streamedMessages: string[] = [];

    const spySession: Session = {
      ...session,
      stream: async function* (
        message: string,
        _options?: { agent?: string; abortSignal?: AbortSignal },
      ) {
        streamedMessages.push(message);
        yield { type: "text" as const, content: "Here is the plan" } as AgentMessage;
      },
    };

    const createSession = async (config?: SessionConfig) => {
      createSessionCalls.push(config);
      return spySession;
    };

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "Plan the work",
    });

    await node.execute(createContext({}, { createSession }));

    expect(createSessionCalls).toHaveLength(1);
    expect(streamedMessages).toEqual(["Plan the work"]);
  });

  test("passes model and tools to session config", async () => {
    const { session } = createMockSession("done");
    const createSessionCalls: (SessionConfig | undefined)[] = [];

    const createSession = async (config?: SessionConfig) => {
      createSessionCalls.push(config);
      return session;
    };

    const node = subagentNode<TestState>({
      id: "analyzer",
      agentName: "analyzer",
      task: "Analyze code",
      model: "sonnet",
      tools: ["read_file", "write_file"],
    });

    await node.execute(createContext({}, { createSession }));

    expect(createSessionCalls[0]).toEqual({
      model: "sonnet",
      tools: ["read_file", "write_file"],
    });
  });

  test("falls back to context model when config model is not set", async () => {
    const { session } = createMockSession("done");
    const createSessionCalls: (SessionConfig | undefined)[] = [];

    const createSession = async (config?: SessionConfig) => {
      createSessionCalls.push(config);
      return session;
    };

    const node = subagentNode<TestState>({
      id: "agent",
      agentName: "worker",
      task: "do work",
    });

    await node.execute(
      createContext({}, { createSession }, { model: "haiku" }),
    );

    expect(createSessionCalls[0]?.model).toBe("haiku");
  });

  test("merges sessionConfig overrides into session creation", async () => {
    const { session } = createMockSession("done");
    const createSessionCalls: (SessionConfig | undefined)[] = [];

    const createSession = async (config?: SessionConfig) => {
      createSessionCalls.push(config);
      return session;
    };

    const node = subagentNode<TestState>({
      id: "reviewer",
      agentName: "reviewer",
      task: "Review the code",
      model: "opus",
      sessionConfig: {
        additionalInstructions: "Be thorough",
        maxTurns: 5,
      },
    });

    await node.execute(createContext({}, { createSession }));

    expect(createSessionCalls[0]).toEqual({
      model: "opus",
      tools: undefined,
      additionalInstructions: "Be thorough",
      maxTurns: 5,
    });
  });

  test("resolves dynamic task from state", async () => {
    const { session } = createMockSession("planned");
    const streamedMessages: string[] = [];

    const spySession: Session = {
      ...session,
      stream: async function* (
        message: string,
        _options?: { agent?: string; abortSignal?: AbortSignal },
      ) {
        streamedMessages.push(message);
        yield { type: "text" as const, content: "planned" } as AgentMessage;
      },
    };

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: (state) => `Plan: ${state.specDoc}`,
    });

    await node.execute(
      createContext({ specDoc: "Build auth module" }, {
        createSession: async () => spySession,
      }),
    );

    expect(streamedMessages).toEqual(["Plan: Build auth module"]);
  });

  test("accumulates multi-chunk streaming responses", async () => {
    const { session } = createMultiChunkSession(["chunk1-", "chunk2-", "chunk3"]);

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "plan",
      outputMapper: (result) => ({ specDoc: result.output }),
    });

    const result = await node.execute(
      createContext({}, { createSession: async () => session }),
    );

    expect(result.stateUpdate?.specDoc).toBe("chunk1-chunk2-chunk3");
  });

  test("applies custom outputMapper with result and state", async () => {
    const { session } = createMockSession("raw output");

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "plan",
      outputMapper: (result, state) => ({
        specDoc: `${result.output} (exec: ${state.executionId})`,
      }),
    });

    const result = await node.execute(
      createContext({}, { createSession: async () => session }),
    );

    expect(result.stateUpdate?.specDoc).toBe("raw output (exec: exec-1)");
  });

  test("provides well-formed SubagentStreamResult to outputMapper", async () => {
    const { session } = createMockSession("response text");
    let capturedResult: SubagentStreamResult | undefined;

    const node = subagentNode<TestState>({
      id: "test-node",
      agentName: "test-agent",
      task: "do something",
      outputMapper: (result) => {
        capturedResult = result;
        return { specDoc: result.output };
      },
    });

    await node.execute(
      createContext({}, { createSession: async () => session }),
    );

    expect(capturedResult).toBeDefined();
    expect(capturedResult!.agentId).toBe("test-node-exec-1");
    expect(capturedResult!.success).toBe(true);
    expect(capturedResult!.output).toBe("response text");
    expect(capturedResult!.toolUses).toBe(0);
    expect(capturedResult!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("falls back to default outputs mapping when no outputMapper", async () => {
    const { session } = createMockSession("default output");

    const node = subagentNode<TestState>({
      id: "my-node",
      agentName: "agent",
      task: "work",
    });

    const result = await node.execute(
      createContext({}, { createSession: async () => session }),
    );

    expect(result.stateUpdate?.outputs?.["my-node"]).toBe("default output");
  });

  test("destroys session after successful execution", async () => {
    const { session, destroyCalls } = createMockSession("done");

    const node = subagentNode<TestState>({
      id: "agent",
      agentName: "agent",
      task: "work",
    });

    await node.execute(
      createContext({}, { createSession: async () => session }),
    );

    expect(destroyCalls).toHaveLength(1);
  });

  test("destroys session after execution error", async () => {
    const { session, destroyCalls } = createFailingSession("Stream broke");

    const node = subagentNode<TestState>({
      id: "agent",
      agentName: "agent",
      task: "work",
    });

    await expect(
      node.execute(
        createContext({}, { createSession: async () => session }),
      ),
    ).rejects.toThrow(/session failed.*Stream broke/);

    expect(destroyCalls).toHaveLength(1);
  });

  test("uses destroySession from runtime when available", async () => {
    const { session } = createMockSession("done");
    const destroySessionCalls: Session[] = [];

    const destroySession = async (s: Session) => {
      destroySessionCalls.push(s);
    };

    const node = subagentNode<TestState>({
      id: "agent",
      agentName: "agent",
      task: "work",
    });

    await node.execute(
      createContext({}, {
        createSession: async () => session,
        destroySession,
      }),
    );

    expect(destroySessionCalls).toHaveLength(1);
    expect(destroySessionCalls[0]!.id).toBe("session-test");
  });

  test("swallows session destroy errors", async () => {
    const { session } = createMockSession("done");
    const failingDestroy = async () => {
      throw new Error("Destroy failed");
    };

    const node = subagentNode<TestState>({
      id: "agent",
      agentName: "agent",
      task: "work",
    });

    // Should not throw despite destroy failure
    const result = await node.execute(
      createContext({}, {
        createSession: async () => session,
        destroySession: failingDestroy,
      }),
    );

    expect(result.stateUpdate).toBeDefined();
  });

  test("re-throws abort-induced errors without wrapping", async () => {
    const abortController = new AbortController();
    const abortError = new Error("Aborted");

    const session: Session = {
      id: "session-abort",
      send: async () => ({ type: "text" as const, content: "" }),
      stream: async function* () {
        abortController.abort();
        throw abortError;
      },
      summarize: async () => {},
      getContextUsage: async () => ({
        inputTokens: 0,
        outputTokens: 0,
        maxTokens: 100000,
        usagePercentage: 0,
      }),
      getSystemToolsTokens: () => 0,
      destroy: async () => {},
    };

    const node = subagentNode<TestState>({
      id: "agent",
      agentName: "agent",
      task: "work",
    });

    const error = await node
      .execute(
        createContext(
          {},
          { createSession: async () => session },
          { abortSignal: abortController.signal },
        ),
      )
      .catch((e: unknown) => e);

    // The original abort error is re-thrown unwrapped
    expect(error).toBe(abortError);
  });

  test("wraps non-abort errors with agent name context", async () => {
    const { session } = createFailingSession("Connection lost");

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "plan",
    });

    await expect(
      node.execute(
        createContext({}, { createSession: async () => session }),
      ),
    ).rejects.toThrow('Sub-agent "planner" session failed: Connection lost');
  });

  test("has type 'agent' and correct metadata", () => {
    const node = subagentNode<TestState>({
      id: "my-agent",
      agentName: "planner",
      task: "plan",
      name: "Custom Planner",
      description: "Plans the work",
    });

    expect(node.id).toBe("my-agent");
    expect(node.type).toBe("agent");
    expect(node.name).toBe("Custom Planner");
    expect(node.description).toBe("Plans the work");
  });

  test("uses agentName as default name when name not provided", () => {
    const node = subagentNode<TestState>({
      id: "my-agent",
      agentName: "planner",
      task: "plan",
    });

    expect(node.name).toBe("planner");
    expect(node.description).toBe("Sub-agent: planner");
  });

  test("passes retry config through", () => {
    const retry = { maxAttempts: 5, backoffMs: 2000, backoffMultiplier: 3 };
    const node = subagentNode<TestState>({
      id: "agent",
      agentName: "agent",
      task: "work",
      retry,
    });

    expect(node.retry).toBe(retry);
  });
});
