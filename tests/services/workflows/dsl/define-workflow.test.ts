/**
 * Tests for the WorkflowBuilder class and defineWorkflow() entry point.
 *
 * Verifies:
 * - defineWorkflow() returns a WorkflowBuilder instance
 * - Metadata methods (version, argumentHint, state) store values and return this
 * - Linear flow methods (stage, tool) record instructions
 * - Conditional branching methods (if, elseIf, else, endIf) record instructions
 * - Bounded loop methods (loop, endLoop) record instructions
 * - Getter methods return stored metadata
 * - Fluent chaining produces correct instruction sequences
 * - compile() throws until wired to the compiler
 * - WorkflowBuilder implements WorkflowBuilderInterface
 */

import { describe, test, expect } from "bun:test";
import {
  defineWorkflow,
  WorkflowBuilder,
} from "@/services/workflows/dsl/define-workflow.ts";
import type {
  Instruction,
  StageOptions,
  ToolOptions,
  LoopOptions,
  StateFieldOptions,
  WorkflowBuilderInterface,
} from "@/services/workflows/dsl/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid StageOptions for test use. */
function makeStageOptions(overrides?: Partial<StageOptions>): StageOptions {
  return {
    name: overrides?.name ?? "test-stage",
    agent: "test-stage",
    description: "A test stage",
    prompt: (ctx: StageContext) => `Prompt: ${ctx.userPrompt}`,
    outputMapper: (response: string) => ({ result: response }),
    ...overrides,
  };
}

/** Minimal valid ToolOptions for test use. */
function makeToolOptions(overrides?: Partial<ToolOptions>): ToolOptions {
  return {
    name: "test-tool",
    execute: async () => ({ computed: true }),
    ...overrides,
  };
}

/** Minimal valid LoopOptions for test use. */
function makeLoopOptions(overrides?: Partial<LoopOptions>): LoopOptions {
  return {
    maxCycles: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// defineWorkflow() entry point
// ---------------------------------------------------------------------------

describe("defineWorkflow()", () => {
  test("returns a WorkflowBuilder instance", () => {
    const builder = defineWorkflow({ name: "my-workflow", description: "Does something" });

    expect(builder).toBeInstanceOf(WorkflowBuilder);
  });

  test("sets name and description on the builder", () => {
    const builder = defineWorkflow({ name: "task-runner", description: "Runs tasks in sequence" });

    expect(builder.name).toBe("task-runner");
    expect(builder.description).toBe("Runs tasks in sequence");
  });

  test("starts with an empty instructions array", () => {
    const builder = defineWorkflow({ name: "empty", description: "No instructions yet" });

    expect(builder.instructions).toEqual([]);
    expect(builder.instructions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Metadata methods
// ---------------------------------------------------------------------------

describe("WorkflowBuilder metadata", () => {
  test("version() stores the version and returns this", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    const result = builder.version("2.1.0");

    expect(result).toBe(builder);
    expect(builder.getVersion()).toBe("2.1.0");
  });

  test("version() can be overwritten by a subsequent call", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .version("1.0.0")
      .version("2.0.0");

    expect(builder.getVersion()).toBe("2.0.0");
  });

  test("argumentHint() stores the hint and returns this", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    const result = builder.argumentHint("<file-path>");

    expect(result).toBe(builder);
    expect(builder.getArgumentHint()).toBe("<file-path>");
  });

  test("globalState option stores the schema on the builder", () => {
    const schema: Record<string, StateFieldOptions> = {
      count: { default: 0, reducer: "sum" },
      items: { default: () => [], reducer: "concat" },
    };

    const builder = defineWorkflow({ name: "w", description: "d", globalState: schema });

    expect(builder.getStateSchema()).toEqual(schema);
  });

  test("getVersion() returns undefined when not set", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    expect(builder.getVersion()).toBeUndefined();
  });

  test("getArgumentHint() returns undefined when not set", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    expect(builder.getArgumentHint()).toBeUndefined();
  });

  test("getStateSchema() returns undefined when no globalState or loopState", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    expect(builder.getStateSchema()).toBeUndefined();
  });

  test("getStateSchema() merges globalState and loopState", () => {
    const builder = defineWorkflow({
      name: "w",
      description: "d",
      globalState: { count: { default: 0, reducer: "sum" } },
    })
      .loop({ maxCycles: 3, loopState: { iteration: { default: 0 } } })
        .stage(makeStageOptions({ name: "review" }))
      .endLoop();

    const schema = builder.getStateSchema();
    expect(schema).toBeDefined();
    expect(schema!.count).toEqual({ default: 0, reducer: "sum" });
    expect(schema!.iteration).toEqual({ default: 0 });
  });

  test("getStateSchema() returns loopState-only schema when no globalState", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop({ maxCycles: 5, loopState: { attempts: { default: 0 } } })
        .stage(makeStageOptions({ name: "retry" }))
      .endLoop();

    const schema = builder.getStateSchema();
    expect(schema).toBeDefined();
    expect(schema!.attempts).toEqual({ default: 0 });
  });
});

