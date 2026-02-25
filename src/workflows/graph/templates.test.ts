import { describe, expect, test } from "bun:test";
import { createNode } from "./builder.ts";
import { executeGraph } from "./compiled.ts";
import { mapReduce, reviewCycle, sequential, taskLoop } from "./templates.ts";
import type { BaseState } from "./types.ts";

interface ReviewState extends BaseState {
  executed?: number;
  reviewed?: number;
  fixed?: number;
  approved?: boolean;
}

interface SequentialState extends BaseState {
  steps?: string[];
}

interface MapReduceState extends BaseState {
  total?: number;
}

interface TaskLoopState extends BaseState {
  planned?: number;
  worked?: number;
  reviewed?: number;
  allTasksComplete?: boolean;
}

describe("mapReduce template", () => {
  test("creates splitter-worker-reducer topology", () => {
    const splitter = createNode<MapReduceState>("splitter", "tool", async () => ({}));
    const worker = createNode<MapReduceState>("worker", "tool", async () => ({}));

    const compiled = mapReduce<MapReduceState>({
      splitter,
      worker,
      merger: () => ({ total: 0 }),
    }).compile();

    expect(compiled.startNode).toBe("splitter");
    expect(compiled.nodes.has("splitter")).toBe(true);
    expect(compiled.nodes.has("worker")).toBe(true);
    expect(compiled.nodes.has("worker_reduce")).toBe(true);
    expect(compiled.edges.some((edge) => edge.from === "splitter" && edge.to === "worker")).toBe(
      true,
    );
    expect(
      compiled.edges.some((edge) => edge.from === "worker" && edge.to === "worker_reduce"),
    ).toBe(true);
    expect(compiled.endNodes.has("worker_reduce")).toBe(true);
  });

  test("runs merger with worker output normalized to array", async () => {
    const splitter = createNode<MapReduceState>("splitter", "tool", async (ctx) => ({
      stateUpdate: {
        outputs: { ...ctx.state.outputs, splitter: [1, 2, 3] },
      },
    }));

    const worker = createNode<MapReduceState>("worker", "tool", async (ctx) => {
      const items = (ctx.state.outputs.splitter as number[]) ?? [];
      return {
        stateUpdate: {
          outputs: {
            ...ctx.state.outputs,
            worker: items.map((value) => ({ total: value })),
          },
        },
      };
    });

    const compiled = mapReduce<MapReduceState>({
      splitter,
      worker,
      merger: (results) => ({
        total: results.reduce((sum, result) => sum + (result.total ?? 0), 0),
      }),
    }).compile();

    const result = await executeGraph(compiled);
    expect(result.status).toBe("completed");
    expect(result.state.total).toBe(6);
  });

  test("applies default config and allows compile overrides", () => {
    const splitter = createNode<MapReduceState>("splitter", "tool", async () => ({}));
    const worker = createNode<MapReduceState>("worker", "tool", async () => ({}));

    const compiled = mapReduce<MapReduceState>({
      splitter,
      worker,
      merger: () => ({ total: 0 }),
      config: { maxConcurrency: 2, timeout: 5_000 },
    }).compile({ timeout: 10_000 });

    expect(compiled.config.maxConcurrency).toBe(2);
    expect(compiled.config.timeout).toBe(10_000);
  });
});

