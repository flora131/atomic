import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { ExecutionContext } from "../types.ts";
import type { TaskItem } from "./ralph.ts";
import { criteriaLoopNode, taskLoopNode, type TaskLoopState } from "./task-loop.ts";

interface TestLoopState extends TaskLoopState {
  lastOutput?: string;
}

function createContext(state: TestLoopState): ExecutionContext<TestLoopState> {
  return {
    state,
    config: {},
    errors: [],
  };
}

function baseState(tasks: TaskItem[] = []): TestLoopState {
  return {
    executionId: "exec-1",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    tasks,
    iteration: 0,
    shouldContinue: true,
  };
}

describe("taskLoopNode", () => {
  test("returns a tool node definition", async () => {
    const node = taskLoopNode<TestLoopState>({
      taskNodes: {
        id: "body",
        type: "tool",
        execute: async () => ({ stateUpdate: {} }),
      },
      until: () => true,
    });

    expect(node.type).toBe("tool");
    const result = await node.execute(createContext(baseState()));
    expect(result.stateUpdate?.shouldContinue).toBe(false);
  });

  test("loads tasks from tasksPath", async () => {
    const dir = await mkdtemp(join(tmpdir(), "task-loop-"));
    const tasksPath = join(dir, "tasks.json");
    await writeFile(
      tasksPath,
      JSON.stringify([
        {
          id: "#1",
          content: "Run",
          status: "pending",
          activeForm: "Running",
          blockedBy: [],
        },
      ]),
    );

    const node = taskLoopNode<TestLoopState>({
      tasksPath,
      taskNodes: {
        id: "body",
        type: "tool",
        execute: async (ctx) => ({ stateUpdate: { tasks: ctx.state.tasks } }),
      },
      maxIterations: 1,
      until: () => false,
    });

    const result = await node.execute(createContext(baseState()));
    expect(result.stateUpdate?.tasks).toHaveLength(1);

    await rm(dir, { recursive: true, force: true });
  });

  test("sets maxIterationsReached when limit is hit", async () => {
    const node = taskLoopNode<TestLoopState>({
      taskNodes: {
        id: "body",
        type: "tool",
        execute: async () => ({ stateUpdate: {} }),
      },
      maxIterations: 1,
      until: () => false,
      taskSelector: (tasks) => tasks,
      detectDeadlocks: false,
    });

    const result = await node.execute(createContext(baseState([
      {
        id: "#1",
        content: "Task",
        status: "pending",
        activeForm: "Working",
      },
    ])));

    expect(result.stateUpdate?.maxIterationsReached).toBe(true);
    expect(result.stateUpdate?.shouldContinue).toBe(false);
  });
});

describe("criteriaLoopNode", () => {
  test("stops when completion signal is found", async () => {
    const node = criteriaLoopNode<TestLoopState>({
      taskNodes: [
        {
          id: "criteria-body",
          type: "tool",
          execute: async () => ({ stateUpdate: { lastOutput: "ALL_TASKS_COMPLETE" } }),
        },
      ],
    });

    const result = await node.execute(createContext(baseState()));
    expect(result.stateUpdate?.shouldContinue).toBe(false);
  });
});