// ---------------------------------------------------------------------------
// Linear flow — stage()
// ---------------------------------------------------------------------------

describe("WorkflowBuilder.stage()", () => {
  test("records a stage instruction", () => {
    const config = makeStageOptions({ name: "planner" });
    const builder = defineWorkflow({ name: "w", description: "d" }).stage(config);

    expect(builder.instructions.length).toBe(1);
    expect(builder.instructions[0]!.type).toBe("stage");

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "stage" }
    >;
    expect(instruction.id).toBe("planner");
    expect(instruction.config).toBe(config);
  });

  test("returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    const result = builder.stage(makeStageOptions());

    expect(result).toBe(builder);
  });

  test("multiple stages are recorded in order", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .stage(makeStageOptions({ name: "stage-1" }))
      .stage(makeStageOptions({ name: "stage-2" }))
      .stage(makeStageOptions({ name: "stage-3" }));

    expect(builder.instructions.length).toBe(3);

    const ids = builder.instructions.map((i) => {
      if (i.type === "stage") return i.id;
      return null;
    });
    expect(ids).toEqual(["stage-1", "stage-2", "stage-3"]);
  });
});

// ---------------------------------------------------------------------------
// Linear flow — tool()
// ---------------------------------------------------------------------------

describe("WorkflowBuilder.tool()", () => {
  test("records a tool instruction", () => {
    const config = makeToolOptions({ name: "Parser" });
    const builder = defineWorkflow({ name: "w", description: "d" }).tool("parser", config);

    expect(builder.instructions.length).toBe(1);
    expect(builder.instructions[0]!.type).toBe("tool");

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "tool" }
    >;
    expect(instruction.id).toBe("parser");
    expect(instruction.config).toBe(config);
  });

  test("returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    const result = builder.tool("t1", makeToolOptions());

    expect(result).toBe(builder);
  });
});

// ---------------------------------------------------------------------------
// Conditional branching — if / elseIf / else / endIf
// ---------------------------------------------------------------------------