describe("reviewCycle template", () => {
  test("creates execute-review-fix loop topology", () => {
    const executor = createNode<ReviewState>("executor", "tool", async () => ({}));
    const reviewer = createNode<ReviewState>("reviewer", "tool", async () => ({}));
    const fixer = createNode<ReviewState>("fixer", "tool", async () => ({}));

    const compiled = reviewCycle<ReviewState>({
      executor,
      reviewer,
      fixer,
      until: (state) => state.approved === true,
      maxIterations: 3,
    }).compile();

    expect(compiled.startNode.startsWith("loop_start_")).toBe(true);
    expect(compiled.nodes.has("executor")).toBe(true);
    expect(compiled.nodes.has("reviewer")).toBe(true);
    expect(compiled.nodes.has("fixer")).toBe(true);
    expect(compiled.edges.some((edge) => edge.from === "executor" && edge.to === "reviewer")).toBe(
      true,
    );
    expect(compiled.edges.some((edge) => edge.from === "reviewer" && edge.to === "fixer")).toBe(
      true,
    );

    const continueEdge = compiled.edges.find(
      (edge) => edge.to === "executor" && edge.label === "loop-continue",
    );
    expect(continueEdge?.from.startsWith("loop_check_")).toBe(true);
    expect(Array.from(compiled.endNodes).some((nodeId) => nodeId.startsWith("loop_check_"))).toBe(
      true,
    );
  });

  test("loops until the review condition is satisfied", async () => {
    const executor = createNode<ReviewState>("executor", "tool", async (ctx) => ({
      stateUpdate: { executed: (ctx.state.executed ?? 0) + 1 },
    }));

    const reviewer = createNode<ReviewState>("reviewer", "tool", async (ctx) => ({
      stateUpdate: {
        reviewed: (ctx.state.reviewed ?? 0) + 1,
        approved: (ctx.state.executed ?? 0) >= 2,
      },
    }));

    const fixer = createNode<ReviewState>("fixer", "tool", async (ctx) => ({
      stateUpdate: { fixed: (ctx.state.fixed ?? 0) + 1 },
    }));

    const graph = reviewCycle<ReviewState>({
      executor,
      reviewer,
      fixer,
      until: (state) => state.approved === true,
      maxIterations: 5,
    }).compile();

    const result = await executeGraph(graph);

    expect(result.status).toBe("completed");
    expect(result.state.executed).toBe(2);
    expect(result.state.reviewed).toBe(2);
    expect(result.state.fixed).toBe(2);
    expect(result.state.approved).toBe(true);
  });

  test("stops at maxIterations when condition never passes", async () => {
    const executor = createNode<ReviewState>("executor", "tool", async (ctx) => ({
      stateUpdate: { executed: (ctx.state.executed ?? 0) + 1 },
    }));

    const reviewer = createNode<ReviewState>("reviewer", "tool", async (ctx) => ({
      stateUpdate: {
        reviewed: (ctx.state.reviewed ?? 0) + 1,
        approved: false,
      },
    }));

    const fixer = createNode<ReviewState>("fixer", "tool", async (ctx) => ({
      stateUpdate: { fixed: (ctx.state.fixed ?? 0) + 1 },
    }));

    const graph = reviewCycle<ReviewState>({
      executor,
      reviewer,
      fixer,
      until: (state) => state.approved === true,
      maxIterations: 2,
    }).compile();

    const result = await executeGraph(graph);

    expect(result.status).toBe("completed");
    expect(result.state.executed).toBe(2);
    expect(result.state.reviewed).toBe(2);
    expect(result.state.fixed).toBe(2);
    expect(result.state.approved).toBe(false);
  });

  test("applies default graph config from options", () => {
    const executor = createNode<ReviewState>("executor", "tool", async () => ({}));
    const reviewer = createNode<ReviewState>("reviewer", "tool", async () => ({}));
    const fixer = createNode<ReviewState>("fixer", "tool", async () => ({}));

    const compiled = reviewCycle<ReviewState>({
      executor,
      reviewer,
      fixer,
      until: (state) => state.approved === true,
      config: { maxConcurrency: 4, timeout: 5_000 },
    }).compile({ timeout: 10_000 });

    expect(compiled.config.maxConcurrency).toBe(4);
    expect(compiled.config.timeout).toBe(10_000);
  });
});

describe("sequential template", () => {
  test("supports single-node topology", () => {
    const only = createNode<SequentialState>("only", "tool", async () => ({}));

    const compiled = sequential([only]).compile();

    expect(compiled.startNode).toBe("only");
    expect(compiled.edges).toHaveLength(0);
    expect(compiled.endNodes.has("only")).toBe(true);
  });

  test("creates linear node topology", () => {
    const first = createNode<SequentialState>("first", "tool", async () => ({}));
    const second = createNode<SequentialState>("second", "tool", async () => ({}));
    const third = createNode<SequentialState>("third", "tool", async () => ({}));

    const compiled = sequential([first, second, third]).compile();

    expect(compiled.startNode).toBe("first");
    expect(compiled.edges).toHaveLength(2);
    expect(compiled.edges[0]).toMatchObject({ from: "first", to: "second" });
    expect(compiled.edges[1]).toMatchObject({ from: "second", to: "third" });
    expect(compiled.endNodes.has("third")).toBe(true);
  });

  test("throws for empty node lists", () => {
    expect(() => sequential<SequentialState>([])).toThrow(
      "Sequential template requires at least one node",
    );
  });

  test("applies default graph config from template options", () => {
    const first = createNode<SequentialState>("first", "tool", async () => ({}));
    const second = createNode<SequentialState>("second", "tool", async () => ({}));

    const compiled = sequential([first, second], { maxConcurrency: 2 }).compile({ timeout: 4_000 });

    expect(compiled.config.maxConcurrency).toBe(2);
    expect(compiled.config.timeout).toBe(4_000);
  });

  test("supports extending the graph before compile", () => {
    const first = createNode<SequentialState>("first", "tool", async (ctx) => ({
      stateUpdate: { steps: [...(ctx.state.steps ?? []), "first"] },
    }));
    const second = createNode<SequentialState>("second", "tool", async (ctx) => ({
      stateUpdate: { steps: [...(ctx.state.steps ?? []), "second"] },
    }));
    const third = createNode<SequentialState>("third", "tool", async (ctx) => ({
      stateUpdate: { steps: [...(ctx.state.steps ?? []), "third"] },
    }));

    const graph = sequential([first, second]).then(third).compile();
    const result = executeGraph(graph);

    expect(graph.endNodes.has("third")).toBe(true);
    expect(graph.endNodes.has("second")).toBe(false);
    return expect(result).resolves.toMatchObject({
      status: "completed",
      state: { steps: ["first", "second", "third"] },
    });
  });
});

