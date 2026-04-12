import { test, expect, describe } from "bun:test";
import { GraphFrontierTracker } from "../../../src/sdk/runtime/graph-inference.ts";

describe("GraphFrontierTracker", () => {
  test("first stage gets the scope parent", () => {
    const t = new GraphFrontierTracker("orchestrator");
    expect(t.onSpawn()).toEqual(["orchestrator"]);
  });

  test("sequential chain: each stage depends on the previous", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("a")
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("a");

    // await ctx.stage("b")
    expect(t.onSpawn()).toEqual(["a"]);
    t.onSettle("b");

    // await ctx.stage("c")
    expect(t.onSpawn()).toEqual(["b"]);
    t.onSettle("c");
  });

  test("parallel fan-out: siblings share the same parent", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("a")
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("a");

    // Promise.all([ctx.stage("b"), ctx.stage("c")])
    // Both spawn synchronously before either settles
    expect(t.onSpawn()).toEqual(["a"]); // b
    expect(t.onSpawn()).toEqual(["a"]); // c — frontier was cleared, uses parallelAncestors
  });

  test("fan-in: stage after Promise.all depends on all parallel stages", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("a")
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("a");

    // Promise.all([ctx.stage("b"), ctx.stage("c")])
    t.onSpawn(); // b
    t.onSpawn(); // c
    t.onSettle("b");
    t.onSettle("c");

    // await ctx.stage("merge")
    expect(t.onSpawn()).toEqual(["b", "c"]);
  });

  test("hello-parallel: describe → [summarize-a, summarize-b] → merge", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("describe")
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("describe");

    // Promise.all([ctx.stage("summarize-a"), ctx.stage("summarize-b")])
    expect(t.onSpawn()).toEqual(["describe"]); // summarize-a
    expect(t.onSpawn()).toEqual(["describe"]); // summarize-b
    t.onSettle("summarize-a");
    t.onSettle("summarize-b");

    // await ctx.stage("merge")
    expect(t.onSpawn()).toEqual(["summarize-a", "summarize-b"]);
  });

  test("ralph loop: sequential chain across iterations", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // Iteration 1
    expect(t.onSpawn()).toEqual(["orchestrator"]); // planner-1
    t.onSettle("planner-1");

    expect(t.onSpawn()).toEqual(["planner-1"]); // orchestrator-1
    t.onSettle("orchestrator-1");

    expect(t.onSpawn()).toEqual(["orchestrator-1"]); // reviewer-1
    t.onSettle("reviewer-1");

    // Iteration 2
    expect(t.onSpawn()).toEqual(["reviewer-1"]); // planner-2
    t.onSettle("planner-2");

    expect(t.onSpawn()).toEqual(["planner-2"]); // orchestrator-2
    t.onSettle("orchestrator-2");
  });

  test("conditional skip: skipped stage is invisible to tracker", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("a")
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("a");

    // if (false) await ctx.stage("b")  — skipped, nothing happens

    // await ctx.stage("c")
    expect(t.onSpawn()).toEqual(["a"]);
  });

  test("failed stage: still chains to next if caller catches", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("a")  — runs and fails
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("a"); // called even on failure

    // Caller catches, continues
    // await ctx.stage("b")
    expect(t.onSpawn()).toEqual(["a"]);
  });

  test("non-stage awaits are invisible", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("a")
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("a");

    // await fetchSomething()  — not a stage, no tracker interaction

    // await ctx.stage("b")
    expect(t.onSpawn()).toEqual(["a"]);
  });

  test("nested scopes get independent trackers", () => {
    const outer = new GraphFrontierTracker("orchestrator");
    const inner = new GraphFrontierTracker("outer-stage");

    // Outer scope
    expect(outer.onSpawn()).toEqual(["orchestrator"]); // outer-stage
    outer.onSettle("outer-stage");

    // Inner scope (inside outer-stage callback)
    expect(inner.onSpawn()).toEqual(["outer-stage"]); // inner-a
    inner.onSettle("inner-a");
    expect(inner.onSpawn()).toEqual(["inner-a"]); // inner-b

    // Outer scope continues
    expect(outer.onSpawn()).toEqual(["outer-stage"]);
  });

  test("diamond pattern: sequential → parallel → fan-in → parallel → fan-in", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("a")
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("a");

    // Promise.all([ctx.stage("b"), ctx.stage("c")])
    expect(t.onSpawn()).toEqual(["a"]); // b
    expect(t.onSpawn()).toEqual(["a"]); // c
    t.onSettle("b");
    t.onSettle("c");

    // Promise.all([ctx.stage("d"), ctx.stage("e")])
    expect(t.onSpawn()).toEqual(["b", "c"]); // d
    expect(t.onSpawn()).toEqual(["b", "c"]); // e
    t.onSettle("d");
    t.onSettle("e");

    // await ctx.stage("f")
    expect(t.onSpawn()).toEqual(["d", "e"]);
  });

  test("three-way parallel fan-out", () => {
    const t = new GraphFrontierTracker("root");

    expect(t.onSpawn()).toEqual(["root"]); // a
    t.onSettle("a");

    // Promise.all([ctx.stage("b"), ctx.stage("c"), ctx.stage("d")])
    expect(t.onSpawn()).toEqual(["a"]); // b
    expect(t.onSpawn()).toEqual(["a"]); // c
    expect(t.onSpawn()).toEqual(["a"]); // d
    t.onSettle("b");
    t.onSettle("c");
    t.onSettle("d");

    // await ctx.stage("merge")
    expect(t.onSpawn()).toEqual(["b", "c", "d"]);
  });

  test("fire-and-forget: concurrent stages are siblings", () => {
    const t = new GraphFrontierTracker("orchestrator");

    // await ctx.stage("a")
    expect(t.onSpawn()).toEqual(["orchestrator"]);
    t.onSettle("a");

    // const bPromise = ctx.stage("b")  — not awaited
    expect(t.onSpawn()).toEqual(["a"]); // b

    // await ctx.stage("c")  — c spawns before b settles
    expect(t.onSpawn()).toEqual(["a"]); // c — parallel with b

    // Both are concurrent siblings from "a"
  });
});
