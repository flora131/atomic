import { test, expect, describe } from "bun:test";
import { GraphFrontierTracker } from "./graph-inference.js";

describe("GraphFrontierTracker", () => {
  test("root stages have no parents", () => {
    const tracker = new GraphFrontierTracker();
    const parents = tracker.onSpawn("s1", "stage-one");
    expect(parents).toEqual([]);
    tracker.onSettle("s1");

    const nodes = tracker.getNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.parentIds).toEqual([]);
  });

  test("sequential: each stage depends on previous", () => {
    const tracker = new GraphFrontierTracker();

    // Simulate: const r1 = await ctx.stage("s1").prompt(...)
    tracker.onSpawn("s1", "stage-one");
    tracker.onSettle("s1");

    // Simulate: const r2 = await ctx.stage("s2").prompt(...)
    const parents2 = tracker.onSpawn("s2", "stage-two");
    expect(parents2).toEqual(["s1"]);
    tracker.onSettle("s2");

    const parents3 = tracker.onSpawn("s3", "stage-three");
    expect(parents3).toEqual(["s2"]);
    tracker.onSettle("s3");

    const nodes = tracker.getNodes();
    expect(nodes).toHaveLength(3);
    expect(tracker.getParents("s1")).toEqual([]);
    expect(tracker.getParents("s2")).toEqual(["s1"]);
    expect(tracker.getParents("s3")).toEqual(["s2"]);
  });

  test("parallel: Promise.all stages share same parents", () => {
    const tracker = new GraphFrontierTracker();

    // Root stage
    tracker.onSpawn("s0", "root");
    tracker.onSettle("s0");

    // Parallel: ctx.stage("a") and ctx.stage("b") both spawned before either settles
    const parentsA = tracker.onSpawn("sA", "stage-a");
    const parentsB = tracker.onSpawn("sB", "stage-b");

    // Both see the same frontier (just "s0")
    expect(parentsA).toEqual(["s0"]);
    expect(parentsB).toEqual(["s0"]);

    tracker.onSettle("sA");
    tracker.onSettle("sB");
  });

  test("fan-in: stage after Promise.all has all parallel stages as parents", () => {
    const tracker = new GraphFrontierTracker();

    // Parallel stages spawned from empty frontier
    tracker.onSpawn("sA", "stage-a"); // parents: []
    tracker.onSpawn("sB", "stage-b"); // parents: []

    // Both settle
    tracker.onSettle("sA");
    tracker.onSettle("sB");

    // Fan-in stage — frontier should now have sA and sB
    const parentsC = tracker.onSpawn("sC", "stage-c");
    expect(parentsC).toHaveLength(2);
    expect(parentsC).toContain("sA");
    expect(parentsC).toContain("sB");
    tracker.onSettle("sC");

    const nodes = tracker.getNodes();
    expect(nodes).toHaveLength(3);
  });

  test("reset clears all state", () => {
    const tracker = new GraphFrontierTracker();
    tracker.onSpawn("s1", "stage-one");
    tracker.onSettle("s1");

    tracker.reset();

    expect(tracker.getNodes()).toHaveLength(0);
    expect(tracker.getParents("s1")).toEqual([]);

    // After reset, new stages are root stages
    const parents = tracker.onSpawn("s2", "stage-two");
    expect(parents).toEqual([]);
  });

  test("getNodes returns all recorded nodes", () => {
    const tracker = new GraphFrontierTracker();
    tracker.onSpawn("s1", "alpha");
    tracker.onSettle("s1");
    tracker.onSpawn("s2", "beta");
    tracker.onSettle("s2");

    const nodes = tracker.getNodes();
    expect(nodes).toHaveLength(2);
    const names = nodes.map((n) => n.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });
});