describe("WorkflowBuilder conditional branching", () => {
  test("if() records an if instruction with condition", () => {
    const condition = (ctx: StageContext) => ctx.stageOutputs.has("planner");
    const builder = defineWorkflow({ name: "w", description: "d" }).if(condition);

    expect(builder.instructions.length).toBe(1);
    expect(builder.instructions[0]!.type).toBe("if");

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "if" }
    >;
    expect(instruction.condition).toBe(condition);
  });

  test("if() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    const result = builder.if(() => true);

    expect(result).toBe(builder);
  });

  test("elseIf() records an elseIf instruction with condition", () => {
    const condition = () => false;
    const builder = defineWorkflow({ name: "w", description: "d" })
      .if(() => true)
      .elseIf(condition);

    expect(builder.instructions.length).toBe(2);
    expect(builder.instructions[1]!.type).toBe("elseIf");

    const instruction = builder.instructions[1] as Extract<
      Instruction,
      { type: "elseIf" }
    >;
    expect(instruction.condition).toBe(condition);
  });

  test("elseIf() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" }).if(() => true);
    const result = builder.elseIf(() => false);

    expect(result).toBe(builder);
  });

  test("else() records an else instruction", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .if(() => true)
      .else();

    expect(builder.instructions.length).toBe(2);
    expect(builder.instructions[1]!.type).toBe("else");
  });

  test("else() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" }).if(() => true);
    const result = builder.else();

    expect(result).toBe(builder);
  });

  test("endIf() records an endIf instruction", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .if(() => true)
      .endIf();

    expect(builder.instructions.length).toBe(2);
    expect(builder.instructions[1]!.type).toBe("endIf");
  });

  test("endIf() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" }).if(() => true);
    const result = builder.endIf();

    expect(result).toBe(builder);
  });

  test("full if/elseIf/else/endIf sequence records correct instruction types", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .if(() => true)
      .stage(makeStageOptions({ name: "s1" }))
      .elseIf(() => false)
      .stage(makeStageOptions({ name: "s2" }))
      .else()
      .stage(makeStageOptions({ name: "s3" }))
      .endIf();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual([
      "if",
      "stage",
      "elseIf",
      "stage",
      "else",
      "stage",
      "endIf",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Bounded loops — loop / endLoop
// ---------------------------------------------------------------------------

describe("WorkflowBuilder bounded loops", () => {
  test("loop() records a loop instruction with config", () => {
    const config = makeLoopOptions({ maxCycles: 10 });
    const builder = defineWorkflow({ name: "w", description: "d" }).loop(config);

    expect(builder.instructions.length).toBe(1);
    expect(builder.instructions[0]!.type).toBe("loop");

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "loop" }
    >;
    expect(instruction.config).toBe(config);
  });

  test("loop() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });
    const result = builder.loop(makeLoopOptions());

    expect(result).toBe(builder);
  });

  test("endLoop() records an endLoop instruction", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions())
      .endLoop();

    expect(builder.instructions.length).toBe(2);
    expect(builder.instructions[1]!.type).toBe("endLoop");
  });

  test("endLoop() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" }).loop(makeLoopOptions());
    const result = builder.endLoop();

    expect(result).toBe(builder);
  });

  test("loop with body records correct instruction sequence", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions({ maxCycles: 3 }))
      .stage(makeStageOptions({ name: "review" }))
      .tool("check", makeToolOptions())
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "stage", "tool", "endLoop"]);
  });

  test("endLoop() throws when called outside a loop", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });

    expect(() => builder.endLoop()).toThrow(
      "endLoop() called without a matching loop()",
    );
  });

  test("endLoop() throws after all loops are closed", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions())
      .endLoop();

    expect(() => builder.endLoop()).toThrow(
      "endLoop() called without a matching loop()",
    );
  });

  test("loop() can be called with no arguments (config defaults to {})", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop()
      .stage(makeStageOptions({ name: "review" }))
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "stage", "endLoop"]);

    const loopInstruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "loop" }
    >;
    expect(loopInstruction.config).toEqual({});
  });

  test("break() records a break instruction inside a loop", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions())
      .break()
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "break", "endLoop"]);
  });

  test("break() without a condition stores no condition on the instruction", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions())
      .break()
      .endLoop();

    const breakInstruction = builder.instructions[1] as Extract<
      Instruction,
      { type: "break" }
    >;
    expect(breakInstruction.condition).toBeUndefined();
  });

  test("break() with a condition factory stores the condition on the instruction", () => {
    const conditionFactory = () => (state: { outputs: Record<string, unknown> }) =>
      "reviewer" in state.outputs;
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions())
      .break(conditionFactory)
      .endLoop();

    const breakInstruction = builder.instructions[1] as Extract<
      Instruction,
      { type: "break" }
    >;
    expect(breakInstruction.condition).toBe(conditionFactory);
  });

  test("break() returns this for chaining", () => {
    const builder = defineWorkflow({ name: "w", description: "d" }).loop(makeLoopOptions());
    const result = builder.break();

    expect(result).toBe(builder);
  });

  test("break() throws when called outside a loop", () => {
    const builder = defineWorkflow({ name: "w", description: "d" });

    expect(() => builder.break()).toThrow(
      "break() can only be used inside a loop() block",
    );
  });

  test("break() works inside nested loops", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "outer" }))
        .loop(makeLoopOptions())
          .break()
        .endLoop()
        .break()
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual([
      "loop", "stage", "loop", "break", "endLoop", "break", "endLoop",
    ]);
  });

  test("break() throws after all loops are closed", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions())
      .endLoop();

    expect(() => builder.break()).toThrow(
      "break() can only be used inside a loop() block",
    );
  });

  test("loop with break and conditional records correct instruction sequence", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "review" }))
        .if(() => true)
          .break()
        .endIf()
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "stage", "if", "break", "endIf", "endLoop"]);
  });
});

// ---------------------------------------------------------------------------
// compile() — wired to the DSL compiler
// ---------------------------------------------------------------------------

