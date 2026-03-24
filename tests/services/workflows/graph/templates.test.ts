import { describe, expect, test } from "bun:test";
import {
  sequential,
  mapReduce,
  reviewCycle,
  taskLoop,
} from "@/services/workflows/graph/templates.ts";
import type { BaseState, NodeDefinition } from "@/services/workflows/graph/types.ts";

interface TestState extends BaseState {
  counter?: number;
  items?: string[];
  shouldContinue?: boolean;
  allTasksComplete?: boolean;
}

function makeNode(
  id: string,
  overrides: Partial<NodeDefinition<TestState>> = {},
): NodeDefinition<TestState> {
  return {
    id,
    type: "tool",
    execute: async () => ({ stateUpdate: {} }),
    ...overrides,
  };
}

function createState(overrides: Partial<TestState> = {}): TestState {
  return {
    executionId: "exec-1",
    lastUpdated: new Date(0).toISOString(),
    outputs: {},
    ...overrides,
  };
}

describe("sequential", () => {
  test("throws when given an empty array of nodes", () => {
    expect(() => sequential<TestState>([])).toThrow(
      "Sequential template requires at least one node",
    );
  });

  test("creates a single-node graph with that node as start", () => {
    const node = makeNode("only-node");
    const compiled = sequential<TestState>([node]).compile();
    expect(compiled.startNode).toBe("only-node");
    expect(compiled.nodes.size).toBe(1);
    expect(compiled.edges).toHaveLength(0);
    expect(compiled.endNodes.has("only-node")).toBe(true);
  });

  test("creates a linear chain of nodes", () => {
    const compiled = sequential<TestState>([makeNode("a"), makeNode("b"), makeNode("c")]).compile();
    expect(compiled.startNode).toBe("a");
    expect(compiled.nodes.size).toBe(3);
    expect(compiled.edges).toHaveLength(2);
    expect(compiled.edges.find((e) => e.from === "a")?.to).toBe("b");
    expect(compiled.edges.find((e) => e.from === "b")?.to).toBe("c");
    expect(compiled.endNodes.has("c")).toBe(true);
  });

  test("applies default config when provided", () => {
    const compiled = sequential<TestState>([makeNode("a")], {
      timeout: 5000,
      metadata: { workflow: "test" },
    }).compile();
    expect(compiled.config.timeout).toBe(5000);
    expect(compiled.config.metadata).toEqual({ workflow: "test" });
  });

  test("compile-time config overrides template default config", () => {
    const compiled = sequential<TestState>([makeNode("a")], {
      timeout: 5000,
      metadata: { from: "template" },
    }).compile({ timeout: 10000, metadata: { from: "compile" } });
    expect(compiled.config.timeout).toBe(10000);
    expect(compiled.config.metadata).toEqual({ from: "compile" });
  });

  test("compile-time config merges metadata with template default", () => {
    const compiled = sequential<TestState>([makeNode("a")], {
      metadata: { templateKey: "templateVal" },
    }).compile({ metadata: { compileKey: "compileVal" } });
    expect(compiled.config.metadata).toEqual({ templateKey: "templateVal", compileKey: "compileVal" });
  });

  test("works without any config", () => {
    const compiled = sequential<TestState>([makeNode("x")]).compile();
    expect(compiled.startNode).toBe("x");
    expect(compiled.config).toEqual({});
  });

  test("two-node chain has exactly one edge", () => {
    const compiled = sequential<TestState>([makeNode("first"), makeNode("second")]).compile();
    expect(compiled.edges).toHaveLength(1);
    expect(compiled.edges[0]!.from).toBe("first");
    expect(compiled.edges[0]!.to).toBe("second");
  });

  test("end node is the last node in the sequence", () => {
    const compiled = sequential<TestState>([makeNode("s1"), makeNode("s2"), makeNode("s3"), makeNode("s4")]).compile();
    expect(compiled.endNodes.has("s4")).toBe(true);
    expect(compiled.endNodes.has("s1")).toBe(false);
  });
});

