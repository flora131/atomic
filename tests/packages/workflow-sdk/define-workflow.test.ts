/**
 * Tests for the SDK (packages) version of defineWorkflow and WorkflowBuilder.
 *
 * This is a DIFFERENT implementation from the DSL version in
 * `src/services/workflows/dsl/define-workflow.ts`. The SDK version is
 * lightweight — it records instructions without compilation, producing
 * a branded blueprint that the Atomic CLI binary compiles at load time.
 *
 * Source: packages/workflow-sdk/src/define-workflow.ts
 */

import { describe, test, expect } from "bun:test";
import {
  defineWorkflow,
  WorkflowBuilder,
} from "../../../packages/workflow-sdk/src/define-workflow.ts";
import type {
  StageOptions,
  ToolOptions,
  AskUserQuestionOptions,
  StageContext,
  BaseState,
  StateFieldOptions,
} from "../../../packages/workflow-sdk/src/types.ts";

// ---------------------------------------------------------------------------
// Test Helpers — minimal valid option objects
// ---------------------------------------------------------------------------

const stageOpts: StageOptions = {
  name: "planner",
  agent: "planner",
  description: "Plan the work",
  prompt: (ctx: StageContext) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response: string) => ({ plan: response }),
};

const toolOpts: ToolOptions = {
  name: "my-tool",
  execute: async () => ({ computed: true }),
  description: "A tool node",
};

const askOpts: AskUserQuestionOptions = {
  name: "confirm",
  question: { question: "Continue?" },
};

/** Build a StageOptions with a custom name (for multi-stage tests). */
function makeStage(name: string): StageOptions {
  return {
    ...stageOpts,
    name,
  };
}

// ---------------------------------------------------------------------------
// defineWorkflow
// ---------------------------------------------------------------------------

describe("defineWorkflow", () => {
  test("returns a WorkflowBuilder instance", () => {
    const builder = defineWorkflow({ name: "wf", description: "desc" });
    expect(builder).toBeInstanceOf(WorkflowBuilder);
  });

  test("stores name and description from options", () => {
    const builder = defineWorkflow({
      name: "my-workflow",
      description: "My workflow description",
    });
    expect(builder.name).toBe("my-workflow");
    expect(builder.description).toBe("My workflow description");
  });
});

// ---------------------------------------------------------------------------
// WorkflowBuilder — metadata
// ---------------------------------------------------------------------------

describe("WorkflowBuilder metadata", () => {
  test("version() stores version and returns this", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    const result = builder.version("2.0.0");
    expect(result).toBe(builder);
    expect(builder.getVersion()).toBe("2.0.0");
  });

  test("argumentHint() stores hint and returns this", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    const result = builder.argumentHint("<file-path>");
    expect(result).toBe(builder);
    expect(builder.getArgumentHint()).toBe("<file-path>");
  });

  test("getVersion() returns stored version", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).version("3.1.4");
    expect(builder.getVersion()).toBe("3.1.4");
  });

  test("getVersion() returns undefined when not set", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    expect(builder.getVersion()).toBeUndefined();
  });

  test("getArgumentHint() returns stored argument hint", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).argumentHint("--verbose");
    expect(builder.getArgumentHint()).toBe("--verbose");
  });

  test("getArgumentHint() returns undefined when not set", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    expect(builder.getArgumentHint()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WorkflowBuilder — linear flow
// ---------------------------------------------------------------------------

describe("WorkflowBuilder linear flow", () => {
  test("stage() records a stage instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).stage(stageOpts);
    expect(builder.instructions).toHaveLength(1);
    expect(builder.instructions[0]!.type).toBe("stage");
    expect((builder.instructions[0] as { id: string }).id).toBe("planner");
  });

  test("stage() stores the config in the instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).stage(stageOpts);
    const instruction = builder.instructions[0] as { type: string; config: StageOptions };
    expect(instruction.config.name).toBe("planner");
    expect(instruction.config.agent).toBe("planner");
    expect(instruction.config.description).toBe("Plan the work");
    expect(instruction.config.prompt).toBe(stageOpts.prompt);
    expect(instruction.config.outputMapper).toBe(stageOpts.outputMapper);
  });

  test("stage() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    const result = builder.stage(stageOpts);
    expect(result).toBe(builder);
  });

  test("tool() records a tool instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).tool(toolOpts);
    expect(builder.instructions).toHaveLength(1);
    expect(builder.instructions[0]!.type).toBe("tool");
    expect((builder.instructions[0] as { id: string }).id).toBe("my-tool");
  });

  test("tool() stores the config in the instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).tool(toolOpts);
    const instruction = builder.instructions[0] as { type: string; config: ToolOptions };
    expect(instruction.config.name).toBe("my-tool");
    expect(instruction.config.execute).toBe(toolOpts.execute);
  });

  test("tool() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    const result = builder.tool(toolOpts);
    expect(result).toBe(builder);
  });

  test("askUserQuestion() records an askUserQuestion instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).askUserQuestion(askOpts);
    expect(builder.instructions).toHaveLength(1);
    expect(builder.instructions[0]!.type).toBe("askUserQuestion");
    expect((builder.instructions[0] as { id: string }).id).toBe("confirm");
  });

  test("askUserQuestion() stores the config in the instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).askUserQuestion(askOpts);
    const instruction = builder.instructions[0] as { type: string; config: AskUserQuestionOptions };
    expect(instruction.config.name).toBe("confirm");
    expect(instruction.config.question).toEqual({ question: "Continue?" });
  });

  test("askUserQuestion() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    const result = builder.askUserQuestion(askOpts);
    expect(result).toBe(builder);
  });

  test("duplicate node names throw an error for stage", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).stage(makeStage("dup"));
    expect(() => builder.stage(makeStage("dup"))).toThrow(
      'Duplicate node name: "dup"',
    );
  });

  test("duplicate node names throw an error for tool", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).tool(toolOpts);
    expect(() => builder.tool(toolOpts)).toThrow(
      'Duplicate node name: "my-tool"',
    );
  });

  test("duplicate node names throw an error for askUserQuestion", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).askUserQuestion(askOpts);
    expect(() => builder.askUserQuestion(askOpts)).toThrow(
      'Duplicate node name: "confirm"',
    );
  });

  test("duplicate names across different node types throw", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).stage(makeStage("shared"));
    expect(() =>
      builder.tool({ name: "shared", execute: async () => ({}) }),
    ).toThrow('Duplicate node name: "shared"');
  });

  test("multiple unique nodes record in order", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .stage(makeStage("s1"))
      .tool({ ...toolOpts, name: "t1" })
      .askUserQuestion({ ...askOpts, name: "q1" })
      .stage(makeStage("s2"));

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["stage", "tool", "askUserQuestion", "stage"]);
    expect(builder.instructions).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// WorkflowBuilder — conditional branching
