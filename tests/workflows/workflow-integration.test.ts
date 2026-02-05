/**
 * Integration tests for full workflow execution with mock SDK
 *
 * Tests cover:
 * - Creating mock SDK client
 * - Creating test workflow with multiple nodes
 * - Executing workflow end-to-end
 * - Verifying all nodes executed in order
 * - Verifying state transitions correctly
 * - Verifying final state contains expected values
 *
 * This is a comprehensive integration test suite that validates the
 * complete graph execution pipeline with mocked SDK interactions.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  graph,
  createNode,
  createWaitNode,
} from "../../src/graph/builder.ts";
import {
  executeGraph,
  streamGraph,
  createExecutor,
  type StepResult,
} from "../../src/graph/compiled.ts";
import type {
  BaseState,
  NodeDefinition,
  CompiledGraph,
  ExecutionContext,
  Checkpointer,
} from "../../src/graph/types.ts";

// ============================================================================
// Test State Types
// ============================================================================

/**
 * Extended test state for workflow integration tests.
 */
interface WorkflowTestState extends BaseState {
  /** Counter for tracking node executions */
  nodeExecutionCount: number;

  /** Array of executed node IDs in order */
  executedNodes: string[];

  /** Data accumulated during workflow execution */
  data: Record<string, unknown>;

  /** Flag for conditional branching tests */
  shouldBranch: boolean;

  /** Flag for loop tests */
  loopCounter: number;

  /** Maximum loop iterations */
  maxLoops: number;

  /** Flag indicating workflow completion */
  isComplete: boolean;

  /** Mock SDK session ID */
  mockSessionId?: string;

  /** Mock SDK responses */
  mockResponses: string[];

  /** Error tracking */
  errors: string[];
}

/**
 * Create a fresh test state with default values.
 */
function createTestState(overrides: Partial<WorkflowTestState> = {}): WorkflowTestState {
  return {
    executionId: `test-exec-${Date.now()}`,
    lastUpdated: new Date().toISOString(),
    outputs: {},
    nodeExecutionCount: 0,
    executedNodes: [],
    data: {},
    shouldBranch: false,
    loopCounter: 0,
    maxLoops: 3,
    isComplete: false,
    mockResponses: [],
    errors: [],
    ...overrides,
  };
}

// ============================================================================
// Mock SDK Client
// ============================================================================

/**
 * Mock SDK client for testing workflow execution without real API calls.
 */
interface MockSDKClient {
  /** Start the mock client */
  start(): Promise<void>;

  /** Stop the mock client */
  stop(): Promise<void>;

  /** Create a mock session */
  createSession(config?: MockSessionConfig): Promise<MockSession>;

  /** Get all sessions */
  getSessions(): MockSession[];

  /** Clear all sessions */
  clearSessions(): void;

  /** Get execution log */
  getExecutionLog(): ExecutionLogEntry[];
}

interface MockSessionConfig {
  sessionId?: string;
  responses?: string[];
}

interface MockSession {
  id: string;
  responses: string[];
  responseIndex: number;
  messages: Array<{ role: string; content: string }>;

  send(message: string): Promise<string>;
  stream(message: string): AsyncGenerator<string>;
  destroy(): Promise<void>;
}

interface ExecutionLogEntry {
  timestamp: string;
  type: "session_created" | "message_sent" | "session_destroyed";
  sessionId: string;
  details?: unknown;
}

/**
 * Create a mock SDK client for testing.
 */
function createMockSDKClient(): MockSDKClient {
  let isStarted = false;
  const sessions: MockSession[] = [];
  const executionLog: ExecutionLogEntry[] = [];
  let sessionCounter = 0;

  return {
    async start() {
      isStarted = true;
    },

    async stop() {
      isStarted = false;
      for (const session of sessions) {
        await session.destroy();
      }
    },

    async createSession(config?: MockSessionConfig): Promise<MockSession> {
      if (!isStarted) {
        throw new Error("Mock SDK client not started");
      }

      const sessionId = config?.sessionId ?? `mock-session-${++sessionCounter}`;
      const responses = config?.responses ?? ["Mock response"];

      const session: MockSession = {
        id: sessionId,
        responses,
        responseIndex: 0,
        messages: [],

        async send(message: string): Promise<string> {
          this.messages.push({ role: "user", content: message });

          executionLog.push({
            timestamp: new Date().toISOString(),
            type: "message_sent",
            sessionId: this.id,
            details: { message },
          });

          const response = this.responses[this.responseIndex] ?? "Default response";
          this.responseIndex = (this.responseIndex + 1) % this.responses.length;
          this.messages.push({ role: "assistant", content: response });

          return response;
        },

        async *stream(message: string): AsyncGenerator<string> {
          const response = await this.send(message);
          for (const char of response) {
            yield char;
          }
        },

        async destroy(): Promise<void> {
          executionLog.push({
            timestamp: new Date().toISOString(),
            type: "session_destroyed",
            sessionId: this.id,
          });
        },
      };

      sessions.push(session);

      executionLog.push({
        timestamp: new Date().toISOString(),
        type: "session_created",
        sessionId: session.id,
      });

      return session;
    },

    getSessions(): MockSession[] {
      return [...sessions];
    },

    clearSessions(): void {
      sessions.length = 0;
    },

    getExecutionLog(): ExecutionLogEntry[] {
      return [...executionLog];
    },
  };
}

