import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AgentType } from "../../telemetry/types.ts";
import type {
  AgentMessage,
  CodingAgentClient,
  EventHandler,
  EventType,
  Session,
  SessionConfig,
  ToolDefinition,
} from "../../sdk/types.ts";
import { createNode } from "./builder.ts";
import { agentNode, subagentNode, subgraphNode } from "./nodes.ts";
import type { BaseState } from "./types.ts";
import { WorkflowSDK } from "./sdk.ts";

function createMockSession(id: string): Session {
  return {
    id,
    async send(message: string): Promise<AgentMessage> {
      return { type: "text", content: message, role: "assistant" };
    },
    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", content: `stream:${message}`, role: "assistant" };
    },
    async summarize(): Promise<void> {},
    async getContextUsage() {
      return {
        inputTokens: 1,
        outputTokens: 1,
        maxTokens: 100,
        usagePercentage: 1,
      };
    },
    getSystemToolsTokens(): number {
      return 0;
    },
    async destroy(): Promise<void> {},
  };
}

function createMockClient(
  agentType: AgentType,
  options?: {
    onCreateSession?: (config?: SessionConfig) => void;
    streamPrefix?: string;
  },
): CodingAgentClient {
  return {
    agentType,
    async createSession(config?: SessionConfig): Promise<Session> {
      options?.onCreateSession?.(config);
      const session = createMockSession(`${agentType}-${config?.model ?? "default"}`);
      if (!options?.streamPrefix) {
        return session;
      }
      return {
        ...session,
        async *stream(message: string): AsyncIterable<AgentMessage> {
          yield {
            type: "text",
            content: `${options.streamPrefix}:${message}`,
            role: "assistant",
          };
        },
      };
    },
    async resumeSession(): Promise<Session | null> {
      return null;
    },
    on<T extends EventType>(_eventType: T, _handler: EventHandler<T>): () => void {
      return () => {};
    },
    registerTool(_tool: ToolDefinition): void {},
    async start(): Promise<void> {},
    async stop(): Promise<void> {},
    async getModelDisplayInfo() {
      return {
        model: "test-model",
        tier: "test-tier",
      };
    },
    getSystemToolsTokens(): number | null {
      return 0;
    },
  };
}

const sdkInstances: WorkflowSDK[] = [];

afterEach(async () => {
  await Promise.all(sdkInstances.map((sdk) => sdk.destroy()));
  sdkInstances.length = 0;
});