describe("WorkflowBuilder.compile()", () => {
  test("returns a CompiledWorkflow with __compiledWorkflow property", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .stage(makeStageOptions());

    const compiled = builder.compile();

    expect(compiled).toBeDefined();
    expect(compiled.__compiledWorkflow).toBeDefined();
  });

  test("compiled workflow wraps a WorkflowDefinition with correct metadata", () => {
    const builder = defineWorkflow({ name: "my-wf", description: "My workflow" })
      .version("2.0.0")
      .argumentHint("<path>")
      .stage(makeStageOptions({ name: "first-stage" }));

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;

    expect(definition.name).toBe("my-wf");
    expect(definition.description).toBe("My workflow");
    expect(definition.version).toBe("2.0.0");
    expect(definition.argumentHint).toBe("<path>");
    expect(definition.source).toBe("builtin");
  });

  test("compiled workflow contains conductorStages from stage instructions", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .stage(makeStageOptions({ name: "planner" }))
      .stage(makeStageOptions({ name: "executor" }));

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;
    const stages = definition.conductorStages as Array<{ id: string }>;

    expect(stages).toHaveLength(2);
    expect(stages[0]!.id).toBe("planner");
    expect(stages[1]!.id).toBe("executor");
  });

  test("compiled workflow has a createConductorGraph function", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .stage(makeStageOptions());

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;

    expect(typeof definition.createConductorGraph).toBe("function");
  });

  test("compiled workflow has a createState function", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .stage(makeStageOptions());

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;

    expect(typeof definition.createState).toBe("function");
  });

  test("compile() throws on invalid instruction sequence", () => {
    // No stages or tools — should throw
    const builder = defineWorkflow({ name: "w", description: "d" });

    expect(() => builder.compile()).toThrow(
      "Workflow must have at least one stage or tool node",
    );
  });

  test("duplicate stage names throw at definition time", () => {
    expect(() =>
      defineWorkflow({ name: "w", description: "d" })
        .stage(makeStageOptions({ name: "dup" }))
        .stage(makeStageOptions({ name: "dup" })),
    ).toThrow('Duplicate stage name: "dup"');
  });

  test("compile() throws on unbalanced if/endIf", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .stage(makeStageOptions({ name: "s1" }))
      .if(() => true)
      .stage(makeStageOptions({ name: "s2" }));

    expect(() => builder.compile()).toThrow('unclosed "if" block(s)');
  });

  test("compiled graph includes node descriptions", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .stage(makeStageOptions({ name: "planner", agent: "planner-agent" }))
      .tool("parser", makeToolOptions({ name: "Parse Output" }));

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;
    const descriptions = definition.nodeDescriptions as Record<string, string>;

    expect(descriptions.planner).toBe("planner-agent");
    expect(descriptions.parser).toBe("Parse Output");
  });

  test("compile() with globalState creates a working state factory", () => {
    const builder = defineWorkflow({
      name: "w",
      description: "d",
      globalState: {
        count: { default: 0, reducer: "sum" },
        items: { default: () => [], reducer: "concat" },
      },
    })
      .stage(makeStageOptions());

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;
    const createState = definition.createState as (params: {
      prompt: string;
      sessionId: string;
      sessionDir: string;
      maxIterations: number;
    }) => Record<string, unknown>;

    const state = createState({
      prompt: "test",
      sessionId: "sid",
      sessionDir: "/tmp",
      maxIterations: 10,
    });

    // Custom state fields are initialized from schema defaults
    expect(state.count).toBe(0);
    expect(state.items).toEqual([]);
    // BaseState fields are populated by the factory
    expect(state.executionId).toBe("sid");
    expect(state.outputs).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Fluent chaining — end-to-end workflow definition
// ---------------------------------------------------------------------------

describe("WorkflowBuilder fluent chaining", () => {
  test("complex workflow produces correct instruction tape", () => {
    const builder = defineWorkflow({
      name: "complex-workflow",
      description: "A multi-stage workflow",
      globalState: {
        plan: { default: "" },
        results: { default: () => [], reducer: "concat" },
        iteration: { default: 0, reducer: "sum" },
      },
    })
      .version("1.0.0")
      .argumentHint("<task-description>")
      .stage(makeStageOptions({ name: "planner" }))
      .if((ctx) => ctx.stageOutputs.has("planner"))
        .stage(makeStageOptions({ name: "executor" }))
        .tool("parser", makeToolOptions({ name: "Output Parser" }))
        .loop({ maxCycles: 3 })
          .stage(makeStageOptions({ name: "reviewer" }))
          .if((ctx) => !ctx.stageOutputs.has("reviewer"))
            .stage(makeStageOptions({ name: "debugger" }))
          .endIf()
        .endLoop()
      .else()
        .stage(makeStageOptions({ name: "fallback" }))
      .endIf();

    // Verify metadata
    expect(builder.name).toBe("complex-workflow");
    expect(builder.description).toBe("A multi-stage workflow");
    expect(builder.getVersion()).toBe("1.0.0");
    expect(builder.getArgumentHint()).toBe("<task-description>");
    expect(builder.getStateSchema()).toBeDefined();

    // Verify instruction tape
    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual([
      "stage",     // planner
      "if",        // condition check
      "stage",     // executor
      "tool",      // parser
      "loop",      // review loop
      "stage",     // reviewer
      "if",        // nested condition
      "stage",     // debugger
      "endIf",     // close nested if
      "endLoop",   // close loop
      "else",      // fallback branch
      "stage",     // fallback stage
      "endIf",     // close outer if
    ]);

    expect(builder.instructions.length).toBe(13);
  });

  test("metadata does not add instructions", () => {
    const builder = defineWorkflow({
      name: "w",
      description: "d",
      globalState: { x: { default: 0 } },
    })
      .version("1.0.0")
      .argumentHint("hint");

    expect(builder.instructions.length).toBe(0);
  });

  test("stages and tools can be mixed freely", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .stage(makeStageOptions({ name: "s1" }))
      .tool("t1", makeToolOptions())
      .stage(makeStageOptions({ name: "s2" }))
      .tool("t2", makeToolOptions());

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["stage", "tool", "stage", "tool"]);
  });
});