// ============================================================================
// Test Node Factories
// ============================================================================

/**
 * Create a node that tracks execution order.
 */
function createTrackingNode(
  id: string,
  data?: Record<string, unknown>
): NodeDefinition<WorkflowTestState> {
  return createNode<WorkflowTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      data: { ...ctx.state.data, ...data },
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a node that uses mock SDK to send a message.
 */
function createMockSDKNode(
  id: string,
  mockClient: MockSDKClient,
  message: string
): NodeDefinition<WorkflowTestState> {
  return createNode<WorkflowTestState>(id, "agent", async (ctx) => {
    const session = await mockClient.createSession({
      sessionId: `${id}-session`,
      responses: ["Mock SDK response for " + id],
    });

    const response = await session.send(message);

    return {
      stateUpdate: {
        nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
        executedNodes: [...ctx.state.executedNodes, id],
        mockSessionId: session.id,
        mockResponses: [...ctx.state.mockResponses, response],
        lastUpdated: new Date().toISOString(),
      },
    };
  });
}

/**
 * Create a node that increments the loop counter.
 */
function createLoopBodyNode(id: string): NodeDefinition<WorkflowTestState> {
  return createNode<WorkflowTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      loopCounter: ctx.state.loopCounter + 1,
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a node that can fail for retry testing.
 */
function createFailableNode(
  id: string,
  failCount: number
): NodeDefinition<WorkflowTestState> {
  let attempts = 0;

  return createNode<WorkflowTestState>(
    id,
    "tool",
    async (ctx) => {
      attempts++;
      if (attempts <= failCount) {
        throw new Error(`Intentional failure ${attempts}/${failCount}`);
      }
      return {
        stateUpdate: {
          nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
          executedNodes: [...ctx.state.executedNodes, id],
          data: { ...ctx.state.data, recovered: true },
          lastUpdated: new Date().toISOString(),
        },
      };
    },
    {
      retry: {
        maxAttempts: failCount + 1,
        backoffMs: 10,
        backoffMultiplier: 1,
      },
    }
  );
}

/**
 * Create a node that marks workflow as complete.
 */
function createCompletionNode(id: string): NodeDefinition<WorkflowTestState> {
  return createNode<WorkflowTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      isComplete: true,
      lastUpdated: new Date().toISOString(),
    },
  }));
}

// ============================================================================
// Mock SDK Client Tests
// ============================================================================

describe("Mock SDK Client", () => {
  let mockClient: MockSDKClient;

  beforeEach(() => {
    mockClient = createMockSDKClient();
  });

  afterEach(async () => {
    await mockClient.stop();
  });

  test("can start and stop", async () => {
    await mockClient.start();
    await mockClient.stop();
    // Should not throw
  });

  test("createSession throws before start", async () => {
    await expect(mockClient.createSession()).rejects.toThrow(
      "Mock SDK client not started"
    );
  });

  test("can create session after start", async () => {
    await mockClient.start();
    const session = await mockClient.createSession();

    expect(session).toBeDefined();
    expect(session.id).toMatch(/^mock-session-\d+$/);
  });

  test("session can send and receive messages", async () => {
    await mockClient.start();
    const session = await mockClient.createSession({
      responses: ["Hello back!"],
    });

    const response = await session.send("Hello");

    expect(response).toBe("Hello back!");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(session.messages[1]).toEqual({ role: "assistant", content: "Hello back!" });
  });

  test("session cycles through responses", async () => {
    await mockClient.start();
    const session = await mockClient.createSession({
      responses: ["First", "Second", "Third"],
    });

    expect(await session.send("1")).toBe("First");
    expect(await session.send("2")).toBe("Second");
    expect(await session.send("3")).toBe("Third");
    expect(await session.send("4")).toBe("First"); // Cycles back
  });

  test("execution log tracks operations", async () => {
    await mockClient.start();
    const session = await mockClient.createSession();
    await session.send("Test");
    await session.destroy();

    const log = mockClient.getExecutionLog();

    expect(log).toHaveLength(3);
    expect(log[0]!.type).toBe("session_created");
    expect(log[1]!.type).toBe("message_sent");
    expect(log[2]!.type).toBe("session_destroyed");
  });
});