describe("taskLoop template", () => {
  test("creates decompose-worker loop topology when reviewer is omitted", () => {
    const decomposer = createNode<TaskLoopState>("decomposer", "tool", async () => ({}));
    const worker = createNode<TaskLoopState>("worker", "tool", async () => ({}));

    const compiled = taskLoop<TaskLoopState>({
      decomposer,
      worker,
      maxIterations: 3,
    }).compile();

    const loopStart = compiled.edges.find((edge) => edge.from === "decomposer");
    const loopCheck = compiled.edges.find((edge) => edge.from === "worker");
    const continueEdge = compiled.edges.find(
      (edge) => edge.to === "worker" && edge.label === "loop-continue",
    );

    expect(loopStart?.to.startsWith("loop_start_")).toBe(true);
    expect(loopCheck?.to.startsWith("loop_check_")).toBe(true);
    expect(continueEdge?.from.startsWith("loop_check_")).toBe(true);
    expect(Array.from(compiled.endNodes).some((nodeId) => nodeId.startsWith("loop_check_"))).toBe(
      true,
    );
  });

  test("creates decompose-worker-review loop topology", () => {
    const decomposer = createNode<TaskLoopState>("decomposer", "tool", async () => ({}));
    const worker = createNode<TaskLoopState>("worker", "tool", async () => ({}));
    const reviewer = createNode<TaskLoopState>("reviewer", "tool", async () => ({}));

    const compiled = taskLoop<TaskLoopState>({
      decomposer,
      worker,
      reviewer,
      maxIterations: 3,
    }).compile();

    expect(compiled.startNode).toBe("decomposer");
    expect(compiled.edges.some((edge) => edge.from === "decomposer" && edge.to.startsWith("loop_start_"))).toBe(
      true,
    );
    expect(compiled.edges.some((edge) => edge.from === "worker" && edge.to === "reviewer")).toBe(true);
    expect(compiled.edges.some((edge) => edge.to === "worker" && edge.label === "loop-continue")).toBe(true);
  });

  test("uses worker completion flags in default until condition", () => {
    const decomposer = createNode<TaskLoopState>("decomposer", "tool", async () => ({}));
    const worker = createNode<TaskLoopState>("worker", "tool", async () => ({}));

    const compiled = taskLoop<TaskLoopState>({
      decomposer,
      worker,
    }).compile();

    const loopStartNodeId = Array.from(compiled.nodes.keys()).find((nodeId) =>
      nodeId.startsWith("loop_start_"),
    );
    const continueEdge = compiled.edges.find(
      (edge) => edge.to === "worker" && edge.label === "loop-continue",
    );

    expect(loopStartNodeId).toBeDefined();
    expect(continueEdge?.condition).toBeDefined();
    if (!loopStartNodeId) {
      throw new Error("Expected loop start node");
    }

    const shouldContinue = continueEdge?.condition?.({
      executionId: "exec-1",
      lastUpdated: new Date().toISOString(),
      outputs: {
        [`${loopStartNodeId}_iteration`]: 0,
        worker: { allTasksComplete: true },
      },
      allTasksComplete: false,
    });

    expect(shouldContinue).toBe(false);
  });

  test("runs until worker marks all tasks complete", async () => {
    const decomposer = createNode<TaskLoopState>("decomposer", "tool", async (ctx) => ({
      stateUpdate: { planned: (ctx.state.planned ?? 0) + 1 },
    }));
    const worker = createNode<TaskLoopState>("worker", "tool", async (ctx) => {
      const worked = (ctx.state.worked ?? 0) + 1;
      return {
        stateUpdate: {
          worked,
          outputs: {
            ...ctx.state.outputs,
            worker: {
              allTasksComplete: worked >= 2,
            },
          },
        },
      };
    });

    const result = await executeGraph(
      taskLoop<TaskLoopState>({
        decomposer,
        worker,
        maxIterations: 6,
      }).compile(),
    );

    expect(result.status).toBe("completed");
    expect(result.state.planned).toBe(1);
    expect(result.state.worked).toBe(2);
  });
});
