import { test, expect, describe } from "bun:test";
import { defineWorkflow, WorkflowBuilder } from "./define-workflow.ts";

describe("defineWorkflow", () => {
  test("returns a WorkflowBuilder", () => {
    const builder = defineWorkflow({ name: "test" });
    expect(builder).toBeInstanceOf(WorkflowBuilder);
    expect(builder.__brand).toBe("WorkflowBuilder");
  });

  test("throws on empty name", () => {
    expect(() => defineWorkflow({ name: "" })).toThrow("Workflow name is required");
  });

  test("throws on whitespace-only name", () => {
    expect(() => defineWorkflow({ name: "   " })).toThrow("Workflow name is required");
  });
});

describe("WorkflowBuilder.run()", () => {
  test("accepts a function and returns this for chaining", () => {
    const builder = defineWorkflow({ name: "test" });
    const result = builder.run(async () => {});
    expect(result).toBe(builder);
  });

  test("throws if called twice", () => {
    const builder = defineWorkflow({ name: "test" }).run(async () => {});
    expect(() => builder.run(async () => {})).toThrow("run() can only be called once");
  });

  test("throws if argument is not a function", () => {
    const builder = defineWorkflow({ name: "test" });
    expect(() => builder.run("not a function" as never)).toThrow("run() requires a function");
  });
});

describe("WorkflowBuilder.compile()", () => {
  test("produces a WorkflowDefinition with correct brand", () => {
    const def = defineWorkflow({ name: "test" })
      .run(async () => {})
      .compile();
    expect(def.__brand).toBe("WorkflowDefinition");
  });

  test("preserves name and description", () => {
    const def = defineWorkflow({ name: "my-wf", description: "A description" })
      .run(async () => {})
      .compile();
    expect(def.name).toBe("my-wf");
    expect(def.description).toBe("A description");
  });

  test("defaults description to empty string", () => {
    const def = defineWorkflow({ name: "test" })
      .run(async () => {})
      .compile();
    expect(def.description).toBe("");
  });

  test("stores the run function", () => {
    const fn = async () => {};
    const def = defineWorkflow({ name: "test" }).run(fn).compile();
    expect(def.run).toBe(fn);
  });

  test("throws if no run callback was provided", () => {
    const builder = defineWorkflow({ name: "test" });
    expect(() => builder.compile()).toThrow("has no run callback");
  });
});