// ============================================================================
// Full Workflow Execution Tests
// ============================================================================

describe("Full workflow execution with mock SDK", () => {
  let mockClient: MockSDKClient;

  beforeEach(async () => {
    mockClient = createMockSDKClient();
    await mockClient.start();
  });

  afterEach(async () => {
    await mockClient.stop();
  });

  describe("Linear workflow execution", () => {
    test("executes simple linear graph with all nodes in order", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("node-1", { step: 1 }))
        .then(createTrackingNode("node-2", { step: 2 }))
        .then(createTrackingNode("node-3", { step: 3 }))
        .then(createCompletionNode("node-complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      expect(result.state.nodeExecutionCount).toBe(4);
      expect(result.state.executedNodes).toEqual([
        "node-1",
        "node-2",
        "node-3",
        "node-complete",
      ]);
      expect(result.state.isComplete).toBe(true);
    });

    test("state transitions correctly between nodes", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("step-a", { value: "a" }))
        .then(createTrackingNode("step-b", { value: "b" }))
        .then(createTrackingNode("step-c", { value: "c" }))
        .end()
        .compile();

      const steps: StepResult<WorkflowTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      expect(steps).toHaveLength(3);

      // Verify state transitions
      expect(steps[0]!.state.nodeExecutionCount).toBe(1);
      expect(steps[0]!.state.data.value).toBe("a");

      expect(steps[1]!.state.nodeExecutionCount).toBe(2);
      expect(steps[1]!.state.data.value).toBe("b");

      expect(steps[2]!.state.nodeExecutionCount).toBe(3);
      expect(steps[2]!.state.data.value).toBe("c");
    });

    test("final state contains expected values", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("init", { initialized: true }))
        .then(createTrackingNode("process", { processed: true }))
        .then(createTrackingNode("finalize", { finalized: true }))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ data: { source: "test" } }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.data).toEqual({
        source: "test",
        initialized: true,
        processed: true,
        finalized: true,
      });
    });
  });

  describe("Workflow with mock SDK integration", () => {
    test("executes workflow with mock SDK nodes", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("pre-sdk", { preProcessed: true }))
        .then(createMockSDKNode("sdk-node", mockClient, "Process this"))
        .then(createTrackingNode("post-sdk", { postProcessed: true }))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      expect(result.state.nodeExecutionCount).toBe(3);
      expect(result.state.mockResponses).toHaveLength(1);
      expect(result.state.mockResponses[0]).toContain("Mock SDK response");
    });

    test("mock SDK session is created and tracked", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createMockSDKNode("sdk-main", mockClient, "Hello SDK"))
        .end()
        .compile();

      await executeGraph(workflow, {
        initialState: createTestState(),
      });

      const sessions = mockClient.getSessions();
      expect(sessions).toHaveLength(1);

      const log = mockClient.getExecutionLog();
      const sessionCreated = log.find((e) => e.type === "session_created");
      const messageSent = log.find((e) => e.type === "message_sent");

      expect(sessionCreated).toBeDefined();
      expect(messageSent).toBeDefined();
    });

    test("multiple mock SDK calls accumulate responses", async () => {
      const node1 = createMockSDKNode("sdk-1", mockClient, "Message 1");
      const node2 = createNode<WorkflowTestState>("sdk-2", "agent", async (ctx) => {
        const session = await mockClient.createSession({
          sessionId: "sdk-2-session",
          responses: ["Response 2"],
        });
        const response = await session.send("Message 2");
        return {
          stateUpdate: {
            nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
            executedNodes: [...ctx.state.executedNodes, "sdk-2"],
            mockResponses: [...ctx.state.mockResponses, response],
          },
        };
      });

      const workflow = graph<WorkflowTestState>()
        .start(node1)
        .then(node2)
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.state.mockResponses).toHaveLength(2);
      expect(mockClient.getSessions()).toHaveLength(2);
    });
  });

  describe("Conditional branching", () => {
    test("follows true branch when condition is met", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("start", {}))
        .if((state) => state.shouldBranch)
        .then(createTrackingNode("true-path", { path: "true" }))
        .else()
        .then(createTrackingNode("false-path", { path: "false" }))
        .endif()
        .then(createTrackingNode("end", {}))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ shouldBranch: true }),
      });

      expect(result.state.executedNodes).toContain("true-path");
      expect(result.state.executedNodes).not.toContain("false-path");
      expect(result.state.data.path).toBe("true");
    });

    test("follows false branch when condition is not met", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("start", {}))
        .if((state) => state.shouldBranch)
        .then(createTrackingNode("true-path", { path: "true" }))
        .else()
        .then(createTrackingNode("false-path", { path: "false" }))
        .endif()
        .then(createTrackingNode("end", {}))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ shouldBranch: false }),
      });

      expect(result.state.executedNodes).not.toContain("true-path");
      expect(result.state.executedNodes).toContain("false-path");
      expect(result.state.data.path).toBe("false");
    });
  });

  describe("Loop execution", () => {
    test("executes loop until condition is met", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("pre-loop", {}))
        .loop(createLoopBodyNode("loop-body"), {
          until: (state) => state.loopCounter >= state.maxLoops,
          maxIterations: 10,
        })
        .then(createTrackingNode("post-loop", {}))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState({ maxLoops: 3 }),
      });

      expect(result.status).toBe("completed");
      expect(result.state.loopCounter).toBe(3);
      expect(result.state.executedNodes.filter((n) => n === "loop-body")).toHaveLength(3);
    });

    test("respects maxIterations limit", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("start", {}))
        .loop(createLoopBodyNode("infinite-loop"), {
          until: () => false, // Never true - would loop forever
          maxIterations: 5,
        })
        .then(createTrackingNode("end", {}))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      // Should stop at maxIterations
      expect(result.state.loopCounter).toBe(5);
    });
  });

  describe("Error handling and retry", () => {
    test("retries failed nodes and succeeds", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("before", {}))
        .then(createFailableNode("failable", 2)) // Fails twice, then succeeds
        .then(createTrackingNode("after", {}))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      expect(result.state.data.recovered).toBe(true);
      expect(result.state.executedNodes).toContain("failable");
      expect(result.state.executedNodes).toContain("after");
    });

    test("fails when retries are exhausted", async () => {
      const alwaysFailNode = createNode<WorkflowTestState>(
        "always-fail",
        "tool",
        async () => {
          throw new Error("Always fails");
        },
        {
          retry: {
            maxAttempts: 2,
            backoffMs: 10,
            backoffMultiplier: 1,
          },
        }
      );

      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("before", {}))
        .then(alwaysFailNode)
        .then(createTrackingNode("after", {}))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("failed");
      expect(result.state.executedNodes).not.toContain("after");
    });
  });

  describe("Abort handling", () => {
    test("cancels execution when abort signal is triggered", async () => {
      const abortController = new AbortController();

      const slowNode = createNode<WorkflowTestState>("slow", "tool", async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          stateUpdate: {
            data: { completed: true },
          },
        };
      });

      const workflow = graph<WorkflowTestState>()
        .start(slowNode)
        .then(createTrackingNode("after", {}))
        .end()
        .compile();

      // Abort immediately
      abortController.abort();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
        abortSignal: abortController.signal,
      });

      expect(result.status).toBe("cancelled");
    });
  });

  describe("Checkpointing", () => {
    test("saves checkpoints during execution", async () => {
      const savedCheckpoints: Array<{
        id: string;
        state: WorkflowTestState;
        label?: string;
      }> = [];

      const mockCheckpointer: Checkpointer<WorkflowTestState> = {
        save: async (id, state, label) => {
          savedCheckpoints.push({ id, state: { ...state }, label });
        },
        load: async () => null,
        list: async () => savedCheckpoints.map((c) => c.label ?? ""),
        delete: async () => {},
      };

      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("step-1", {}))
        .then(createTrackingNode("step-2", {}))
        .then(createTrackingNode("step-3", {}))
        .end()
        .compile({ checkpointer: mockCheckpointer, autoCheckpoint: true });

      await executeGraph(workflow, {
        initialState: createTestState(),
      });

      // Should have checkpoints for each step
      expect(savedCheckpoints.length).toBeGreaterThan(0);
    });
  });

  describe("Complex workflow scenarios", () => {
    test("executes workflow with mixed node types", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("init", { phase: "init" }))
        .then(createMockSDKNode("sdk-analyze", mockClient, "Analyze"))
        .if((state) => state.mockResponses.length > 0)
        .then(createTrackingNode("has-response", { hasResponse: true }))
        .else()
        .then(createTrackingNode("no-response", { hasResponse: false }))
        .endif()
        .loop(createLoopBodyNode("process"), {
          until: (state) => state.loopCounter >= 2,
          maxIterations: 5,
        })
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("completed");
      expect(result.state.isComplete).toBe(true);
      expect(result.state.mockResponses.length).toBeGreaterThan(0);
      expect(result.state.loopCounter).toBe(2);
    });

    test("streaming execution yields correct intermediate states", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("a", { step: "a" }))
        .then(createTrackingNode("b", { step: "b" }))
        .then(createTrackingNode("c", { step: "c" }))
        .end()
        .compile();

      const steps: StepResult<WorkflowTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      expect(steps).toHaveLength(3);

      // Each step should have increasing execution count
      for (let i = 0; i < steps.length; i++) {
        expect(steps[i]!.state.nodeExecutionCount).toBe(i + 1);
      }

      // Final step should have completed status
      expect(steps[steps.length - 1]!.status).toBe("completed");
    });

    test("executor instance can be reused", async () => {
      const workflow = graph<WorkflowTestState>()
        .start(createTrackingNode("node", { value: 1 }))
        .end()
        .compile();

      const executor = createExecutor(workflow);

      const result1 = await executor.execute({
        initialState: createTestState(),
      });

      const result2 = await executor.execute({
        initialState: createTestState(),
      });

      expect(result1.status).toBe("completed");
      expect(result2.status).toBe("completed");
      // Each execution should have its own state
      expect(result1.state.executionId).not.toBe(result2.state.executionId);
    });
  });
});

