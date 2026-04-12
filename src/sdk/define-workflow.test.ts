import { test, expect, describe } from "bun:test";
import { defineWorkflow, WorkflowBuilder } from "./define-workflow.ts";
import type { WorkflowInput } from "./types.ts";

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

  test("defaults inputs to an empty array when none are declared", () => {
    const def = defineWorkflow({ name: "test" })
      .run(async () => {})
      .compile();
    expect(def.inputs).toEqual([]);
  });

  test("preserves declared inputs in order", () => {
    const def = defineWorkflow({
      name: "gen-spec",
      inputs: [
        {
          name: "research_doc",
          type: "string",
          required: true,
          description: "path",
        },
        {
          name: "focus",
          type: "enum",
          required: true,
          values: ["minimal", "standard", "exhaustive"],
          default: "standard",
        },
      ],
    })
      .run(async () => {})
      .compile();
    expect(def.inputs).toHaveLength(2);
    expect(def.inputs[0]?.name).toBe("research_doc");
    expect(def.inputs[1]?.name).toBe("focus");
    expect(def.inputs[1]?.type).toBe("enum");
  });

  test("freezes declared inputs to prevent downstream mutation", () => {
    const def = defineWorkflow({
      name: "test",
      inputs: [{ name: "foo", type: "string" }],
    })
      .run(async () => {})
      .compile();
    expect(() => {
      (def.inputs as unknown as WorkflowInput[])[0]!.name = "bar";
    }).toThrow();
  });

  test("rejects enum inputs with no values", () => {
    expect(() =>
      defineWorkflow({
        name: "bad",
        inputs: [{ name: "mode", type: "enum" }],
      })
        .run(async () => {})
        .compile(),
    ).toThrow("declares no `values`");
  });

  test("rejects enum defaults outside the allowed values", () => {
    expect(() =>
      defineWorkflow({
        name: "bad",
        inputs: [
          {
            name: "mode",
            type: "enum",
            values: ["a", "b"],
            default: "c",
          },
        ],
      })
        .run(async () => {})
        .compile(),
    ).toThrow(/not one of its declared values/);
  });

  test("rejects input names that are not valid CLI flag tails", () => {
    expect(() =>
      defineWorkflow({
        name: "bad",
        inputs: [{ name: "1bad", type: "string" }],
      })
        .run(async () => {})
        .compile(),
    ).toThrow(/invalid/);
  });

  test("rejects duplicate input names", () => {
    expect(() =>
      defineWorkflow({
        name: "bad",
        inputs: [
          { name: "foo", type: "string" },
          { name: "foo", type: "string" },
        ],
      })
        .run(async () => {})
        .compile(),
    ).toThrow(/duplicate input name/);
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