// ---------------------------------------------------------------------------
// Interface conformance
// ---------------------------------------------------------------------------

describe("WorkflowBuilder interface conformance", () => {
  test("WorkflowBuilder satisfies WorkflowBuilderInterface", () => {
    // This is a compile-time check — if this compiles, the interface is satisfied
    const builder: WorkflowBuilderInterface = defineWorkflow({ name: "w", description: "d" });

    // Verify all methods exist and return this
    expect(typeof builder.version).toBe("function");
    expect(typeof builder.argumentHint).toBe("function");
    expect(typeof builder.stage).toBe("function");
    expect(typeof builder.tool).toBe("function");
    expect(typeof builder.if).toBe("function");
    expect(typeof builder.elseIf).toBe("function");
    expect(typeof builder.else).toBe("function");
    expect(typeof builder.endIf).toBe("function");
    expect(typeof builder.loop).toBe("function");
    expect(typeof builder.endLoop).toBe("function");
    expect(typeof builder.break).toBe("function");
    expect(typeof builder.compile).toBe("function");
  });

  test("chaining through the interface type works correctly", () => {
    const builder: WorkflowBuilderInterface = defineWorkflow({ name: "w", description: "d" });

    // Every chained call should return the same builder via `this`
    const chained = builder
      .version("1.0.0")
      .argumentHint("hint")
      .stage(makeStageOptions())
      .tool("t1", makeToolOptions())
      .if(() => true)
      .else()
      .endIf()
      .loop(makeLoopOptions())
      .break()
      .endLoop();

    expect(chained).toBe(builder);
  });
});

// ---------------------------------------------------------------------------
// Instruction reference preservation
// ---------------------------------------------------------------------------

describe("WorkflowBuilder instruction reference integrity", () => {
  test("stage config references are preserved (not cloned)", () => {
    const config = makeStageOptions();
    const builder = defineWorkflow({ name: "w", description: "d" }).stage(config);

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "stage" }
    >;
    expect(instruction.config).toBe(config);
  });

  test("tool config references are preserved (not cloned)", () => {
    const config = makeToolOptions();
    const builder = defineWorkflow({ name: "w", description: "d" }).tool("t1", config);

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "tool" }
    >;
    expect(instruction.config).toBe(config);
  });

  test("loop config references are preserved (not cloned)", () => {
    const config = makeLoopOptions();
    const builder = defineWorkflow({ name: "w", description: "d" }).loop(config);

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "loop" }
    >;
    expect(instruction.config).toBe(config);
  });

  test("condition function references are preserved", () => {
    const condition = () => true;
    const builder = defineWorkflow({ name: "w", description: "d" }).if(condition);

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "if" }
    >;
    expect(instruction.condition).toBe(condition);
  });
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe("WorkflowBuilder constructor", () => {
  test("can be constructed directly", () => {
    const builder = new WorkflowBuilder({ name: "direct", description: "Constructed directly" });

    expect(builder.name).toBe("direct");
    expect(builder.description).toBe("Constructed directly");
    expect(builder.instructions).toEqual([]);
  });

  test("readonly properties are set correctly", () => {
    const builder = new WorkflowBuilder({ name: "test", description: "Test workflow" });

    expect(builder.name).toBe("test");
    expect(builder.description).toBe("Test workflow");
  });
});