// ============================================================================
// Edge Cases and Stress Tests
// ============================================================================

describe("Workflow edge cases", () => {
  test("single node workflow executes correctly", async () => {
    const workflow = graph<WorkflowTestState>()
      .start(createTrackingNode("only", { solo: true }))
      .end()
      .compile();

    const result = await executeGraph(workflow, {
      initialState: createTestState(),
    });

    expect(result.status).toBe("completed");
    expect(result.state.nodeExecutionCount).toBe(1);
    expect(result.state.executedNodes).toEqual(["only"]);
  });

  test("empty node result does not modify state", async () => {
    const noopNode = createNode<WorkflowTestState>("noop", "tool", async () => ({}));

    const workflow = graph<WorkflowTestState>()
      .start(noopNode)
      .end()
      .compile();

    const initialData = { preserved: true };
    const result = await executeGraph(workflow, {
      initialState: createTestState({ data: initialData }),
    });

    expect(result.status).toBe("completed");
    expect(result.state.data).toEqual(initialData);
  });

  test("deeply nested outputs are preserved", async () => {
    const deepNode = createNode<WorkflowTestState>("deep", "tool", async (ctx) => ({
      stateUpdate: {
        data: {
          ...ctx.state.data,
          level1: {
            level2: {
              level3: {
                value: "deep value",
              },
            },
          },
        },
      },
    }));

    const workflow = graph<WorkflowTestState>()
      .start(deepNode)
      .end()
      .compile();

    const result = await executeGraph(workflow, {
      initialState: createTestState(),
    });

    expect((result.state.data.level1 as Record<string, unknown>)).toBeDefined();
    const level1 = result.state.data.level1 as Record<string, unknown>;
    const level2 = level1.level2 as Record<string, unknown>;
    const level3 = level2.level3 as Record<string, unknown>;
    expect(level3.value).toBe("deep value");
  });

  test("handles concurrent state updates correctly", async () => {
    // Create nodes that update different parts of state
    const nodeA = createNode<WorkflowTestState>("a", "tool", async (ctx) => ({
      stateUpdate: {
        data: { ...ctx.state.data, fromA: true },
        nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
        executedNodes: [...ctx.state.executedNodes, "a"],
      },
    }));

    const nodeB = createNode<WorkflowTestState>("b", "tool", async (ctx) => ({
      stateUpdate: {
        data: { ...ctx.state.data, fromB: true },
        nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
        executedNodes: [...ctx.state.executedNodes, "b"],
      },
    }));

    const workflow = graph<WorkflowTestState>()
      .start(nodeA)
      .then(nodeB)
      .end()
      .compile();

    const result = await executeGraph(workflow, {
      initialState: createTestState(),
    });

    expect(result.state.data.fromA).toBe(true);
    expect(result.state.data.fromB).toBe(true);
    expect(result.state.nodeExecutionCount).toBe(2);
  });
});
