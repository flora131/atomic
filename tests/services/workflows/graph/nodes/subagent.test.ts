import { describe, expect, test, mock } from "bun:test";
import { subagentNode } from "@/services/workflows/graph/nodes/subagent.ts";
import type {
  BaseState,
  ExecutionContext,
  SubagentStreamResult,
  SubagentSpawnOptions,
} from "@/services/workflows/graph/types.ts";

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

function createSpawnResult(
  overrides: Partial<SubagentStreamResult> = {},
): SubagentStreamResult {
  return {
    agentId: "agent-exec-1",
    success: true,
    output: "Done",
    toolUses: 0,
    durationMs: 100,
    ...overrides,
  };
}

function createMockRegistry(agentNames: string[] = ["planner", "worker", "reviewer", "analyzer", "agent", "test-agent"]) {
  const entries = agentNames.map((name) => ({
    name,
    info: { name, description: `${name} agent`, source: "project" as const, filePath: `/mock/${name}.md` },
    source: "project" as const,
  }));
  return {
    get: (name: string) => entries.find((e) => e.name === name),
    getAll: () => entries,
  };
}

function createContext(
  overrides: Partial<TestState> = {},
  runtimeOverrides: Record<string, unknown> = {},
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
      runtime: {
        subagentRegistry: createMockRegistry(),
        ...runtimeOverrides,
      },
    },
    errors: [],
    ...ctxOverrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("subagentNode session-based execution", () => {
  test("throws when spawnSubagent is not provided in runtime", async () => {
    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "Plan the work",
    });

    await expect(node.execute(createContext({}, { subagentRegistry: undefined }))).rejects.toThrow(
      /spawnSubagent not initialized/,
    );
  });

  test("throws when subagentRegistry is not provided in runtime", async () => {
    const spawnSubagent = mock(async () => createSpawnResult());

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "Plan the work",
    });

    await expect(
      node.execute(createContext({}, { spawnSubagent, subagentRegistry: undefined })),
    ).rejects.toThrow(/SubagentTypeRegistry not initialized/);
  });

  test("throws when agent is not found in registry", async () => {
    const spawnSubagent = mock(async () => createSpawnResult());

    const node = subagentNode<TestState>({
      id: "unknown-agent",
      agentName: "nonexistent",
      task: "Do something",
    });

    await expect(
      node.execute(createContext({}, { spawnSubagent })),
    ).rejects.toThrow(/Sub-agent "nonexistent" not found in registry/);
  });

  test("calls spawnSubagent with correct options", async () => {
    const spawnCalls: SubagentSpawnOptions[] = [];
    const spawnSubagent = async (opts: SubagentSpawnOptions) => {
      spawnCalls.push(opts);
      return createSpawnResult({ agentId: opts.agentId });
    };

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "Plan the work",
    });

    await node.execute(createContext({}, { spawnSubagent }));

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.agentName).toBe("planner");
    expect(spawnCalls[0]!.task).toBe("Plan the work");
    expect(spawnCalls[0]!.agentId).toBe("planner-exec-1");
  });

  test("passes model and tools to spawn options", async () => {
    const spawnCalls: SubagentSpawnOptions[] = [];
    const spawnSubagent = async (opts: SubagentSpawnOptions) => {
      spawnCalls.push(opts);
      return createSpawnResult({ agentId: opts.agentId });
    };

    const node = subagentNode<TestState>({
      id: "analyzer",
      agentName: "analyzer",
      task: "Analyze code",
      model: "sonnet",
      tools: ["read_file", "write_file"],
    });

    await node.execute(createContext({}, { spawnSubagent }));

    expect(spawnCalls[0]!.model).toBe("sonnet");
    expect(spawnCalls[0]!.tools).toEqual(["read_file", "write_file"]);
  });

  test("falls back to context model when config model is not set", async () => {
    const spawnCalls: SubagentSpawnOptions[] = [];
    const spawnSubagent = async (opts: SubagentSpawnOptions) => {
      spawnCalls.push(opts);
      return createSpawnResult({ agentId: opts.agentId });
    };

    const node = subagentNode<TestState>({
      id: "agent",
      agentName: "worker",
      task: "do work",
    });

    await node.execute(
      createContext({}, { spawnSubagent }, { model: "haiku" }),
    );

    expect(spawnCalls[0]!.model).toBe("haiku");
  });

  test("resolves dynamic task from state", async () => {
    const spawnCalls: SubagentSpawnOptions[] = [];
    const spawnSubagent = async (opts: SubagentSpawnOptions) => {
      spawnCalls.push(opts);
      return createSpawnResult({ agentId: opts.agentId, output: "planned" });
    };

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: (state) => `Plan: ${state.specDoc}`,
    });

    await node.execute(
      createContext({ specDoc: "Build auth module" }, { spawnSubagent }),
    );

    expect(spawnCalls[0]!.task).toBe("Plan: Build auth module");
  });

  test("applies custom outputMapper with result and state", async () => {
    const spawnSubagent = async (opts: SubagentSpawnOptions) =>
      createSpawnResult({ agentId: opts.agentId, output: "raw output" });

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "plan",
      outputMapper: (result, state) => ({
        specDoc: `${result.output} (exec: ${state.executionId})`,
      }),
    });

    const result = await node.execute(
      createContext({}, { spawnSubagent }),
    );

    expect(result.stateUpdate?.specDoc).toBe("raw output (exec: exec-1)");
  });

  test("provides well-formed SubagentStreamResult to outputMapper", async () => {
    let capturedResult: SubagentStreamResult | undefined;

    const spawnSubagent = async (opts: SubagentSpawnOptions) =>
      createSpawnResult({
        agentId: opts.agentId,
        output: "response text",
        toolUses: 3,
        durationMs: 200,
      });

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
      createContext({}, { spawnSubagent }),
    );

    expect(capturedResult).toBeDefined();
    expect(capturedResult!.agentId).toBe("test-node-exec-1");
    expect(capturedResult!.success).toBe(true);
    expect(capturedResult!.output).toBe("response text");
    expect(capturedResult!.toolUses).toBe(3);
    expect(capturedResult!.durationMs).toBe(200);
  });

  test("falls back to default outputs mapping when no outputMapper", async () => {
    const spawnSubagent = async (opts: SubagentSpawnOptions) =>
      createSpawnResult({ agentId: opts.agentId, output: "default output" });

    const node = subagentNode<TestState>({
      id: "my-node",
      agentName: "agent",
      task: "work",
    });

    const result = await node.execute(
      createContext({}, { spawnSubagent }),
    );

    expect(result.stateUpdate?.outputs?.["my-node"]).toBe("default output");
  });

  test("throws when spawnSubagent returns failure", async () => {
    const spawnSubagent = async (opts: SubagentSpawnOptions) =>
      createSpawnResult({
        agentId: opts.agentId,
        success: false,
        error: "Connection lost",
      });

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "plan",
    });

    await expect(
      node.execute(createContext({}, { spawnSubagent })),
    ).rejects.toThrow('Sub-agent "planner" failed: Connection lost');
  });

  test("throws with unknown error message when failure has no error field", async () => {
    const spawnSubagent = async (opts: SubagentSpawnOptions) =>
      createSpawnResult({
        agentId: opts.agentId,
        success: false,
        error: undefined,
      });

    const node = subagentNode<TestState>({
      id: "planner",
      agentName: "planner",
      task: "plan",
    });

    await expect(
      node.execute(createContext({}, { spawnSubagent })),
    ).rejects.toThrow('Sub-agent "planner" failed: Unknown error');
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