describe("mapReduce", () => {
  test("creates splitter -> worker -> reducer graph", () => {
    const compiled = mapReduce<TestState>({
      splitter: makeNode("splitter"),
      worker: makeNode("worker"),
      merger: (results) => ({ counter: results.length }),
    }).compile();
    expect(compiled.startNode).toBe("splitter");
    expect(compiled.nodes.size).toBe(3);
    expect(compiled.nodes.has("worker_reduce")).toBe(true);
  });

  test("reducer node ID is worker.id + '_reduce'", () => {
    const compiled = mapReduce<TestState>({
      splitter: makeNode("split"),
      worker: makeNode("map-worker"),
      merger: () => ({}),
    }).compile();
    expect(compiled.nodes.has("map-worker_reduce")).toBe(true);
  });

  test("edges connect splitter -> worker -> reducer", () => {
    const compiled = mapReduce<TestState>({
      splitter: makeNode("splitter"),
      worker: makeNode("worker"),
      merger: () => ({}),
    }).compile();
    expect(compiled.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "splitter", to: "worker" }),
        expect.objectContaining({ from: "worker", to: "worker_reduce" }),
      ]),
    );
  });

  test("reducer executes merger with array worker output", async () => {
    let receivedResults: Partial<TestState>[] = [];
    const compiled = mapReduce<TestState>({
      splitter: makeNode("splitter"),
      worker: makeNode("worker"),
      merger: (results) => { receivedResults = results; return { counter: results.length }; },
    }).compile();
    const result = await compiled.nodes.get("worker_reduce")!.execute({
      state: createState({ outputs: { worker: [{ counter: 1 }, { counter: 2 }, { counter: 3 }] } }),
      config: {}, errors: [],
    });
    expect(receivedResults).toHaveLength(3);
    expect(result.stateUpdate).toEqual({ counter: 3 });
  });

  test("reducer normalizes Map output from worker", async () => {
    let receivedResults: Partial<TestState>[] = [];
    const compiled = mapReduce<TestState>({
      splitter: makeNode("splitter"),
      worker: makeNode("worker"),
      merger: (results) => { receivedResults = results; return { counter: results.length }; },
    }).compile();
    const workerMap = new Map<string, Partial<TestState>>();
    workerMap.set("branch-a", { counter: 10 });
    workerMap.set("branch-b", { counter: 20 });
    const result = await compiled.nodes.get("worker_reduce")!.execute({
      state: createState({ outputs: { worker: workerMap } }),
      config: {}, errors: [],
    });
    expect(receivedResults).toHaveLength(2);
    expect(result.stateUpdate).toEqual({ counter: 2 });
  });

  test("reducer normalizes single object output", async () => {
    let receivedResults: Partial<TestState>[] = [];
    const compiled = mapReduce<TestState>({
      splitter: makeNode("splitter"),
      worker: makeNode("worker"),
      merger: (results) => { receivedResults = results; return {}; },
    }).compile();
    await compiled.nodes.get("worker_reduce")!.execute({
      state: createState({ outputs: { worker: { counter: 42 } } }),
      config: {}, errors: [],
    });
    expect(receivedResults).toHaveLength(1);
    expect(receivedResults[0]).toEqual({ counter: 42 });
  });

  test("reducer handles undefined worker output", async () => {
    let receivedResults: Partial<TestState>[] = [];
    const compiled = mapReduce<TestState>({
      splitter: makeNode("splitter"),
      worker: makeNode("worker"),
      merger: (results) => { receivedResults = results; return {}; },
    }).compile();
    await compiled.nodes.get("worker_reduce")!.execute({
      state: createState({ outputs: {} }),
      config: {}, errors: [],
    });
    expect(receivedResults).toEqual([]);
  });

  test("reducer filters non-object entries from array output", async () => {
    let receivedResults: Partial<TestState>[] = [];
    const compiled = mapReduce<TestState>({
      splitter: makeNode("splitter"),
      worker: makeNode("worker"),
      merger: (results) => { receivedResults = results; return {}; },
    }).compile();
    await compiled.nodes.get("worker_reduce")!.execute({
      state: createState({ outputs: { worker: [{ counter: 1 }, "str", null, { counter: 2 }, 42] } }),
      config: {}, errors: [],
    });
    expect(receivedResults).toHaveLength(2);
  });

  test("reducer handles primitive string worker output", async () => {
    let receivedResults: Partial<TestState>[] = [];
    const compiled = mapReduce<TestState>({
      splitter: makeNode("s"),
      worker: makeNode("w"),
      merger: (results) => { receivedResults = results; return {}; },
    }).compile();
    await compiled.nodes.get("w_reduce")!.execute({
      state: createState({ outputs: { w: "just a string" } }),
      config: {}, errors: [],
    });
    expect(receivedResults).toEqual([]);
  });

  test("reducer handles number worker output", async () => {
    let receivedResults: Partial<TestState>[] = [];
    const compiled = mapReduce<TestState>({
      splitter: makeNode("s"),
      worker: makeNode("w"),
      merger: (results) => { receivedResults = results; return {}; },
    }).compile();
    await compiled.nodes.get("w_reduce")!.execute({
      state: createState({ outputs: { w: 42 } }),
      config: {}, errors: [],
    });
    expect(receivedResults).toEqual([]);
  });

  test("applies default config", () => {
    const compiled = mapReduce<TestState>({
      splitter: makeNode("s"),
      worker: makeNode("w"),
      merger: () => ({}),
      config: { timeout: 3000 },
    }).compile();
    expect(compiled.config.timeout).toBe(3000);
  });

  test("reducer node has type tool", () => {
    const compiled = mapReduce<TestState>({
      splitter: makeNode("s"),
      worker: makeNode("w"),
      merger: () => ({}),
    }).compile();
    expect(compiled.nodes.get("w_reduce")!.type).toBe("tool");
  });

  test("merger receives current state as second argument", async () => {
    let receivedState: TestState | undefined;
    const compiled = mapReduce<TestState>({
      splitter: makeNode("s"),
      worker: makeNode("w"),
      merger: (_results, state) => { receivedState = state; return {}; },
    }).compile();
    const state = createState({ counter: 42, outputs: { w: [] } });
    await compiled.nodes.get("w_reduce")!.execute({ state, config: {}, errors: [] });
    expect(receivedState).toBeDefined();
    expect(receivedState!.counter).toBe(42);
  });

  test("handles Map with non-object values", async () => {
    let received: Partial<TestState>[] = [];
    const compiled = mapReduce<TestState>({
      splitter: makeNode("s"),
      worker: makeNode("w"),
      merger: (results) => { received = results; return {}; },
    }).compile();
    const workerMap = new Map<string, unknown>();
    workerMap.set("a", { counter: 1 });
    workerMap.set("b", "not-an-object");
    workerMap.set("c", null);
    await compiled.nodes.get("w_reduce")!.execute({
      state: createState({ outputs: { w: workerMap } }),
      config: {}, errors: [],
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ counter: 1 });
  });
});