// ---------------------------------------------------------------------------

describe("WorkflowBuilder conditional branching", () => {
  test("if/else/endIf records correct instruction sequence", () => {
    const conditionFn = () => true;
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .stage(makeStage("before"))
      .if(conditionFn)
        .stage(makeStage("then-branch"))
      .else()
        .stage(makeStage("else-branch"))
      .endIf();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["stage", "if", "stage", "else", "stage", "endIf"]);
  });

  test("if() stores the condition function", () => {
    const conditionFn = (ctx: StageContext) => ctx.stageOutputs.has("planner");
    const builder = defineWorkflow({ name: "wf", description: "d" }).if(conditionFn);
    const instruction = builder.instructions[0] as { type: string; condition: typeof conditionFn };
    expect(instruction.type).toBe("if");
    expect(instruction.condition).toBe(conditionFn);
  });

  test("if() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    const result = builder.if(() => true);
    expect(result).toBe(builder);
  });

  test("elseIf records instruction", () => {
    const condition1 = () => true;
    const condition2 = () => false;
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .if(condition1)
        .stage(makeStage("a"))
      .elseIf(condition2)
        .stage(makeStage("b"))
      .endIf();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["if", "stage", "elseIf", "stage", "endIf"]);

    const elseIfInstruction = builder.instructions[2] as { type: string; condition: typeof condition2 };
    expect(elseIfInstruction.type).toBe("elseIf");
    expect(elseIfInstruction.condition).toBe(condition2);
  });

  test("elseIf() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).if(() => true);
    const result = builder.elseIf(() => false);
    expect(result).toBe(builder);
  });

  test("else() records an else instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .if(() => true)
      .else();

    expect(builder.instructions[1]!.type).toBe("else");
  });

  test("else() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).if(() => true);
    const result = builder.else();
    expect(result).toBe(builder);
  });

  test("endIf() records an endIf instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .if(() => true)
      .endIf();

    expect(builder.instructions[1]!.type).toBe("endIf");
  });

  test("endIf() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).if(() => true);
    const result = builder.endIf();
    expect(result).toBe(builder);
  });

  test("if/elseIf/else/endIf full chain records all instructions", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .if(() => true)
        .stage(makeStage("a"))
      .elseIf(() => false)
        .stage(makeStage("b"))
      .else()
        .stage(makeStage("c"))
      .endIf();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["if", "stage", "elseIf", "stage", "else", "stage", "endIf"]);
  });
});

// ---------------------------------------------------------------------------
// WorkflowBuilder — loops
// ---------------------------------------------------------------------------

