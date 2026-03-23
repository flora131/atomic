import { test, expect, describe } from "bun:test";
import { defineWorkflow, WorkflowBuilder } from "../src/define-workflow.ts";
import type { CompiledWorkflow } from "../src/types.ts";

describe("defineWorkflow", () => {
  test("returns a WorkflowBuilder", () => {
    const builder = defineWorkflow({
      name: "test-wf",
      description: "A test workflow",
    });
    expect(builder).toBeInstanceOf(WorkflowBuilder);
    expect(builder.name).toBe("test-wf");
    expect(builder.description).toBe("A test workflow");
  });
});

describe("WorkflowBuilder", () => {
  test("records stage instructions", () => {
    const builder = defineWorkflow({
      name: "wf",
      description: "desc",
    }).stage({
      name: "planner",
      agent: "planner",
      description: "Plans",
      prompt: (ctx) => ctx.userPrompt,
      outputMapper: (r) => ({ plan: r }),
    });

    expect(builder.instructions).toHaveLength(1);
    expect(builder.instructions[0]!.type).toBe("stage");
  });

  test("records tool instructions", () => {
    const builder = defineWorkflow({
      name: "wf",
      description: "desc",
    }).tool({
      name: "transform",
      execute: async () => ({ result: "done" }),
    });

    expect(builder.instructions).toHaveLength(1);
    expect(builder.instructions[0]!.type).toBe("tool");
  });

  test("records askUserQuestion instructions", () => {
    const builder = defineWorkflow({
      name: "wf",
      description: "desc",
    }).askUserQuestion({
      name: "confirm",
      question: { question: "Continue?" },
    });

    expect(builder.instructions).toHaveLength(1);
    expect(builder.instructions[0]!.type).toBe("askUserQuestion");
  });

  test("records conditional instructions", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .stage({ name: "a", description: "a", prompt: () => "", outputMapper: () => ({}) })
      .if(() => true)
        .stage({ name: "b", description: "b", prompt: () => "", outputMapper: () => ({}) })
      .else()
        .stage({ name: "c", description: "c", prompt: () => "", outputMapper: () => ({}) })
      .endIf();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["stage", "if", "stage", "else", "stage", "endIf"]);
  });

  test("records loop instructions with break", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop({ maxCycles: 5 })
        .stage({ name: "a", description: "a", prompt: () => "", outputMapper: () => ({}) })
        .break(() => () => true)
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "stage", "break", "endLoop"]);
  });

  test("throws on duplicate node names", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .stage({ name: "dup", description: "d", prompt: () => "", outputMapper: () => ({}) });

    expect(() => builder.stage({
      name: "dup", description: "d", prompt: () => "", outputMapper: () => ({}),
    })).toThrow('Duplicate node name: "dup"');
  });

  test("throws on endLoop without matching loop", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    expect(() => builder.endLoop()).toThrow("endLoop() called without a matching loop()");
  });

  test("throws on break outside loop", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    expect(() => builder.break()).toThrow("break() can only be used inside a loop() block");
  });

  test("version and argumentHint are recorded", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .version("1.2.3")
      .argumentHint("<file>");

    expect(builder.getVersion()).toBe("1.2.3");
    expect(builder.getArgumentHint()).toBe("<file>");
  });

  test("getStateSchema merges globalState and loopState", () => {
    const builder = defineWorkflow({
      name: "wf",
      description: "d",
      globalState: {
        count: { default: 0, reducer: "sum" as const },
      },
    })
      .loop({ loopState: { iteration: { default: 0, reducer: "sum" as const } } })
        .stage({ name: "a", description: "a", prompt: () => "", outputMapper: () => ({}) })
      .endLoop();

    const schema = builder.getStateSchema();
    expect(schema).toBeDefined();
    expect(schema!.count).toBeDefined();
    expect(schema!.iteration).toBeDefined();
  });

  test("getStateSchema returns undefined when no state", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    expect(builder.getStateSchema()).toBeUndefined();
  });
});

describe("compile", () => {
  test("returns branded CompiledWorkflow with __blueprint", () => {
    const result = defineWorkflow({ name: "wf", description: "desc" })
      .version("1.0.0")
      .stage({
        name: "planner",
        agent: "planner",
        description: "Plans",
        prompt: (ctx) => ctx.userPrompt,
        outputMapper: (r) => ({ plan: r }),
      })
      .compile();

    expect(result.__compiledWorkflow).toBe(true);
    expect(result.name).toBe("wf");
    expect(result.description).toBe("desc");

    // Blueprint data is carried for the binary to compile
    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint).toBeDefined();
    expect(blueprint.name).toBe("wf");
    expect(blueprint.version).toBe("1.0.0");
    expect(Array.isArray(blueprint.instructions)).toBe(true);
    expect((blueprint.instructions as unknown[]).length).toBe(1);
  });

  test("blueprint carries stateSchema when globalState is defined", () => {
    const result = defineWorkflow({
      name: "wf",
      description: "d",
      globalState: { items: { default: () => [], reducer: "concat" as const } },
    })
      .stage({ name: "a", description: "a", prompt: () => "", outputMapper: () => ({}) })
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint.stateSchema).toBeDefined();
    expect((blueprint.stateSchema as Record<string, unknown>).items).toBeDefined();
  });

  test("blueprint instructions contain live function references", () => {
    const promptFn = (ctx: { userPrompt: string }) => `Do: ${ctx.userPrompt}`;
    const result = defineWorkflow({ name: "wf", description: "d" })
      .stage({
        name: "s1",
        description: "d",
        prompt: promptFn as never,
        outputMapper: () => ({}),
      })
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    const instructions = blueprint.instructions as Array<Record<string, unknown>>;
    const config = instructions[0]!.config as Record<string, unknown>;
    expect(config.prompt).toBe(promptFn);
  });
});