describe("reviewCycle", () => {
  test("creates a graph with executor, reviewer, and fixer nodes", () => {
    const compiled = reviewCycle<TestState>({
      executor: makeNode("executor"),
      reviewer: makeNode("reviewer"),
      fixer: makeNode("fixer"),
      until: () => true,
    }).compile();
    expect(compiled.nodes.has("executor")).toBe(true);
    expect(compiled.nodes.has("reviewer")).toBe(true);
    expect(compiled.nodes.has("fixer")).toBe(true);
  });

  test("compiles with an end node", () => {
    const compiled = reviewCycle<TestState>({
      executor: makeNode("executor"),
      reviewer: makeNode("reviewer"),
      fixer: makeNode("fixer"),
      until: () => true,
    }).compile();
    expect(compiled.startNode).toBeDefined();
    expect(compiled.endNodes.size).toBeGreaterThan(0);
  });

  test("applies default config", () => {
    const compiled = reviewCycle<TestState>({
      executor: makeNode("executor"),
      reviewer: makeNode("reviewer"),
      fixer: makeNode("fixer"),
      until: () => false,
      config: { metadata: { type: "review" } },
    }).compile();
    expect(compiled.config.metadata).toEqual({ type: "review" });
  });

  test("creates loop start and check nodes", () => {
    const compiled = reviewCycle<TestState>({
      executor: makeNode("exec"),
      reviewer: makeNode("rev"),
      fixer: makeNode("fix"),
      until: () => true,
    }).compile();
    const loopStart = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_start_"));
    const loopCheck = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_check_"));
    expect(loopStart).toBeDefined();
    expect(loopCheck).toBeDefined();
  });

  test("loop has continue edge with condition", () => {
    const compiled = reviewCycle<TestState>({
      executor: makeNode("executor"),
      reviewer: makeNode("reviewer"),
      fixer: makeNode("fixer"),
      until: (state) => (state.counter ?? 0) >= 3,
    }).compile();
    const loopCheck = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_check_"));
    const continueEdge = compiled.edges.find((e) => e.from === loopCheck && e.label === "loop-continue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.condition).toBeDefined();
  });

  test("loop check node is marked as end node", () => {
    const compiled = reviewCycle<TestState>({
      executor: makeNode("executor"),
      reviewer: makeNode("reviewer"),
      fixer: makeNode("fixer"),
      until: (state) => (state.counter ?? 0) >= 3,
    }).compile();
    const loopCheck = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_check_"));
    expect(compiled.endNodes.has(loopCheck!)).toBe(true);
  });
});

describe("taskLoop", () => {
  test("creates a graph with decomposer and worker nodes", () => {
    const compiled = taskLoop<TestState>({
      decomposer: makeNode("decomposer"),
      worker: makeNode("worker"),
    }).compile();
    expect(compiled.nodes.has("decomposer")).toBe(true);
    expect(compiled.nodes.has("worker")).toBe(true);
    expect(compiled.startNode).toBe("decomposer");
  });

  test("includes reviewer node when provided", () => {
    const compiled = taskLoop<TestState>({
      decomposer: makeNode("decomposer"),
      worker: makeNode("worker"),
      reviewer: makeNode("reviewer"),
    }).compile();
    expect(compiled.nodes.has("reviewer")).toBe(true);
  });

  test("does not include reviewer when not provided", () => {
    const compiled = taskLoop<TestState>({
      decomposer: makeNode("decomposer"),
      worker: makeNode("worker"),
    }).compile();
    expect(compiled.nodes.has("reviewer")).toBe(false);
  });

  test("applies default config", () => {
    const compiled = taskLoop<TestState>({
      decomposer: makeNode("decomposer"),
      worker: makeNode("worker"),
      config: { maxConcurrency: 2 },
    }).compile();
    expect(compiled.config.maxConcurrency).toBe(2);
  });

  test("creates an end node", () => {
    const compiled = taskLoop<TestState>({
      decomposer: makeNode("decomposer"),
      worker: makeNode("worker"),
    }).compile();
    expect(compiled.endNodes.size).toBeGreaterThan(0);
  });

  test("worker -> reviewer edge exists when reviewer provided", () => {
    const compiled = taskLoop<TestState>({
      decomposer: makeNode("decomposer"),
      worker: makeNode("worker"),
      reviewer: makeNode("reviewer"),
      until: () => true,
    }).compile();
    expect(compiled.edges.find((e) => e.from === "worker" && e.to === "reviewer")).toBeDefined();
  });

  test("creates loop_check node when using default until", () => {
    const compiled = taskLoop<TestState>({
      decomposer: makeNode("decomposer"),
      worker: makeNode("worker"),
    }).compile();
    const loopCheck = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_check_"));
    expect(loopCheck).toBeDefined();
  });
});

describe("defaultTaskLoopUntil behavior", () => {
  function getLoopContinueCondition() {
    const compiled = taskLoop<TestState>({
      decomposer: makeNode("decomposer"),
      worker: makeNode("worker"),
    }).compile();
    const loopCheck = Array.from(compiled.nodes.keys()).find((id) => id.startsWith("loop_check_"));
    const continueEdge = compiled.edges.find((e) => e.from === loopCheck && e.label === "loop-continue");
    return continueEdge!.condition!;
  }

  test("terminates when allTasksComplete is true in state root", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({ allTasksComplete: true }))).toBe(false);
  });

  test("terminates when shouldContinue is false in state root", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({ shouldContinue: false }))).toBe(false);
  });

  test("terminates when worker output has shouldContinue false", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({ outputs: { worker: { shouldContinue: false } } }))).toBe(false);
  });

  test("terminates when worker output has allTasksComplete true", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({ outputs: { worker: { allTasksComplete: true } } }))).toBe(false);
  });

  test("terminates when all tasks have completed status", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({
      outputs: { worker: { tasks: [{ status: "completed" }, { status: "done" }, { status: "complete" }] } },
    }))).toBe(false);
  });

  test("continues when tasks are not all completed", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({
      outputs: { worker: { tasks: [{ status: "completed" }, { status: "pending" }] } },
    }))).toBe(true);
  });

  test("handles trimmed and case-insensitive status strings", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({
      outputs: { worker: { tasks: [{ status: " Completed " }, { status: "DONE" }, { status: "  Complete  " }] } },
    }))).toBe(false);
  });

  test("continues when worker output has no tasks array", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({ outputs: { worker: { noTasksField: true } } }))).toBe(true);
  });

  test("continues when tasks array is empty", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({ outputs: { worker: { tasks: [] } } }))).toBe(true);
  });

  test("continues when worker output is not an object", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({ outputs: { worker: "just a string" } }))).toBe(true);
  });

  test("continues when task has non-string status", () => {
    const condition = getLoopContinueCondition();
    expect(condition(createState({
      outputs: { worker: { tasks: [{ status: "completed" }, { status: 42 }] } },
    }))).toBe(true);
  });
});

