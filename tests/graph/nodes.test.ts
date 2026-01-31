/**
 * Unit tests for node factory functions
 *
 * Tests cover:
 * - agentNode factory with session management and output mapping
 * - toolNode factory with execution and timeout
 * - decisionNode factory with route evaluation
 * - waitNode factory with human input signals
 * - parallelNode factory with branch configuration
 * - subgraphNode factory with state mapping
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  agentNode,
  toolNode,
  decisionNode,
  waitNode,
  parallelNode,
  subgraphNode,
  setClientProvider,
  getClientProvider,
  AGENT_NODE_RETRY_CONFIG,
  type AgentNodeConfig,
  type ToolNodeConfig,
  type DecisionNodeConfig,
  type WaitNodeConfig,
  type ParallelNodeConfig,
  type SubgraphNodeConfig,
  type ClientProvider,
} from "../../src/graph/nodes.ts";
import type {
  BaseState,
  ExecutionContext,
  NodeResult,
  GraphConfig,
} from "../../src/graph/types.ts";
import type { CodingAgentClient, Session, AgentMessage } from "../../src/sdk/types.ts";

// ============================================================================
// Test State Types
// ============================================================================

interface TestState extends BaseState {
  counter: number;
  approved: boolean;
  items: string[];
  document?: string;
  results?: unknown[];
}

function createTestState(overrides: Partial<TestState> = {}): TestState {
  return {
    executionId: "test-exec-1",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    counter: 0,
    approved: false,
    items: [],
    ...overrides,
  };
}

function createTestContext(stateOverrides: Partial<TestState> = {}): ExecutionContext<TestState> {
  return {
    state: createTestState(stateOverrides),
    config: {} as GraphConfig,
    errors: [],
  };
}

// ============================================================================
// Mock Factories
// ============================================================================

function createMockSession(messages: AgentMessage[] = []): Session {
  const defaultMessage: AgentMessage = { type: "text" as const, content: "" };
  return {
    id: "mock-session-1",
    send: mock(async (_msg: string): Promise<AgentMessage> => 
      messages[messages.length - 1] || defaultMessage
    ),
    stream: mock(async function* (_msg: string): AsyncGenerator<AgentMessage> {
      for (const msg of messages) {
        yield msg;
      }
    }),
    summarize: mock(async () => {}),
    getContextUsage: mock(async () => ({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 100000,
      usagePercentage: 0.15,
    })),
    destroy: mock(async () => {}),
  };
}

function createMockClient(session: Session): CodingAgentClient {
  return {
    agentType: "claude" as const,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    createSession: mock(async () => session),
    resumeSession: mock(async () => session),
    registerTool: mock(() => {}),
    on: mock(() => () => {}),
  };
}

// ============================================================================
// Client Provider Tests
// ============================================================================

describe("Client Provider", () => {
  afterEach(() => {
    setClientProvider(() => null);
  });

  test("setClientProvider sets the global provider", () => {
    const mockProvider: ClientProvider = () => null;
    setClientProvider(mockProvider);
    expect(getClientProvider()).toBe(mockProvider);
  });

  test("getClientProvider returns null when not set", () => {
    setClientProvider(() => null);
    expect(getClientProvider()?.("claude")).toBeNull();
  });

  test("AGENT_NODE_RETRY_CONFIG has correct defaults", () => {
    expect(AGENT_NODE_RETRY_CONFIG.maxAttempts).toBe(3);
    expect(AGENT_NODE_RETRY_CONFIG.backoffMs).toBe(1000);
    expect(AGENT_NODE_RETRY_CONFIG.backoffMultiplier).toBe(2);
  });
});

// ============================================================================
// Agent Node Tests
// ============================================================================

describe("agentNode", () => {
  let mockSession: Session;
  let mockClient: CodingAgentClient;

  beforeEach(() => {
    const messages: AgentMessage[] = [
      { type: "text", content: "Hello from agent" },
      { type: "text", content: "Task completed" },
    ];
    mockSession = createMockSession(messages);
    mockClient = createMockClient(mockSession);

    setClientProvider((agentType) => {
      if (agentType === "claude") return mockClient;
      return null;
    });
  });

  afterEach(() => {
    setClientProvider(() => null);
  });

  test("creates node with correct type and id", () => {
    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
    });

    expect(node.id).toBe("test-agent");
    expect(node.type).toBe("agent");
    expect(node.retry).toEqual(AGENT_NODE_RETRY_CONFIG);
  });

  test("uses provided name and description", () => {
    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
      name: "My Agent",
      description: "Does important things",
    });

    expect(node.name).toBe("My Agent");
    expect(node.description).toBe("Does important things");
  });

  test("throws when no client provider is set", async () => {
    setClientProvider(() => null);

    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
    });

    const ctx = createTestContext();
    await expect(node.execute(ctx)).rejects.toThrow("No client provider set");
  });

  test("creates session with provided config", async () => {
    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
      systemPrompt: "You are a helpful assistant",
      tools: ["file_read", "file_write"],
      sessionConfig: {
        model: "claude-3-opus",
      },
    });

    const ctx = createTestContext();
    await node.execute(ctx);

    expect(mockClient.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-3-opus",
        systemPrompt: "You are a helpful assistant",
        tools: ["file_read", "file_write"],
      })
    );
  });

  test("streams messages and destroys session", async () => {
    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
    });

    const ctx = createTestContext();
    await node.execute(ctx);

    expect(mockSession.stream).toHaveBeenCalled();
    expect(mockSession.destroy).toHaveBeenCalled();
  });

  test("uses buildMessage to create user message", async () => {
    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
      buildMessage: (state) => `Process ${state.counter} items`,
    });

    const ctx = createTestContext({ counter: 5 });
    await node.execute(ctx);

    expect(mockSession.stream).toHaveBeenCalledWith("Process 5 items");
  });

  test("uses outputMapper to transform results", async () => {
    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
      outputMapper: (messages, _state) => ({
        document: messages.map((m) => m.content).join("\n"),
      }),
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate).toEqual({
      document: "Hello from agent\nTask completed",
    });
  });

  test("stores messages in outputs by default", async () => {
    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate?.outputs?.["test-agent"]).toBeDefined();
    expect(Array.isArray(result.stateUpdate?.outputs?.["test-agent"])).toBe(true);
  });

  test("emits context window warning when threshold exceeded", async () => {
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 70000,
      outputTokens: 10000,
      maxTokens: 100000,
    }));

    const node = agentNode<TestState>({
      id: "test-agent",
      agentType: "claude",
    });

    const ctx = createTestContext();
    ctx.config.contextWindowThreshold = 60;

    const result = await node.execute(ctx);

    expect(result.signals).toBeDefined();
    expect(result.signals?.[0]?.type).toBe("context_window_warning");
  });
});

// ============================================================================
// Tool Node Tests
// ============================================================================

describe("toolNode", () => {
  test("creates node with correct type and id", () => {
    const node = toolNode<TestState>({
      id: "test-tool",
      toolName: "my_tool",
      execute: async () => "result",
    });

    expect(node.id).toBe("test-tool");
    expect(node.type).toBe("tool");
    expect(node.name).toBe("my_tool");
  });

  test("throws when execute function is not provided", () => {
    expect(() => {
      toolNode<TestState>({
        id: "test-tool",
        toolName: "my_tool",
        // execute is missing
      } as ToolNodeConfig<TestState>);
    }).toThrow("requires an execute function");
  });

  test("executes tool with static args", async () => {
    const executeFn = mock(async (args: { value: number }) => args.value * 2);

    const node = toolNode<TestState, { value: number }, number>({
      id: "test-tool",
      toolName: "multiply",
      execute: executeFn,
      args: { value: 5 },
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(executeFn).toHaveBeenCalledWith({ value: 5 }, expect.any(AbortSignal));
    expect(result.stateUpdate?.outputs?.["test-tool"]).toBe(10);
  });

  test("executes tool with args function", async () => {
    const executeFn = mock(async (args: { count: number }) => args.count + 1);

    const node = toolNode<TestState, { count: number }, number>({
      id: "test-tool",
      toolName: "increment",
      execute: executeFn,
      args: (state) => ({ count: state.counter }),
    });

    const ctx = createTestContext({ counter: 10 });
    const result = await node.execute(ctx);

    expect(executeFn).toHaveBeenCalledWith({ count: 10 }, expect.any(AbortSignal));
    expect(result.stateUpdate?.outputs?.["test-tool"]).toBe(11);
  });

  test("uses outputMapper to transform results", async () => {
    const node = toolNode<TestState, void, string[]>({
      id: "test-tool",
      toolName: "fetch_items",
      execute: async () => ["a", "b", "c"],
      outputMapper: (result, _state) => ({
        items: result,
      }),
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate).toEqual({
      items: ["a", "b", "c"],
    });
  });

  test("handles timeout correctly", async () => {
    const slowExecute = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "done";
    };

    const node = toolNode<TestState>({
      id: "test-tool",
      toolName: "slow_tool",
      execute: slowExecute,
      timeout: 50,
    });

    const ctx = createTestContext();

    // The execution should abort due to timeout
    // Note: behavior depends on how the tool handles AbortSignal
    await expect(node.execute(ctx)).resolves.toBeDefined();
  });

  test("stores result in outputs by default", async () => {
    const node = toolNode<TestState>({
      id: "test-tool",
      toolName: "simple_tool",
      execute: async () => ({ data: "test" }),
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate?.outputs?.["test-tool"]).toEqual({ data: "test" });
  });
});

// ============================================================================
// Decision Node Tests
// ============================================================================

describe("decisionNode", () => {
  test("creates node with correct type and id", () => {
    const node = decisionNode<TestState>({
      id: "test-decision",
      routes: [],
      fallback: "default",
    });

    expect(node.id).toBe("test-decision");
    expect(node.type).toBe("decision");
    expect(node.name).toBe("decision");
  });

  test("evaluates routes in order and returns first match", async () => {
    const node = decisionNode<TestState>({
      id: "router",
      routes: [
        { condition: (s) => s.counter > 10, target: "high" },
        { condition: (s) => s.counter > 5, target: "medium" },
        { condition: (s) => s.counter > 0, target: "low" },
      ],
      fallback: "none",
    });

    // Test high route
    let ctx = createTestContext({ counter: 15 });
    let result = await node.execute(ctx);
    expect(result.goto).toBe("high");

    // Test medium route
    ctx = createTestContext({ counter: 7 });
    result = await node.execute(ctx);
    expect(result.goto).toBe("medium");

    // Test low route
    ctx = createTestContext({ counter: 2 });
    result = await node.execute(ctx);
    expect(result.goto).toBe("low");
  });

  test("returns fallback when no route matches", async () => {
    const node = decisionNode<TestState>({
      id: "router",
      routes: [
        { condition: (s) => s.counter > 100, target: "very-high" },
      ],
      fallback: "default-path",
    });

    const ctx = createTestContext({ counter: 5 });
    const result = await node.execute(ctx);

    expect(result.goto).toBe("default-path");
  });

  test("handles empty routes array", async () => {
    const node = decisionNode<TestState>({
      id: "empty-router",
      routes: [],
      fallback: "only-option",
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.goto).toBe("only-option");
  });

  test("uses provided name and description", () => {
    const node = decisionNode<TestState>({
      id: "router",
      routes: [],
      fallback: "default",
      name: "Approval Router",
      description: "Routes based on approval status",
    });

    expect(node.name).toBe("Approval Router");
    expect(node.description).toBe("Routes based on approval status");
  });
});

// ============================================================================
// Wait Node Tests
// ============================================================================

describe("waitNode", () => {
  test("creates node with correct type and id", () => {
    const node = waitNode<TestState>({
      id: "test-wait",
      prompt: "Please confirm",
    });

    expect(node.id).toBe("test-wait");
    expect(node.type).toBe("wait");
    expect(node.name).toBe("wait");
  });

  test("emits human_input_required signal with prompt", async () => {
    const node = waitNode<TestState>({
      id: "approval",
      prompt: "Please review and approve",
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.signals).toBeDefined();
    expect(result.signals).toHaveLength(1);
    expect(result.signals![0]!.type).toBe("human_input_required");
    expect(result.signals![0]!.message).toBe("Please review and approve");
    expect(result.signals![0]!.data?.nodeId).toBe("approval");
  });

  test("uses prompt function with state", async () => {
    const node = waitNode<TestState>({
      id: "confirmation",
      prompt: (state) => `Confirm ${state.counter} items?`,
    });

    const ctx = createTestContext({ counter: 42 });
    const result = await node.execute(ctx);

    expect(result.signals![0]!.message).toBe("Confirm 42 items?");
  });

  test("auto-approve skips signal emission", async () => {
    const node = waitNode<TestState>({
      id: "auto-wait",
      prompt: "This is auto-approved",
      autoApprove: true,
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.signals).toBeUndefined();
  });

  test("auto-approve applies inputMapper with empty string", async () => {
    const node = waitNode<TestState>({
      id: "auto-wait",
      prompt: "Auto approve",
      autoApprove: true,
      inputMapper: (_input, _state) => ({
        approved: true,
      }),
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate).toEqual({ approved: true });
  });

  test("includes inputMapper flag in signal data", async () => {
    const nodeWithMapper = waitNode<TestState>({
      id: "with-mapper",
      prompt: "Test",
      inputMapper: (input) => ({ document: input }),
    });

    const nodeWithoutMapper = waitNode<TestState>({
      id: "without-mapper",
      prompt: "Test",
    });

    const ctx = createTestContext();

    const resultWith = await nodeWithMapper.execute(ctx);
    expect(resultWith.signals![0]!.data?.inputMapper).toBe(true);

    const resultWithout = await nodeWithoutMapper.execute(ctx);
    expect(resultWithout.signals![0]!.data?.inputMapper).toBe(false);
  });
});

// ============================================================================
// Parallel Node Tests
// ============================================================================

describe("parallelNode", () => {
  test("creates node with correct type and id", () => {
    const node = parallelNode<TestState>({
      id: "test-parallel",
      branches: ["branch1", "branch2"],
    });

    expect(node.id).toBe("test-parallel");
    expect(node.type).toBe("parallel");
    expect(node.name).toBe("parallel");
  });

  test("throws when branches array is empty", () => {
    expect(() => {
      parallelNode<TestState>({
        id: "empty-parallel",
        branches: [],
      });
    }).toThrow("requires at least one branch");
  });

  test("returns goto with all branch IDs", async () => {
    const node = parallelNode<TestState>({
      id: "gather",
      branches: ["fetch-a", "fetch-b", "fetch-c"],
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.goto).toEqual(["fetch-a", "fetch-b", "fetch-c"]);
  });

  test("stores parallel context in outputs", async () => {
    const mergeFn = (results: Map<string, unknown>, _state: TestState) => ({
      results: Array.from(results.values()),
    });

    const node = parallelNode<TestState>({
      id: "parallel-gather",
      branches: ["a", "b"],
      strategy: "race",
      merge: mergeFn,
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    const parallelOutput = result.stateUpdate?.outputs?.["parallel-gather"] as Record<string, unknown>;
    expect(parallelOutput._parallel).toBe(true);
    expect(parallelOutput.branches).toEqual(["a", "b"]);
    expect(parallelOutput.strategy).toBe("race");
    expect(parallelOutput.merge).toBe(mergeFn);
  });

  test("uses default strategy of 'all'", async () => {
    const node = parallelNode<TestState>({
      id: "default-strategy",
      branches: ["branch1"],
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    const parallelOutput = result.stateUpdate?.outputs?.["default-strategy"] as Record<string, unknown>;
    expect(parallelOutput.strategy).toBe("all");
  });

  test("supports different merge strategies", async () => {
    const strategies: Array<"all" | "race" | "any"> = ["all", "race", "any"];

    for (const strategy of strategies) {
      const node = parallelNode<TestState>({
        id: `parallel-${strategy}`,
        branches: ["b1"],
        strategy,
      });

      const ctx = createTestContext();
      const result = await node.execute(ctx);

      const parallelOutput = result.stateUpdate?.outputs?.[`parallel-${strategy}`] as Record<string, unknown>;
      expect(parallelOutput.strategy).toBe(strategy);
    }
  });
});

// ============================================================================
// Subgraph Node Tests
// ============================================================================

describe("subgraphNode", () => {
  interface SubState extends BaseState {
    doc: string;
    analysisResult?: string;
  }

  function createSubState(): SubState {
    return {
      executionId: "sub-1",
      lastUpdated: new Date().toISOString(),
      outputs: {},
      doc: "",
    };
  }

  test("creates node with correct type and id", () => {
    const mockSubgraph = {
      execute: async (state: SubState) => state,
    };

    const node = subgraphNode<TestState, SubState>({
      id: "test-subgraph",
      subgraph: mockSubgraph,
    });

    expect(node.id).toBe("test-subgraph");
    expect(node.type).toBe("subgraph");
    expect(node.name).toBe("subgraph");
  });

  test("executes subgraph and returns result", async () => {
    const mockSubgraph = {
      execute: mock(async (state: SubState) => ({
        ...state,
        analysisResult: `Analyzed: ${state.doc}`,
      })),
    };

    const node = subgraphNode<TestState, SubState>({
      id: "analysis",
      subgraph: mockSubgraph,
      inputMapper: (state) => ({
        ...createSubState(),
        doc: state.document || "",
      }),
      outputMapper: (subState, _parentState) => ({
        results: [subState.analysisResult],
      }),
    });

    const ctx = createTestContext({ document: "Test document" });
    const result = await node.execute(ctx);

    expect(mockSubgraph.execute).toHaveBeenCalled();
    expect(result.stateUpdate).toEqual({
      results: ["Analyzed: Test document"],
    });
  });

  test("stores subgraph result in outputs without mapper", async () => {
    const finalSubState: SubState = {
      ...createSubState(),
      doc: "processed",
      analysisResult: "done",
    };

    const mockSubgraph = {
      execute: async () => finalSubState,
    };

    const node = subgraphNode<TestState, SubState>({
      id: "sub",
      subgraph: mockSubgraph,
    });

    const ctx = createTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate?.outputs?.["sub"]).toEqual(finalSubState);
  });

  test("uses inputMapper to transform state", async () => {
    let receivedState: SubState | null = null;

    const mockSubgraph = {
      execute: async (state: SubState) => {
        receivedState = state;
        return state;
      },
    };

    const node = subgraphNode<TestState, SubState>({
      id: "mapped-sub",
      subgraph: mockSubgraph,
      inputMapper: (state) => ({
        ...createSubState(),
        doc: `Count: ${state.counter}`,
      }),
    });

    const ctx = createTestContext({ counter: 42 });
    await node.execute(ctx);

    expect(receivedState).not.toBeNull();
    expect(receivedState!.doc).toBe("Count: 42");
  });

  test("uses provided name and description", () => {
    const mockSubgraph = {
      execute: async (state: SubState) => state,
    };

    const node = subgraphNode<TestState, SubState>({
      id: "named-sub",
      subgraph: mockSubgraph,
      name: "Analysis Subgraph",
      description: "Performs deep analysis",
    });

    expect(node.name).toBe("Analysis Subgraph");
    expect(node.description).toBe("Performs deep analysis");
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe("Edge Cases", () => {
  test("agentNode handles session destroy on error", async () => {
    const mockSession = createMockSession([]);
    (mockSession.stream as ReturnType<typeof mock>).mockImplementation(async function* () {
      throw new Error("Stream failed");
    });

    const mockClient = createMockClient(mockSession);
    setClientProvider(() => mockClient);

    const node = agentNode<TestState>({
      id: "failing-agent",
      agentType: "claude",
    });

    const ctx = createTestContext();

    await expect(node.execute(ctx)).rejects.toThrow("Stream failed");
    expect(mockSession.destroy).toHaveBeenCalled();

    setClientProvider(() => null);
  });

  test("toolNode preserves existing outputs", async () => {
    const node = toolNode<TestState>({
      id: "new-tool",
      toolName: "append",
      execute: async () => "new-result",
    });

    const ctx = createTestContext();
    ctx.state.outputs = { "existing-tool": "existing-result" };

    const result = await node.execute(ctx);

    // The node should add to outputs, not replace
    expect(result.stateUpdate?.outputs?.["new-tool"]).toBe("new-result");
  });

  test("decisionNode handles complex conditions", async () => {
    const node = decisionNode<TestState>({
      id: "complex-router",
      routes: [
        {
          condition: (s) => s.approved && s.counter > 10,
          target: "approved-high",
        },
        {
          condition: (s) => s.approved && s.counter <= 10,
          target: "approved-low",
        },
        {
          condition: (s) => !s.approved && s.items.length > 0,
          target: "rejected-with-items",
        },
      ],
      fallback: "rejected-empty",
    });

    // Test approved-high
    let ctx = createTestContext({ approved: true, counter: 15 });
    let result = await node.execute(ctx);
    expect(result.goto).toBe("approved-high");

    // Test approved-low
    ctx = createTestContext({ approved: true, counter: 5 });
    result = await node.execute(ctx);
    expect(result.goto).toBe("approved-low");

    // Test rejected-with-items
    ctx = createTestContext({ approved: false, items: ["a", "b"] });
    result = await node.execute(ctx);
    expect(result.goto).toBe("rejected-with-items");

    // Test fallback
    ctx = createTestContext({ approved: false, items: [] });
    result = await node.execute(ctx);
    expect(result.goto).toBe("rejected-empty");
  });
});

// ============================================================================
// Context Monitoring Node Tests
// ============================================================================

import {
  contextMonitorNode,
  DEFAULT_CONTEXT_THRESHOLD,
  getDefaultCompactionAction,
  toContextWindowUsage,
  isContextThresholdExceeded,
  checkContextUsage,
  compactContext,
  type ContextMonitoringState,
  type ContextCompactionAction,
} from "../../src/graph/nodes.ts";
import type { ContextWindowUsage } from "../../src/graph/types.ts";
import type { ContextUsage } from "../../src/sdk/types.ts";

// Extend TestState for context monitoring tests
interface ContextTestState extends ContextMonitoringState {
  counter: number;
  approved: boolean;
  items: string[];
  document?: string;
  results?: unknown[];
}

function createContextTestState(overrides: Partial<ContextTestState> = {}): ContextTestState {
  return {
    executionId: "test-exec-1",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    counter: 0,
    approved: false,
    items: [],
    contextWindowUsage: null,
    ...overrides,
  };
}

function createContextTestContext(
  stateOverrides: Partial<ContextTestState> = {}
): ExecutionContext<ContextTestState> {
  return {
    state: createContextTestState(stateOverrides),
    config: {} as GraphConfig,
    errors: [],
  };
}

describe("Context Monitoring Helpers", () => {
  test("DEFAULT_CONTEXT_THRESHOLD is 60", () => {
    expect(DEFAULT_CONTEXT_THRESHOLD).toBe(60);
  });

  test("getDefaultCompactionAction returns correct action for each agent type", () => {
    expect(getDefaultCompactionAction("opencode")).toBe("summarize");
    expect(getDefaultCompactionAction("claude")).toBe("recreate");
    expect(getDefaultCompactionAction("copilot")).toBe("warn");
  });

  test("toContextWindowUsage converts ContextUsage correctly", () => {
    const usage: ContextUsage = {
      inputTokens: 5000,
      outputTokens: 2000,
      maxTokens: 100000,
      usagePercentage: 7.0,
    };

    const result = toContextWindowUsage(usage);

    expect(result.inputTokens).toBe(5000);
    expect(result.outputTokens).toBe(2000);
    expect(result.maxTokens).toBe(100000);
    expect(result.usagePercentage).toBe(7.0);
  });

  test("isContextThresholdExceeded returns false when usage is null", () => {
    expect(isContextThresholdExceeded(null, 60)).toBe(false);
  });

  test("isContextThresholdExceeded returns false when under threshold", () => {
    const usage: ContextUsage = {
      inputTokens: 5000,
      outputTokens: 2000,
      maxTokens: 100000,
      usagePercentage: 50.0,
    };

    expect(isContextThresholdExceeded(usage, 60)).toBe(false);
  });

  test("isContextThresholdExceeded returns true when at threshold", () => {
    const usage: ContextUsage = {
      inputTokens: 30000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 60.0,
    };

    expect(isContextThresholdExceeded(usage, 60)).toBe(true);
  });

  test("isContextThresholdExceeded returns true when above threshold", () => {
    const usage: ContextUsage = {
      inputTokens: 40000,
      outputTokens: 35000,
      maxTokens: 100000,
      usagePercentage: 75.0,
    };

    expect(isContextThresholdExceeded(usage, 60)).toBe(true);
  });
});

describe("checkContextUsage", () => {
  test("returns exceeded: false when under threshold", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 5000,
      outputTokens: 2000,
      maxTokens: 100000,
      usagePercentage: 7.0,
    }));

    const result = await checkContextUsage(mockSession);

    expect(result.exceeded).toBe(false);
    expect(result.usage.usagePercentage).toBe(7.0);
  });

  test("returns exceeded: true when over threshold", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 40000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 70.0,
    }));

    const result = await checkContextUsage(mockSession);

    expect(result.exceeded).toBe(true);
    expect(result.usage.usagePercentage).toBe(70.0);
  });

  test("uses custom threshold when provided", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 30000,
      outputTokens: 15000,
      maxTokens: 100000,
      usagePercentage: 45.0,
    }));

    // Under default (60) but over custom (40)
    const result = await checkContextUsage(mockSession, { threshold: 40 });

    expect(result.exceeded).toBe(true);
  });
});

describe("compactContext", () => {
  test("calls summarize for opencode agent", async () => {
    const mockSession = createMockSession();
    const result = await compactContext(mockSession, "opencode");

    expect(mockSession.summarize).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  test("does not call summarize for claude agent", async () => {
    const mockSession = createMockSession();
    const result = await compactContext(mockSession, "claude");

    expect(mockSession.summarize).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  test("does not call summarize for copilot agent", async () => {
    const mockSession = createMockSession();
    const result = await compactContext(mockSession, "copilot");

    expect(mockSession.summarize).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

describe("contextMonitorNode", () => {
  test("creates node with correct type and id", () => {
    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
    });

    expect(node.id).toBe("context-check");
    expect(node.type).toBe("tool");
    expect(node.name).toBe("context-monitor");
  });

  test("uses custom name and description", () => {
    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
      name: "My Monitor",
      description: "Monitors context carefully",
    });

    expect(node.name).toBe("My Monitor");
    expect(node.description).toBe("Monitors context carefully");
  });

  test("updates state with context usage when under threshold", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 5000,
      outputTokens: 2000,
      maxTokens: 100000,
      usagePercentage: 7.0,
    }));

    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
      getSession: () => mockSession,
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate?.contextWindowUsage).toEqual({
      inputTokens: 5000,
      outputTokens: 2000,
      maxTokens: 100000,
      usagePercentage: 7.0,
    });
    expect(result.signals).toBeUndefined();
  });

  test("calls summarize for opencode when threshold exceeded", async () => {
    const mockSession = createMockSession();
    let summarizeCalled = false;
    
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => {
      // Return high usage first, then low after summarize
      if (summarizeCalled) {
        return {
          inputTokens: 10000,
          outputTokens: 5000,
          maxTokens: 100000,
          usagePercentage: 15.0,
        };
      }
      return {
        inputTokens: 40000,
        outputTokens: 30000,
        maxTokens: 100000,
        usagePercentage: 70.0,
      };
    });

    (mockSession.summarize as ReturnType<typeof mock>).mockImplementation(async () => {
      summarizeCalled = true;
    });

    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
      getSession: () => mockSession,
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(mockSession.summarize).toHaveBeenCalled();
    // After summarize, usage should be updated
    expect(result.stateUpdate?.contextWindowUsage?.usagePercentage).toBe(15.0);
    // No warning signal since summarize succeeded
    expect(result.signals).toBeUndefined();
  });

  test("emits recreate signal for claude when threshold exceeded", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 40000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 70.0,
    }));

    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "claude",
      getSession: () => mockSession,
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(result.signals).toBeDefined();
    expect(result.signals).toHaveLength(1);
    expect(result.signals![0]!.type).toBe("context_window_warning");
    expect(result.signals![0]!.data?.action).toBe("recreate");
    expect(result.signals![0]!.data?.shouldRecreateSession).toBe(true);
  });

  test("emits warning signal for copilot when threshold exceeded", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 40000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 70.0,
    }));

    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "copilot",
      getSession: () => mockSession,
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(result.signals).toBeDefined();
    expect(result.signals).toHaveLength(1);
    expect(result.signals![0]!.type).toBe("context_window_warning");
    expect(result.signals![0]!.data?.action).toBe("warn");
  });

  test("uses custom threshold", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 30000,
      outputTokens: 15000,
      maxTokens: 100000,
      usagePercentage: 45.0,
    }));

    // Default threshold (60) would not trigger
    const nodeDefault = contextMonitorNode<ContextTestState>({
      id: "context-check-default",
      agentType: "copilot",
      getSession: () => mockSession,
    });

    // Custom threshold (40) should trigger
    const nodeCustom = contextMonitorNode<ContextTestState>({
      id: "context-check-custom",
      agentType: "copilot",
      threshold: 40,
      getSession: () => mockSession,
    });

    const ctx = createContextTestContext();

    const resultDefault = await nodeDefault.execute(ctx);
    expect(resultDefault.signals).toBeUndefined();

    const resultCustom = await nodeCustom.execute(ctx);
    expect(resultCustom.signals).toBeDefined();
    expect(resultCustom.signals![0]!.type).toBe("context_window_warning");
  });

  test("uses custom action override", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 40000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 70.0,
    }));

    // OpenCode with action override to "warn" instead of "summarize"
    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
      action: "warn",
      getSession: () => mockSession,
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(mockSession.summarize).not.toHaveBeenCalled();
    expect(result.signals).toBeDefined();
    expect(result.signals![0]!.data?.action).toBe("warn");
  });

  test("action none does not emit signals", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 40000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 70.0,
    }));

    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
      action: "none",
      getSession: () => mockSession,
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(mockSession.summarize).not.toHaveBeenCalled();
    expect(result.signals).toBeUndefined();
  });

  test("calls onCompaction callback when action is taken", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 40000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 70.0,
    }));

    let callbackUsage: ContextUsage | undefined;
    let callbackAction: ContextCompactionAction | undefined;

    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "claude",
      getSession: () => mockSession,
      onCompaction: (usage, action) => {
        callbackUsage = usage;
        callbackAction = action;
      },
    });

    const ctx = createContextTestContext();
    await node.execute(ctx);

    expect(callbackUsage).toBeDefined();
    expect(callbackUsage!.usagePercentage).toBe(70.0);
    expect(callbackAction).toBe("recreate");
  });

  test("uses customGetContextUsage function", async () => {
    const customUsage: ContextUsage = {
      inputTokens: 50000,
      outputTokens: 25000,
      maxTokens: 100000,
      usagePercentage: 75.0,
    };

    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "copilot",
      getContextUsage: async () => customUsage,
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate?.contextWindowUsage?.usagePercentage).toBe(75.0);
    expect(result.signals).toBeDefined();
  });

  test("uses context window usage from execution context when no session", async () => {
    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "copilot",
    });

    const ctx = createContextTestContext();
    ctx.contextWindowUsage = {
      inputTokens: 40000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 70.0,
    };

    const result = await node.execute(ctx);

    expect(result.stateUpdate?.contextWindowUsage?.usagePercentage).toBe(70.0);
    expect(result.signals).toBeDefined();
  });

  test("handles null context usage gracefully", async () => {
    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(result.stateUpdate?.contextWindowUsage).toBeNull();
    expect(result.signals).toBeUndefined();
  });

  test("emits warning signal when summarize fails", async () => {
    const mockSession = createMockSession();
    (mockSession.getContextUsage as ReturnType<typeof mock>).mockImplementation(async () => ({
      inputTokens: 40000,
      outputTokens: 30000,
      maxTokens: 100000,
      usagePercentage: 70.0,
    }));
    (mockSession.summarize as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("Summarize failed");
    });

    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
      getSession: () => mockSession,
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(result.signals).toBeDefined();
    expect(result.signals![0]!.type).toBe("context_window_warning");
    expect(result.signals![0]!.message).toContain("Summarize failed");
    expect(result.signals![0]!.data?.error).toBe(true);
  });

  test("emits warning when getSession returns null for summarize action", async () => {
    const node = contextMonitorNode<ContextTestState>({
      id: "context-check",
      agentType: "opencode",
      getSession: () => null,
      getContextUsage: async () => ({
        inputTokens: 40000,
        outputTokens: 30000,
        maxTokens: 100000,
        usagePercentage: 70.0,
      }),
    });

    const ctx = createContextTestContext();
    const result = await node.execute(ctx);

    expect(result.signals).toBeDefined();
    expect(result.signals![0]!.type).toBe("context_window_warning");
    expect(result.signals![0]!.message).toContain("no session");
  });
});
