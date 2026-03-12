import { describe, expect, test } from "bun:test";
import {
  graph,
  type SubAgentConfig,
  type ToolBuilderConfig,
} from "@/services/workflows/graph/builder.ts";
import { testNode1, testNode2, testNode3, type TestState } from "./builder.fixtures.ts";

describe("GraphBuilder - .subagent() method", () => {
  test("creates a node with type 'agent' and correct ID", () => {
    const builder = graph<TestState>().subagent({
      id: "analyze-code",
      agent: "codebase-analyzer",
      task: "Analyze the codebase",
    } satisfies SubAgentConfig<TestState>);

    const compiled = builder.compile();

    expect(compiled.nodes.has("analyze-code")).toBe(true);
    const node = compiled.nodes.get("analyze-code");
    expect(node?.type).toBe("agent");
    expect(node?.id).toBe("analyze-code");
  });

  test("maps config.agent to agentName correctly", () => {
    const builder = graph<TestState>().subagent({
      id: "my-subagent",
      agent: "codebase-analyzer",
      task: "Do something",
    } satisfies SubAgentConfig<TestState>);

    const compiled = builder.compile();
    const node = compiled.nodes.get("my-subagent");

    expect(node?.type).toBe("agent");
    expect(node?.description).toContain("codebase-analyzer");
  });

  test("first .subagent() call auto-sets as start node (no .start() needed)", () => {
    const builder = graph<TestState>().subagent({
      id: "first-agent",
      agent: "codebase-analyzer",
      task: "First task",
    } satisfies SubAgentConfig<TestState>);

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("first-agent");
  });

  test("chaining: .subagent().subagent() creates two nodes with an edge", () => {
    const builder = graph<TestState>()
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "First task",
      })
      .subagent({
        id: "agent2",
        agent: "codebase-locator",
        task: "Second task",
      });

    const compiled = builder.compile();

    expect(compiled.nodes.has("agent1")).toBe(true);
    expect(compiled.nodes.has("agent2")).toBe(true);
    expect(compiled.edges.find((edge) => edge.from === "agent1" && edge.to === "agent2")).toBeDefined();
  });

  test("config fields (name, description, retry) are passed through", () => {
    const builder = graph<TestState>().subagent({
      id: "my-agent",
      agent: "codebase-analyzer",
      task: "Analyze code",
      name: "Code Analyzer",
      description: "Analyzes the codebase structure",
      retry: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 },
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("my-agent");

    expect(node?.name).toBe("Code Analyzer");
    expect(node?.description).toBe("Analyzes the codebase structure");
    expect(node?.retry?.maxAttempts).toBe(3);
    expect(node?.retry?.backoffMs).toBe(1000);
  });

  test("task can be a function that resolves from state", () => {
    const builder = graph<TestState>().subagent({
      id: "dynamic-agent",
      agent: "codebase-analyzer",
      task: (state) => `Analyze ${state.message}`,
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("dynamic-agent");

    expect(node).toBeDefined();
    expect(node?.type).toBe("agent");
  });

  test("model and tools can be specified", () => {
    const builder = graph<TestState>().subagent({
      id: "restricted-agent",
      agent: "codebase-analyzer",
      task: "Analyze",
      model: "claude-opus-4",
      tools: ["bash", "view"],
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("restricted-agent");

    expect(node).toBeDefined();
    expect(node?.type).toBe("agent");
  });

  test("outputMapper can be provided", () => {
    const builder = graph<TestState>().subagent({
      id: "mapped-agent",
      agent: "codebase-analyzer",
      task: "Analyze",
      outputMapper: (result) => ({ message: result.output }),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("mapped-agent");

    expect(node).toBeDefined();
  });
});

describe("GraphBuilder - .tool() method", () => {
  test("creates a node with type 'tool' and correct ID", () => {
    const builder = graph<TestState>().tool({
      id: "fetch-data",
      execute: async () => ({ data: "result" }),
    } satisfies ToolBuilderConfig<TestState, { data: string }>);

    const compiled = builder.compile();

    expect(compiled.nodes.has("fetch-data")).toBe(true);
    const node = compiled.nodes.get("fetch-data");
    expect(node?.type).toBe("tool");
    expect(node?.id).toBe("fetch-data");
  });

  test("defaults toolName to config.id when not specified", () => {
    const builder = graph<TestState>().tool({
      id: "my-tool",
      execute: async () => ({}),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("my-tool");

    expect(node).toBeDefined();
    expect(node?.type).toBe("tool");
    expect(node?.name).toBe("my-tool");
  });

  test("uses explicit toolName when provided", () => {
    const builder = graph<TestState>().tool({
      id: "fetch-tool",
      toolName: "http_fetch",
      execute: async () => ({}),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("fetch-tool");

    expect(node).toBeDefined();
    expect(node?.name).toBe("http_fetch");
  });

  test("first .tool() call auto-sets as start node", () => {
    const builder = graph<TestState>().tool({
      id: "first-tool",
      execute: async () => ({}),
    });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("first-tool");
  });

  test("chaining: .tool().tool() creates two nodes with an edge", () => {
    const builder = graph<TestState>()
      .tool({
        id: "tool1",
        execute: async () => ({ result: 1 }),
      })
      .tool({
        id: "tool2",
        execute: async () => ({ result: 2 }),
      });

    const compiled = builder.compile();

    expect(compiled.nodes.has("tool1")).toBe(true);
    expect(compiled.nodes.has("tool2")).toBe(true);
    expect(compiled.edges.find((edge) => edge.from === "tool1" && edge.to === "tool2")).toBeDefined();
  });

  test("execute function is passed through correctly", () => {
    const executeFn = async () => ({ data: "test" });

    const builder = graph<TestState>().tool({
      id: "exec-tool",
      execute: executeFn,
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("exec-tool");

    expect(node).toBeDefined();
    expect(node?.execute).toBeTypeOf("function");
  });

  test("config fields (name, description, retry, timeout) are passed through", () => {
    const builder = graph<TestState>().tool({
      id: "my-tool",
      execute: async () => ({}),
      name: "Data Fetcher",
      description: "Fetches data from API",
      retry: { maxAttempts: 5, backoffMs: 500, backoffMultiplier: 2 },
      timeout: 30000,
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("my-tool");

    expect(node?.name).toBe("Data Fetcher");
    expect(node?.description).toBe("Fetches data from API");
    expect(node?.retry?.maxAttempts).toBe(5);
    expect(node?.retry?.backoffMs).toBe(500);
  });

  test("args can be a static object", () => {
    const builder = graph<TestState>().tool({
      id: "static-args-tool",
      execute: async (args: { url: string }) => ({ data: args.url }),
      args: { url: "https://example.com" },
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("static-args-tool");

    expect(node).toBeDefined();
  });

  test("args can be a function that resolves from state", () => {
    const builder = graph<TestState>().tool({
      id: "dynamic-args-tool",
      execute: async (args: { message: string }) => ({ result: args.message }),
      args: (state) => ({ message: state.message }),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("dynamic-args-tool");

    expect(node).toBeDefined();
  });

  test("outputMapper can be provided", () => {
    const builder = graph<TestState>().tool({
      id: "mapped-tool",
      execute: async () => ({ value: 42 }),
      outputMapper: (result) => ({ count: result.value }),
    });

    const compiled = builder.compile();
    const node = compiled.nodes.get("mapped-tool");

    expect(node).toBeDefined();
  });
});

describe("GraphBuilder - mixed chaining", () => {
  test(".subagent().tool().subagent() creates correct 3-node chain", () => {
    const builder = graph<TestState>()
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Analyze",
      })
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .subagent({
        id: "agent2",
        agent: "codebase-locator",
        task: "Locate",
      });

    const compiled = builder.compile();

    expect(compiled.nodes.has("agent1")).toBe(true);
    expect(compiled.nodes.has("tool1")).toBe(true);
    expect(compiled.nodes.has("agent2")).toBe(true);

    expect(compiled.edges.find((edge) => edge.from === "agent1" && edge.to === "tool1")).toBeDefined();
    expect(compiled.edges.find((edge) => edge.from === "tool1" && edge.to === "agent2")).toBeDefined();
    expect(compiled.startNode).toBe("agent1");
  });

  test(".tool().subagent().tool() creates correct 3-node chain", () => {
    const builder = graph<TestState>()
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Analyze",
      })
      .tool({
        id: "tool2",
        execute: async () => ({}),
      });

    const compiled = builder.compile();

    expect(compiled.nodes.has("tool1")).toBe(true);
    expect(compiled.nodes.has("agent1")).toBe(true);
    expect(compiled.nodes.has("tool2")).toBe(true);

    expect(compiled.edges.find((edge) => edge.from === "tool1" && edge.to === "agent1")).toBeDefined();
    expect(compiled.edges.find((edge) => edge.from === "agent1" && edge.to === "tool2")).toBeDefined();
    expect(compiled.startNode).toBe("tool1");
  });

  test(".subagent().if(condition).then(node).endif().tool() works with conditionals", () => {
    const builder = graph<TestState>()
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Analyze",
      })
      .if((state) => state.flag)
      .then(testNode2)
      .endif()
      .tool({
        id: "tool1",
        execute: async () => ({}),
      });

    const compiled = builder.compile();

    expect(compiled.nodes.has("agent1")).toBe(true);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("tool1")).toBe(true);

    const nodeIds = Array.from(compiled.nodes.keys());
    const decisionNode = nodeIds.find((id) => id.startsWith("decision_"));
    const mergeNode = nodeIds.find((id) => id.startsWith("merge_"));

    expect(decisionNode).toBeDefined();
    expect(mergeNode).toBeDefined();
    expect(compiled.edges.find((edge) => edge.from === mergeNode && edge.to === "tool1")).toBeDefined();
  });

  test(".tool().if({ condition, then, else }).subagent() works with config-based conditionals", () => {
    const builder = graph<TestState>()
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .if({
        condition: (state) => state.flag,
        then: [testNode2],
        else: [testNode3],
      })
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Analyze",
      });

    const compiled = builder.compile();

    expect(compiled.nodes.has("tool1")).toBe(true);
    expect(compiled.nodes.has("test2")).toBe(true);
    expect(compiled.nodes.has("test3")).toBe(true);
    expect(compiled.nodes.has("agent1")).toBe(true);

    const nodeIds = Array.from(compiled.nodes.keys());
    const mergeNode = nodeIds.find((id) => id.startsWith("merge_"));
    expect(mergeNode).toBeDefined();
    expect(compiled.edges.find((edge) => edge.from === mergeNode && edge.to === "agent1")).toBeDefined();
  });
});

describe("GraphBuilder - auto entry-point detection", () => {
  test("starting with .subagent() (no .start()) sets it as the start node", () => {
    const builder = graph<TestState>().subagent({
      id: "entry-agent",
      agent: "codebase-analyzer",
      task: "Start here",
    });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("entry-agent");
  });

  test("starting with .tool() (no .start()) sets it as the start node", () => {
    const builder = graph<TestState>().tool({
      id: "entry-tool",
      execute: async () => ({}),
    });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("entry-tool");
  });

  test("explicit .start() takes precedence over auto-detection", () => {
    const builder = graph<TestState>()
      .start(testNode1)
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Not the start",
      });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("test1");
  });

  test("chaining after .subagent() does not change start node", () => {
    const builder = graph<TestState>()
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "First",
      })
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .subagent({
        id: "agent2",
        agent: "codebase-locator",
        task: "Second",
      });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("agent1");
  });

  test("chaining after .tool() does not change start node", () => {
    const builder = graph<TestState>()
      .tool({
        id: "tool1",
        execute: async () => ({}),
      })
      .subagent({
        id: "agent1",
        agent: "codebase-analyzer",
        task: "Second",
      })
      .tool({
        id: "tool2",
        execute: async () => ({}),
      });

    const compiled = builder.compile();

    expect(compiled.startNode).toBe("tool1");
  });
});