describe("applyDefaultConfig metadata merging", () => {
  test("default metadata only (no compile-time metadata)", () => {
    const compiled = sequential<TestState>(
      [makeNode("a")],
      { metadata: { defaultKey: "defaultVal" } },
    ).compile({ timeout: 100 });
    expect(compiled.config.metadata).toEqual({ defaultKey: "defaultVal" });
  });

  test("compile-time metadata only (no default metadata)", () => {
    const compiled = sequential<TestState>(
      [makeNode("a")],
      { timeout: 100 },
    ).compile({ metadata: { compileKey: "compileVal" } });
    expect(compiled.config.metadata).toEqual({ compileKey: "compileVal" });
  });

  test("neither default nor compile-time has metadata", () => {
    const compiled = sequential<TestState>(
      [makeNode("a")],
      { timeout: 100 },
    ).compile({ maxConcurrency: 2 });
    expect(compiled.config.metadata).toBeUndefined();
  });

  test("compile-time overrides default config scalar fields", () => {
    const compiled = sequential<TestState>(
      [makeNode("a")],
      { timeout: 1000, maxConcurrency: 1 },
    ).compile({ timeout: 2000 });
    expect(compiled.config.timeout).toBe(2000);
    expect(compiled.config.maxConcurrency).toBe(1);
  });

  test("metadata from both sources are merged with compile-time precedence", () => {
    const compiled = sequential<TestState>(
      [makeNode("a")],
      { metadata: { a: 1, shared: "default" } },
    ).compile({ metadata: { b: 2, shared: "compile" } });
    expect(compiled.config.metadata).toEqual({ a: 1, b: 2, shared: "compile" });
  });
});