describe("WorkflowBuilder loops", () => {
  test("loop/endLoop records correct instructions", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop({ maxCycles: 3 })
        .stage(makeStage("loop-stage"))
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "stage", "endLoop"]);
  });

  test("loop() stores config in instruction", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop({ maxCycles: 10 });

    const instruction = builder.instructions[0] as { type: string; config: { maxCycles?: number } };
    expect(instruction.type).toBe("loop");
    expect(instruction.config.maxCycles).toBe(10);
  });

  test("loop() with no options stores empty config", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).loop();
    const instruction = builder.instructions[0] as { type: string; config: Record<string, unknown> };
    expect(instruction.config).toEqual({});
  });

  test("loop() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    const result = builder.loop();
    // Must also endLoop to leave loop state clean
    result.endLoop();
    expect(result).toBe(builder);
  });

  test("endLoop without loop throws", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    expect(() => builder.endLoop()).toThrow("endLoop() called without a matching loop()");
  });

  test("endLoop() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" }).loop();
    const result = builder.endLoop();
    expect(result).toBe(builder);
  });

  test("break inside loop records instruction", () => {
    const breakCondition = () => (state: BaseState) => state.outputs["done"] === true;
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop({ maxCycles: 5 })
        .stage(makeStage("step"))
        .break(breakCondition)
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "stage", "break", "endLoop"]);

    const breakInstruction = builder.instructions[2] as { type: string; condition?: typeof breakCondition };
    expect(breakInstruction.type).toBe("break");
    expect(breakInstruction.condition).toBe(breakCondition);
  });

  test("break without condition records instruction with no condition", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop()
        .break()
      .endLoop();

    const breakInstruction = builder.instructions[1] as { type: string; condition?: unknown };
    expect(breakInstruction.type).toBe("break");
    expect(breakInstruction.condition).toBeUndefined();
  });

  test("break outside loop throws", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    expect(() => builder.break()).toThrow("break() can only be used inside a loop() block");
  });

  test("nested loops track depth correctly", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop()
        .stage(makeStage("outer"))
        .loop()
          .stage(makeStage("inner"))
          .break()
        .endLoop()
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual([
      "loop", "stage", "loop", "stage", "break", "endLoop", "endLoop",
    ]);
  });

  test("endLoop after nested loop closure still allows break in outer", () => {
    // After inner loop is closed, we're still inside the outer loop
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop()
        .loop()
          .stage(makeStage("inner"))
        .endLoop()
        .break() // valid — still inside outer loop
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "loop", "stage", "endLoop", "break", "endLoop"]);
  });
});

// ---------------------------------------------------------------------------
// WorkflowBuilder — compile
// ---------------------------------------------------------------------------

describe("WorkflowBuilder compile", () => {
  test("compile returns object with __compiledWorkflow: true", () => {
    const result = defineWorkflow({ name: "wf", description: "desc" })
      .stage(stageOpts)
      .compile();

    expect(result.__compiledWorkflow).toBe(true);
  });

  test("compile returns name and description on the result", () => {
    const result = defineWorkflow({ name: "my-wf", description: "My desc" })
      .stage(stageOpts)
      .compile();

    expect(result.name).toBe("my-wf");
    expect(result.description).toBe("My desc");
  });

  test("compile returns __blueprint with name, description, instructions", () => {
    const result = defineWorkflow({ name: "wf", description: "desc" })
      .stage(stageOpts)
      .tool({ ...toolOpts, name: "t1" })
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint).toBeDefined();
    expect(blueprint.name).toBe("wf");
    expect(blueprint.description).toBe("desc");
    expect(Array.isArray(blueprint.instructions)).toBe(true);
    expect((blueprint.instructions as unknown[]).length).toBe(2);
  });

  test("compile includes version when set", () => {
    const result = defineWorkflow({ name: "wf", description: "d" })
      .version("1.0.0")
      .stage(stageOpts)
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint.version).toBe("1.0.0");
  });

  test("compile omits version when not set", () => {
    const result = defineWorkflow({ name: "wf", description: "d" })
      .stage(stageOpts)
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint.version).toBeUndefined();
  });

  test("compile includes argumentHint when set", () => {
    const result = defineWorkflow({ name: "wf", description: "d" })
      .argumentHint("<file>")
      .stage(stageOpts)
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint.argumentHint).toBe("<file>");
  });

  test("compile omits argumentHint when not set", () => {
    const result = defineWorkflow({ name: "wf", description: "d" })
      .stage(stageOpts)
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint.argumentHint).toBeUndefined();
  });

  test("compile includes stateSchema when globalState is defined", () => {
    const result = defineWorkflow({
      name: "wf",
      description: "d",
      globalState: {
        items: { default: () => [], reducer: "concat" as const },
      },
    })
      .stage(stageOpts)
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint.stateSchema).toBeDefined();
    expect((blueprint.stateSchema as Record<string, unknown>).items).toBeDefined();
  });

  test("compile blueprint instructions preserve live function references", () => {
    const promptFn = stageOpts.prompt;
    const result = defineWorkflow({ name: "wf", description: "d" })
      .stage(stageOpts)
      .compile();

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    const instructions = blueprint.instructions as Array<Record<string, unknown>>;
    const config = instructions[0]!.config as Record<string, unknown>;
    expect(config.prompt).toBe(promptFn);
  });

  test("compile with full chain produces correct blueprint", () => {
    const result = defineWorkflow({ name: "full-wf", description: "Full workflow" })
      .version("2.0.0")
      .argumentHint("<path>")
      .stage(makeStage("s1"))
      .if(() => true)
        .stage(makeStage("s2"))
      .else()
        .stage(makeStage("s3"))
      .endIf()
      .loop({ maxCycles: 3 })
        .stage(makeStage("loop-s"))
        .break()
      .endLoop()
      .compile();

    expect(result.__compiledWorkflow).toBe(true);
    expect(result.name).toBe("full-wf");

    const blueprint = (result as unknown as Record<string, unknown>).__blueprint as Record<string, unknown>;
    expect(blueprint.version).toBe("2.0.0");
    expect(blueprint.argumentHint).toBe("<path>");

    const instructions = blueprint.instructions as Array<{ type: string }>;
    const types = instructions.map((i) => i.type);
    expect(types).toEqual([
      "stage", "if", "stage", "else", "stage", "endIf",
      "loop", "stage", "break", "endLoop",
    ]);
  });
});

