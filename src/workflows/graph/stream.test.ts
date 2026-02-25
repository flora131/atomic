import { describe, expect, test } from "bun:test";
import { graph, createNode } from "./builder.ts";
import { streamGraph } from "./compiled.ts";
import { askUserNode, type AskUserWaitState } from "./nodes.ts";
import { routeStream } from "./stream.ts";
import type { BaseState, ExecutionContext } from "./types.ts";

interface StreamTestState extends BaseState {
  counter?: number;
}

interface AskUserStreamState extends BaseState, AskUserWaitState {}

describe("StreamRouter", () => {
  test("defaults to values mode", async () => {
    const node = createNode<StreamTestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });

    const workflow = graph<StreamTestState>().start(node).end().compile();
    const events = [];

    for await (const event of routeStream(streamGraph(workflow))) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("values");
    if (events[0]?.mode === "values") {
      expect(events[0].state.counter).toBe(1);
    }
  });

  test("emits updates mode from state deltas", async () => {
    const node1 = createNode<StreamTestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });
    const node2 = createNode<StreamTestState>("node2", "tool", async () => {
      return {};
    });

    const workflow = graph<StreamTestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const events = [];
    for await (const event of routeStream(streamGraph(workflow), ["updates"])) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("updates");
    if (events[0]?.mode === "updates") {
      expect(events[0].update.counter).toBe(1);
    }
  });

  test("emits custom events mode from context emit", async () => {
    const node = createNode<StreamTestState>(
      "node1",
      "tool",
      async (ctx: ExecutionContext<StreamTestState>) => {
        ctx.emit?.("progress", { step: 1, total: 1 });
        return { stateUpdate: { counter: 1 } };
      }
    );

    const workflow = graph<StreamTestState>().start(node).end().compile();
    const events = [];

    for await (const event of routeStream(streamGraph(workflow), ["events"])) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("events");
    if (events[0]?.mode === "events") {
      expect(events[0].event.type).toBe("progress");
      expect(events[0].event.data).toEqual({ step: 1, total: 1 });
      expect(typeof events[0].event.timestamp).toBe("number");
    }
  });

  test("emits ask_user node event via context emit contract", async () => {
    const node = askUserNode<AskUserStreamState>({
      id: "ask-user",
      options: {
        question: "Continue?",
        header: "Confirm",
      },
    });

    const workflow = graph<AskUserStreamState>().start(node).end().compile();
    const events = [];

    for await (const event of routeStream(streamGraph(workflow), ["events"])) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("events");
    if (events[0]?.mode === "events") {
      expect(events[0].event.type).toBe("human_input_required");
      expect(events[0].event.data).toMatchObject({
        question: "Continue?",
        header: "Confirm",
        nodeId: "ask-user",
      });
      expect(typeof events[0].event.timestamp).toBe("number");
    }
  });

  test("emits debug mode with retry and model metadata", async () => {
    let attempts = 0;
    const node = createNode<StreamTestState>(
      "node1",
      "tool",
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("retry once");
        }
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

    const workflow = graph<StreamTestState>()
      .start(node)
      .end()
      .compile({ defaultModel: "test-model" });

    const events = [];
    for await (const event of routeStream(streamGraph(workflow), ["debug"])) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("debug");
    if (events[0]?.mode === "debug") {
      expect(events[0].trace.retryCount).toBe(1);
      expect(events[0].trace.modelUsed).toBe("test-model");
      expect(events[0].trace.executionTime).toBeGreaterThanOrEqual(0);
    }
  });

  test("projects one step into multiple requested modes in order", async () => {
    const node = createNode<StreamTestState>(
      "node1",
      "tool",
      async (ctx: ExecutionContext<StreamTestState>) => {
        ctx.emit?.("progress", { step: 1, total: 1 });
        return { stateUpdate: { counter: 1 } };
      }
    );

    const workflow = graph<StreamTestState>()
      .start(node)
      .end()
      .compile({ defaultModel: "projection-model" });

    const events = [];
    for await (const event of routeStream(streamGraph(workflow), [
      "values",
      "updates",
      "events",
      "debug",
    ])) {
      events.push(event);
    }

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.mode)).toEqual([
      "values",
      "updates",
      "events",
      "debug",
    ]);

    if (events[0]?.mode === "values") {
      expect(events[0].state.counter).toBe(1);
    }

    if (events[1]?.mode === "updates") {
      expect(events[1].update.counter).toBe(1);
    }

    if (events[2]?.mode === "events") {
      expect(events[2].event.type).toBe("progress");
      expect(events[2].event.data).toEqual({ step: 1, total: 1 });
      expect(typeof events[2].event.timestamp).toBe("number");
    }

    if (events[3]?.mode === "debug") {
      expect(events[3].trace.modelUsed).toBe("projection-model");
      expect(events[3].trace.retryCount).toBe(0);
    }
  });

  test("projects only available payloads per step in multi-mode streams", async () => {
    const node1 = createNode<StreamTestState>("node1", "tool", async () => {
      return { stateUpdate: { counter: 1 } };
    });
    const node2 = createNode<StreamTestState>("node2", "tool", async () => {
      return {};
    });

    const workflow = graph<StreamTestState>()
      .start(node1)
      .then(node2)
      .end()
      .compile();

    const events = [];
    for await (const event of routeStream(streamGraph(workflow), ["values", "updates"])) {
      events.push(event);
    }

    expect(events.map((event) => event.mode)).toEqual(["values", "updates", "values"]);
    expect(events).toHaveLength(3);
  });
});