describe("WorkflowSDK", () => {
  test("init throws when providers are empty", () => {
    expect(() => WorkflowSDK.init({ providers: {} })).toThrow(
      "WorkflowSDK.init() requires at least one provider."
    );
  });

  test("init uses defaultModel provider for subagent sessions when available", async () => {
    const sdk = WorkflowSDK.init({
      providers: {
        claude: createMockClient("claude", { streamPrefix: "claude" }),
        copilot: createMockClient("copilot", { streamPrefix: "copilot" }),
      },
      defaultModel: "copilot/gpt-5",
      agents: new Map([
        [
          "codebase-analyzer",
          {
            name: "codebase-analyzer",
            description: "Analyze code",
            source: "project",
            filePath: "/tmp/codebase-analyzer.md",
          },
        ],
      ]),
    });
    sdkInstances.push(sdk);

    const compiled = sdk.graph<BaseState>()
      .start(subagentNode({
        id: "delegate",
        agentName: "codebase-analyzer",
        task: "Summarize",
        outputMapper: (result, state) => ({
          outputs: {
            ...state.outputs,
            delegate: result.output,
          },
        }),
      }))
      .end()
      .compile();

    const result = await sdk.execute(compiled);
    expect(result.state.outputs.delegate).toContain("copilot:Summarize");
  });

  test("init honors explicit subagentProvider over defaultModel provider", async () => {
    const sdk = WorkflowSDK.init({
      providers: {
        claude: createMockClient("claude", { streamPrefix: "claude" }),
        copilot: createMockClient("copilot", { streamPrefix: "copilot" }),
      },
      defaultModel: "copilot/gpt-5",
      subagentProvider: "claude",
      agents: new Map([
        [
          "codebase-analyzer",
          {
            name: "codebase-analyzer",
            description: "Analyze code",
            source: "project",
            filePath: "/tmp/codebase-analyzer.md",
          },
        ],
      ]),
    });
    sdkInstances.push(sdk);

    const compiled = sdk.graph<BaseState>()
      .start(subagentNode({
        id: "delegate",
        agentName: "codebase-analyzer",
        task: "Summarize",
        outputMapper: (result, state) => ({
          outputs: {
            ...state.outputs,
            delegate: result.output,
          },
        }),
      }))
      .end()
      .compile();

    const result = await sdk.execute(compiled);
    expect(result.state.outputs.delegate).toContain("claude:Summarize");
  });

  test("init wires provider and workflow resolver runtime dependencies", async () => {
    const client = createMockClient("claude");
    const workflow = {
      async execute(state: BaseState) {
        return {
          ...state,
          outputs: { ...state.outputs, resolved: true },
        };
      },
    };

    const sdk = WorkflowSDK.init({
      providers: { claude: client },
      workflows: new Map([["demo", workflow]]),
    });
    sdkInstances.push(sdk);

    const graph = sdk.graph<BaseState>()
      .start(agentNode({
        id: "agent",
        agentType: "claude",
        buildMessage: () => "hello",
      }))
      .then(subgraphNode({ id: "subgraph", subgraph: "demo" }))
      .end()
      .compile();

    const result = await sdk.execute(graph);
    expect(result.status).toBe("completed");
    expect(Array.isArray(result.state.outputs.agent)).toBe(true);
    const subgraphResult = result.state.outputs.subgraph as BaseState;
    expect(subgraphResult.outputs.resolved).toBe(true);
  });

  test("init configures subagent bridge and registry entries for node execution", async () => {
    const client = createMockClient("claude");
    const sdk = WorkflowSDK.init({
      providers: { claude: client },
      agents: new Map([
        [
          "codebase-analyzer",
          {
            name: "codebase-analyzer",
            description: "Analyze code",
            source: "project",
            filePath: "/tmp/codebase-analyzer.md",
          },
        ],
      ]),
    });
    sdkInstances.push(sdk);

    const graph = sdk.graph<BaseState>()
      .start(subagentNode({
        id: "delegate",
        agentName: "codebase-analyzer",
        task: "Summarize",
        outputMapper: (result, state) => ({
          outputs: {
            ...state.outputs,
            delegate: result.output,
          },
        }),
      }))
      .end()
      .compile();

    const result = await sdk.execute(graph);
    expect(result.state.outputs.delegate).toContain("stream:Summarize");
  });

  test("subagent node spawning resolves provider via ProviderRegistry", async () => {
    const claudeSessionConfigs: SessionConfig[] = [];
    const copilotSessionConfigs: SessionConfig[] = [];
    const claudeClient = createMockClient("claude", {
      onCreateSession: (config) => claudeSessionConfigs.push(config ?? {}),
      streamPrefix: "claude",
    });
    const copilotClient = createMockClient("copilot", {
      onCreateSession: (config) => copilotSessionConfigs.push(config ?? {}),
      streamPrefix: "copilot",
    });

    const sdk = WorkflowSDK.init({
      providers: {
        claude: claudeClient,
        copilot: copilotClient,
      },
      subagentProvider: "copilot",
      agents: new Map([
        [
          "codebase-analyzer",
          {
            name: "codebase-analyzer",
            description: "Analyze code",
            source: "project",
            filePath: "/tmp/codebase-analyzer.md",
          },
        ],
      ]),
    });
    sdkInstances.push(sdk);

    const graph = sdk.graph<BaseState>()
      .start(agentNode({
        id: "parent",
        agentType: "claude",
        buildMessage: () => "Parent task",
      }))
      .then(subagentNode({
        id: "delegate",
        agentName: "codebase-analyzer",
        task: "Delegated task",
      }))
      .end()
      .compile();

    const result = await sdk.execute(graph);
    expect(result.state.outputs.delegate).toContain("copilot:Delegated task");
    expect(claudeSessionConfigs).toHaveLength(1);
    expect(copilotSessionConfigs).toEqual([{}]);
  });

  test("execute and stream use SDK entry points", async () => {
    const client = createMockClient("claude");
    const sdk = WorkflowSDK.init({
      providers: { claude: client },
      defaultModel: "claude/test-model",
      maxSteps: 5,
    });
    sdkInstances.push(sdk);

    const node = createNode("n1", "tool", async () => ({ stateUpdate: { outputs: { n1: "done" } } }));
    const compiled = sdk.graph().start(node).end().compile();

    const result = await sdk.execute(compiled);
    expect(result.status).toBe("completed");
    expect(result.state.outputs.n1).toBe("done");

    const events = [];
    for await (const event of sdk.stream(compiled, { modes: ["updates"] })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("updates");
  });

  test("stream uses router defaults and validator-protected state", async () => {
    type StreamState = BaseState & { counter?: number };
    const client = createMockClient("claude");
    const sdk = WorkflowSDK.init({
      providers: { claude: client },
    });
    sdkInstances.push(sdk);

    const node = createNode<StreamState>(
      "invalid-update",
      "tool",
      async () => ({ stateUpdate: { counter: 1 } }),
      {
        retry: {
          maxAttempts: 1,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
      }
    );
    const compiled = sdk.graph<StreamState>()
      .start(node)
      .end()
      .compile({
        outputSchema: z
          .object({
            executionId: z.string(),
            lastUpdated: z.string(),
            outputs: z.record(z.string(), z.unknown()),
            counter: z.number().optional(),
          })
          .refine((state) => state.counter === undefined || state.counter >= 2, {
            message: "counter must be >= 2",
            path: ["counter"],
          }),
      });

    const updateEvents = [];
    for await (const event of sdk.stream(compiled, { modes: ["updates"] })) {
      updateEvents.push(event);
    }
    expect(updateEvents).toHaveLength(0);

    const valueEvents = [];
    for await (const event of sdk.stream(compiled)) {
      valueEvents.push(event);
    }
    expect(valueEvents).toHaveLength(1);
    expect(valueEvents[0]?.mode).toBe("values");
    if (valueEvents[0]?.mode === "values") {
      expect(valueEvents[0].state.counter).toBeUndefined();
    }
  });

  test("stream executes full WorkflowSDK.stream() path across modes", async () => {
    type FullStreamState = BaseState & { counter?: number };
    let attempts = 0;
    const client = createMockClient("claude");
    const sdk = WorkflowSDK.init({
      providers: { claude: client },
      defaultModel: "claude/integration-model",
    });
    sdkInstances.push(sdk);

    const firstNode = createNode<FullStreamState>(
      "first",
      "tool",
      async (ctx) => {
        attempts += 1;
        ctx.emit?.("progress", { attempt: attempts });
        return { stateUpdate: { counter: attempts } };
      },
      {
        retry: {
          maxAttempts: 2,
          backoffMs: 1,
          backoffMultiplier: 1,
        },
      }
    );
    const secondNode = createNode<FullStreamState>("second", "tool", async (ctx) => ({
      stateUpdate: {
        outputs: {
          ...ctx.state.outputs,
          summary: `count:${ctx.state.counter ?? 0}`,
        },
      },
    }));

    const compiled = sdk.graph<FullStreamState>()
      .start(firstNode)
      .then(secondNode)
      .end()
      .compile({
        outputSchema: z
          .object({
            executionId: z.string(),
            lastUpdated: z.string(),
            outputs: z.record(z.string(), z.unknown()),
            counter: z.number().optional(),
          })
          .refine((state) => state.counter === undefined || state.counter >= 2, {
            message: "counter must be >= 2",
            path: ["counter"],
          }),
      });

    const events = [];
    for await (const event of sdk.stream(compiled, {
      modes: ["values", "updates", "events", "debug"],
    })) {
      events.push(event);
    }

    expect(attempts).toBe(2);
    expect(events.map((event) => `${event.nodeId}:${event.mode}`)).toEqual([
      "first:values",
      "first:updates",
      "first:events",
      "first:debug",
      "second:values",
      "second:updates",
      "second:debug",
    ]);

    if (events[0]?.mode === "values") {
      expect(events[0].state.counter).toBe(2);
    }
    if (events[1]?.mode === "updates") {
      expect(events[1].update.counter).toBe(2);
    }
    if (events[2]?.mode === "events") {
      expect(events[2].event.type).toBe("progress");
      expect(events[2].event.data).toEqual({ attempt: 2 });
    }
    if (events[3]?.mode === "debug") {
      expect(events[3].trace.retryCount).toBe(1);
      expect(events[3].trace.modelUsed).toBe("claude/integration-model");
    }
    if (events[5]?.mode === "updates") {
      expect(events[5].update.outputs).toMatchObject({ summary: "count:2" });
    }
    if (events[6]?.mode === "debug") {
      expect(events[6].trace.retryCount).toBe(0);
      expect(events[6].trace.modelUsed).toBe("claude/integration-model");
    }
  });
});