// ---------------------------------------------------------------------------
// WorkflowBuilder — getStateSchema
// ---------------------------------------------------------------------------

describe("WorkflowBuilder getStateSchema", () => {
  test("returns undefined when no global state or loop state", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" });
    expect(builder.getStateSchema()).toBeUndefined();
  });

  test("returns undefined with loops that have no loopState", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop({ maxCycles: 5 })
        .stage(makeStage("s"))
      .endLoop();
    expect(builder.getStateSchema()).toBeUndefined();
  });

  test("returns global state when provided", () => {
    const globalState: Record<string, StateFieldOptions> = {
      count: { default: 0, reducer: "sum" as const },
      items: { default: () => [], reducer: "concat" as const },
    };
    const builder = defineWorkflow({
      name: "wf",
      description: "d",
      globalState,
    });

    const schema = builder.getStateSchema();
    expect(schema).toBeDefined();
    expect(schema!.count).toBeDefined();
    expect(schema!.count!.default).toBe(0);
    expect(schema!.count!.reducer).toBe("sum");
    expect(schema!.items).toBeDefined();
    expect(schema!.items!.reducer).toBe("concat");
  });

  test("returns loop state when provided without global state", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop({
        maxCycles: 3,
        loopState: {
          iteration: { default: 0, reducer: "sum" as const },
        },
      })
        .stage(makeStage("s"))
      .endLoop();

    const schema = builder.getStateSchema();
    expect(schema).toBeDefined();
    expect(schema!.iteration).toBeDefined();
    expect(schema!.iteration!.default).toBe(0);
  });

  test("merges global state and loop states", () => {
    const builder = defineWorkflow({
      name: "wf",
      description: "d",
      globalState: {
        count: { default: 0, reducer: "sum" as const },
      },
    })
      .loop({
        maxCycles: 5,
        loopState: {
          iteration: { default: 0, reducer: "sum" as const },
        },
      })
        .stage(makeStage("s1"))
      .endLoop();

    const schema = builder.getStateSchema();
    expect(schema).toBeDefined();
    expect(schema!.count).toBeDefined();
    expect(schema!.iteration).toBeDefined();
  });

  test("merges multiple loop states", () => {
    const builder = defineWorkflow({ name: "wf", description: "d" })
      .loop({
        loopState: { alpha: { default: "a" } },
      })
        .stage(makeStage("s1"))
      .endLoop()
      .loop({
        loopState: { beta: { default: "b" } },
      })
        .stage(makeStage("s2"))
      .endLoop();

    const schema = builder.getStateSchema();
    expect(schema).toBeDefined();
    expect(schema!.alpha).toBeDefined();
    expect(schema!.beta).toBeDefined();
  });

  test("loop state overrides global state for same key", () => {
    const builder = defineWorkflow({
      name: "wf",
      description: "d",
      globalState: {
        shared: { default: "global", reducer: "replace" as const },
      },
    })
      .loop({
        loopState: {
          shared: { default: "loop", reducer: "concat" as const },
        },
      })
        .stage(makeStage("s1"))
      .endLoop();

    const schema = builder.getStateSchema();
    expect(schema).toBeDefined();
    // Object.assign spreads loop state after global, so loop wins
    expect(schema!.shared!.default).toBe("loop");
    expect(schema!.shared!.reducer).toBe("concat");
  });
});
