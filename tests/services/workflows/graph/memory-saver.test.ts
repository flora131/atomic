import { describe, expect, test } from "bun:test";
import { MemorySaver } from "@/services/workflows/graph/persistence/checkpointer/memory.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";

function makeState(id: string, extra?: Record<string, unknown>): BaseState {
  return {
    executionId: id,
    lastUpdated: new Date().toISOString(),
    outputs: {},
    ...extra,
  };
}

describe("MemorySaver", () => {
  test("save and load returns the latest checkpoint", async () => {
    const saver = new MemorySaver();
    const state = makeState("exec_1");

    await saver.save("exec_1", state);
    const loaded = await saver.load("exec_1");

    expect(loaded).toEqual(state);
  });

  test("returns null for unknown executionId", async () => {
    const saver = new MemorySaver();
    const loaded = await saver.load("nonexistent");
    expect(loaded).toBeNull();
  });

  test("returns a deep clone, not original reference", async () => {
    const saver = new MemorySaver();
    const state = makeState("exec_1");

    await saver.save("exec_1", state);
    const loaded = await saver.load("exec_1");

    expect(loaded).not.toBe(state);
    expect(loaded).toEqual(state);
  });

  test("supports labels on checkpoints", async () => {
    const saver = new MemorySaver();

    await saver.save("exec_1", makeState("exec_1"), "label_a");
    await saver.save("exec_1", makeState("exec_1"), "label_b");

    const labels = await saver.list("exec_1");
    expect(labels).toEqual(["label_a", "label_b"]);
  });

  test("auto-generates label when none provided", async () => {
    const saver = new MemorySaver();
    await saver.save("exec_1", makeState("exec_1"));

    const labels = await saver.list("exec_1");
    expect(labels.length).toBe(1);
    expect(labels[0]!.startsWith("checkpoint_")).toBe(true);
  });

  test("delete removes specific label", async () => {
    const saver = new MemorySaver();

    await saver.save("exec_1", makeState("exec_1"), "keep");
    await saver.save("exec_1", makeState("exec_1"), "remove");

    await saver.delete("exec_1", "remove");

    const labels = await saver.list("exec_1");
    expect(labels).toEqual(["keep"]);
  });

  test("delete without label removes all checkpoints", async () => {
    const saver = new MemorySaver();

    await saver.save("exec_1", makeState("exec_1"), "a");
    await saver.save("exec_1", makeState("exec_1"), "b");

    await saver.delete("exec_1");
    expect(await saver.load("exec_1")).toBeNull();
  });

  test("delete is no-op for nonexistent executionId", async () => {
    const saver = new MemorySaver();
    await saver.delete("nonexistent", "some_label");
    // Should not throw
    expect(await saver.load("nonexistent")).toBeNull();
  });

  test("clear removes all data", async () => {
    const saver = new MemorySaver();
    await saver.save("exec_1", makeState("exec_1"));
    await saver.save("exec_2", makeState("exec_2"));

    saver.clear();

    expect(await saver.load("exec_1")).toBeNull();
    expect(await saver.load("exec_2")).toBeNull();
  });

  test("count returns number of checkpoints for executionId", async () => {
    const saver = new MemorySaver();

    expect(saver.count("exec_1")).toBe(0);

    await saver.save("exec_1", makeState("exec_1"), "a");
    await saver.save("exec_1", makeState("exec_1"), "b");

    expect(saver.count("exec_1")).toBe(2);
  });

  test("loadByLabel returns matching checkpoint", async () => {
    const saver = new MemorySaver();
    const stateA = makeState("exec_1", { outputs: { step: "a" } });
    const stateB = makeState("exec_1", { outputs: { step: "b" } });

    await saver.save("exec_1", stateA, "label_a");
    await saver.save("exec_1", stateB, "label_b");

    const loaded = await saver.loadByLabel("exec_1", "label_a");
    expect(loaded).toEqual(stateA);
  });

  test("loadByLabel returns null for nonexistent label", async () => {
    const saver = new MemorySaver();
    await saver.save("exec_1", makeState("exec_1"), "exists");

    expect(await saver.loadByLabel("exec_1", "missing")).toBeNull();
  });

  test("loadByLabel returns null for nonexistent executionId", async () => {
    const saver = new MemorySaver();
    expect(await saver.loadByLabel("nonexistent", "any")).toBeNull();
  });

  test("separate executionIds are isolated", async () => {
    const saver = new MemorySaver();
    const state1 = makeState("exec_1", { outputs: { val: 1 } });
    const state2 = makeState("exec_2", { outputs: { val: 2 } });

    await saver.save("exec_1", state1);
    await saver.save("exec_2", state2);

    const loaded1 = await saver.load("exec_1");
    const loaded2 = await saver.load("exec_2");

    expect(loaded1!.outputs.val).toBe(1);
    expect(loaded2!.outputs.val).toBe(2);
  });
});
