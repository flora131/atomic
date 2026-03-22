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
  StageConfig,
  ToolConfig,
  LoopConfig,
  StateFieldConfig,
  WorkflowBuilderInterface,
} from "@/services/workflows/dsl/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid StageConfig for test use. */
function makeStageConfig(overrides?: Partial<StageConfig>): StageConfig {
  return {
    name: "test-stage",
    description: "A test stage",
    prompt: (ctx: StageContext) => `Prompt: ${ctx.userPrompt}`,
    outputMapper: (response: string) => ({ result: response }),
    ...overrides,
  };
}

/** Minimal valid ToolConfig for test use. */
function makeToolConfig(overrides?: Partial<ToolConfig>): ToolConfig {
  return {
    name: "test-tool",
    execute: async () => ({ computed: true }),
    ...overrides,
  };
}

/** Minimal valid LoopConfig for test use. */
function makeLoopConfig(overrides?: Partial<LoopConfig>): LoopConfig {
  return {
    until: () => true,
    maxCycles: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// defineWorkflow() entry point
// ---------------------------------------------------------------------------

describe("defineWorkflow()", () => {
  test("returns a WorkflowBuilder instance", () => {
    const builder = defineWorkflow("my-workflow", "Does something");

    expect(builder).toBeInstanceOf(WorkflowBuilder);
  });

  test("sets name and description on the builder", () => {
    const builder = defineWorkflow("task-runner", "Runs tasks in sequence");

    expect(builder.name).toBe("task-runner");
    expect(builder.description).toBe("Runs tasks in sequence");
  });

  test("starts with an empty instructions array", () => {
    const builder = defineWorkflow("empty", "No instructions yet");

    expect(builder.instructions).toEqual([]);
    expect(builder.instructions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Metadata methods
// ---------------------------------------------------------------------------

describe("WorkflowBuilder metadata", () => {
  test("version() stores the version and returns this", () => {
    const builder = defineWorkflow("w", "d");
    const result = builder.version("2.1.0");

    expect(result).toBe(builder);
    expect(builder.getVersion()).toBe("2.1.0");
  });

  test("version() can be overwritten by a subsequent call", () => {
    const builder = defineWorkflow("w", "d")
      .version("1.0.0")
      .version("2.0.0");

    expect(builder.getVersion()).toBe("2.0.0");
  });

  test("argumentHint() stores the hint and returns this", () => {
    const builder = defineWorkflow("w", "d");
    const result = builder.argumentHint("<file-path>");

    expect(result).toBe(builder);
    expect(builder.getArgumentHint()).toBe("<file-path>");
  });

  test("state() stores the schema and returns this", () => {
    const schema: Record<string, StateFieldConfig> = {
      count: { default: 0, reducer: "sum" },
      items: { default: () => [], reducer: "concat" },
    };

    const builder = defineWorkflow("w", "d");
    const result = builder.state(schema);

    expect(result).toBe(builder);
    expect(builder.getStateSchema()).toBe(schema);
  });

  test("getVersion() returns undefined when not set", () => {
    const builder = defineWorkflow("w", "d");
    expect(builder.getVersion()).toBeUndefined();
  });

  test("getArgumentHint() returns undefined when not set", () => {
    const builder = defineWorkflow("w", "d");
    expect(builder.getArgumentHint()).toBeUndefined();
  });

  test("getStateSchema() returns undefined when not set", () => {
    const builder = defineWorkflow("w", "d");
    expect(builder.getStateSchema()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Linear flow — stage()
// ---------------------------------------------------------------------------

describe("WorkflowBuilder.stage()", () => {
  test("records a stage instruction", () => {
    const config = makeStageConfig({ name: "Planner" });
    const builder = defineWorkflow("w", "d").stage("planner", config);

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
    const builder = defineWorkflow("w", "d");
    const result = builder.stage("s1", makeStageConfig());

    expect(result).toBe(builder);
  });

  test("multiple stages are recorded in order", () => {
    const builder = defineWorkflow("w", "d")
      .stage("s1", makeStageConfig({ name: "Stage 1" }))
      .stage("s2", makeStageConfig({ name: "Stage 2" }))
      .stage("s3", makeStageConfig({ name: "Stage 3" }));

    expect(builder.instructions.length).toBe(3);

    const ids = builder.instructions.map((i) => {
      if (i.type === "stage") return i.id;
      return null;
    });
    expect(ids).toEqual(["s1", "s2", "s3"]);
  });
});

// ---------------------------------------------------------------------------
// Linear flow — tool()
// ---------------------------------------------------------------------------

describe("WorkflowBuilder.tool()", () => {
  test("records a tool instruction", () => {
    const config = makeToolConfig({ name: "Parser" });
    const builder = defineWorkflow("w", "d").tool("parser", config);

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
    const builder = defineWorkflow("w", "d");
    const result = builder.tool("t1", makeToolConfig());

    expect(result).toBe(builder);
  });
});

// ---------------------------------------------------------------------------
// Conditional branching — if / elseIf / else / endIf
// ---------------------------------------------------------------------------

describe("WorkflowBuilder conditional branching", () => {
  test("if() records an if instruction with condition", () => {
    const condition = (ctx: StageContext) => ctx.stageOutputs.has("planner");
    const builder = defineWorkflow("w", "d").if(condition);

    expect(builder.instructions.length).toBe(1);
    expect(builder.instructions[0]!.type).toBe("if");

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "if" }
    >;
    expect(instruction.condition).toBe(condition);
  });

  test("if() returns this for chaining", () => {
    const builder = defineWorkflow("w", "d");
    const result = builder.if(() => true);

    expect(result).toBe(builder);
  });

  test("elseIf() records an elseIf instruction with condition", () => {
    const condition = () => false;
    const builder = defineWorkflow("w", "d")
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
    const builder = defineWorkflow("w", "d").if(() => true);
    const result = builder.elseIf(() => false);

    expect(result).toBe(builder);
  });

  test("else() records an else instruction", () => {
    const builder = defineWorkflow("w", "d")
      .if(() => true)
      .else();

    expect(builder.instructions.length).toBe(2);
    expect(builder.instructions[1]!.type).toBe("else");
  });

  test("else() returns this for chaining", () => {
    const builder = defineWorkflow("w", "d").if(() => true);
    const result = builder.else();

    expect(result).toBe(builder);
  });

  test("endIf() records an endIf instruction", () => {
    const builder = defineWorkflow("w", "d")
      .if(() => true)
      .endIf();

    expect(builder.instructions.length).toBe(2);
    expect(builder.instructions[1]!.type).toBe("endIf");
  });

  test("endIf() returns this for chaining", () => {
    const builder = defineWorkflow("w", "d").if(() => true);
    const result = builder.endIf();

    expect(result).toBe(builder);
  });

  test("full if/elseIf/else/endIf sequence records correct instruction types", () => {
    const builder = defineWorkflow("w", "d")
      .if(() => true)
      .stage("s1", makeStageConfig())
      .elseIf(() => false)
      .stage("s2", makeStageConfig())
      .else()
      .stage("s3", makeStageConfig())
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
    const config = makeLoopConfig({ maxCycles: 10 });
    const builder = defineWorkflow("w", "d").loop(config);

    expect(builder.instructions.length).toBe(1);
    expect(builder.instructions[0]!.type).toBe("loop");

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "loop" }
    >;
    expect(instruction.config).toBe(config);
  });

  test("loop() returns this for chaining", () => {
    const builder = defineWorkflow("w", "d");
    const result = builder.loop(makeLoopConfig());

    expect(result).toBe(builder);
  });

  test("endLoop() records an endLoop instruction", () => {
    const builder = defineWorkflow("w", "d")
      .loop(makeLoopConfig())
      .endLoop();

    expect(builder.instructions.length).toBe(2);
    expect(builder.instructions[1]!.type).toBe("endLoop");
  });

  test("endLoop() returns this for chaining", () => {
    const builder = defineWorkflow("w", "d").loop(makeLoopConfig());
    const result = builder.endLoop();

    expect(result).toBe(builder);
  });

  test("loop with body records correct instruction sequence", () => {
    const builder = defineWorkflow("w", "d")
      .loop(makeLoopConfig({ maxCycles: 3 }))
      .stage("review", makeStageConfig())
      .tool("check", makeToolConfig())
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "stage", "tool", "endLoop"]);
  });

  test("endLoop() throws when called outside a loop", () => {
    const builder = defineWorkflow("w", "d");

    expect(() => builder.endLoop()).toThrow(
      "endLoop() called without a matching loop()",
    );
  });

  test("endLoop() throws after all loops are closed", () => {
    const builder = defineWorkflow("w", "d")
      .loop(makeLoopConfig())
      .endLoop();

    expect(() => builder.endLoop()).toThrow(
      "endLoop() called without a matching loop()",
    );
  });

  test("break() records a break instruction inside a loop", () => {
    const builder = defineWorkflow("w", "d")
      .loop(makeLoopConfig())
      .break()
      .endLoop();

    const types = builder.instructions.map((i) => i.type);
    expect(types).toEqual(["loop", "break", "endLoop"]);
  });

  test("break() returns this for chaining", () => {
    const builder = defineWorkflow("w", "d").loop(makeLoopConfig());
    const result = builder.break();

    expect(result).toBe(builder);
  });

  test("break() throws when called outside a loop", () => {
    const builder = defineWorkflow("w", "d");

    expect(() => builder.break()).toThrow(
      "break() can only be used inside a loop() block",
    );
  });

  test("break() works inside nested loops", () => {
    const builder = defineWorkflow("w", "d")
      .loop(makeLoopConfig())
        .stage("outer", makeStageConfig())
        .loop(makeLoopConfig())
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
    const builder = defineWorkflow("w", "d")
      .loop(makeLoopConfig())
      .endLoop();

    expect(() => builder.break()).toThrow(
      "break() can only be used inside a loop() block",
    );
  });

  test("loop with break and conditional records correct instruction sequence", () => {
    const builder = defineWorkflow("w", "d")
      .loop(makeLoopConfig())
        .stage("review", makeStageConfig())
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
    const builder = defineWorkflow("w", "d")
      .stage("s1", makeStageConfig());

    const compiled = builder.compile();

    expect(compiled).toBeDefined();
    expect(compiled.__compiledWorkflow).toBeDefined();
  });

  test("compiled workflow wraps a WorkflowDefinition with correct metadata", () => {
    const builder = defineWorkflow("my-wf", "My workflow")
      .version("2.0.0")
      .argumentHint("<path>")
      .stage("s1", makeStageConfig({ name: "First Stage" }));

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;

    expect(definition.name).toBe("my-wf");
    expect(definition.description).toBe("My workflow");
    expect(definition.version).toBe("2.0.0");
    expect(definition.argumentHint).toBe("<path>");
    expect(definition.source).toBe("builtin");
  });

  test("compiled workflow contains conductorStages from stage instructions", () => {
    const builder = defineWorkflow("w", "d")
      .stage("planner", makeStageConfig({ name: "Planner" }))
      .stage("executor", makeStageConfig({ name: "Executor" }));

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;
    const stages = definition.conductorStages as Array<{ id: string; name: string }>;

    expect(stages).toHaveLength(2);
    expect(stages[0]!.id).toBe("planner");
    expect(stages[0]!.name).toBe("Planner");
    expect(stages[1]!.id).toBe("executor");
    expect(stages[1]!.name).toBe("Executor");
  });

  test("compiled workflow has a createConductorGraph function", () => {
    const builder = defineWorkflow("w", "d")
      .stage("s1", makeStageConfig());

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;

    expect(typeof definition.createConductorGraph).toBe("function");
  });

  test("compiled workflow has a createState function", () => {
    const builder = defineWorkflow("w", "d")
      .stage("s1", makeStageConfig());

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;

    expect(typeof definition.createState).toBe("function");
  });

  test("compile() throws on invalid instruction sequence", () => {
    // No stages or tools — should throw
    const builder = defineWorkflow("w", "d");

    expect(() => builder.compile()).toThrow(
      "Workflow must have at least one stage or tool node",
    );
  });

  test("compile() throws on duplicate node IDs", () => {
    const builder = defineWorkflow("w", "d")
      .stage("dup", makeStageConfig())
      .stage("dup", makeStageConfig());

    expect(() => builder.compile()).toThrow('Duplicate node ID: "dup"');
  });

  test("compile() throws on unbalanced if/endIf", () => {
    const builder = defineWorkflow("w", "d")
      .stage("s1", makeStageConfig())
      .if(() => true)
      .stage("s2", makeStageConfig());

    expect(() => builder.compile()).toThrow('unclosed "if" block(s)');
  });

  test("compiled graph includes node descriptions", () => {
    const builder = defineWorkflow("w", "d")
      .stage("planner", makeStageConfig({ name: "Plan Step" }))
      .tool("parser", makeToolConfig({ name: "Parse Output" }));

    const compiled = builder.compile();
    const definition = compiled as unknown as Record<string, unknown>;
    const descriptions = definition.nodeDescriptions as Record<string, string>;

    expect(descriptions.planner).toBe("Plan Step");
    expect(descriptions.parser).toBe("Parse Output");
  });

  test("compile() with state schema creates a working state factory", () => {
    const builder = defineWorkflow("w", "d")
      .state({
        count: { default: 0, reducer: "sum" },
        items: { default: () => [], reducer: "concat" },
      })
      .stage("s1", makeStageConfig());

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
    const builder = defineWorkflow("complex-workflow", "A multi-stage workflow")
      .version("1.0.0")
      .argumentHint("<task-description>")
      .state({
        plan: { default: "" },
        results: { default: () => [], reducer: "concat" },
        iteration: { default: 0, reducer: "sum" },
      })
      .stage("planner", makeStageConfig({ name: "Planner" }))
      .if((ctx) => ctx.stageOutputs.has("planner"))
        .stage("executor", makeStageConfig({ name: "Executor" }))
        .tool("parser", makeToolConfig({ name: "Output Parser" }))
        .loop({
          until: (state) => "reviewer" in state.outputs,
          maxCycles: 3,
        })
          .stage("reviewer", makeStageConfig({ name: "Reviewer" }))
          .if((ctx) => !ctx.stageOutputs.has("reviewer"))
            .stage("debugger", makeStageConfig({ name: "Debugger" }))
          .endIf()
        .endLoop()
      .else()
        .stage("fallback", makeStageConfig({ name: "Fallback" }))
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
    const builder = defineWorkflow("w", "d")
      .version("1.0.0")
      .argumentHint("hint")
      .state({ x: { default: 0 } });

    expect(builder.instructions.length).toBe(0);
  });

  test("stages and tools can be mixed freely", () => {
    const builder = defineWorkflow("w", "d")
      .stage("s1", makeStageConfig())
      .tool("t1", makeToolConfig())
      .stage("s2", makeStageConfig())
      .tool("t2", makeToolConfig());

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
    const builder: WorkflowBuilderInterface = defineWorkflow("w", "d");

    // Verify all methods exist and return this
    expect(typeof builder.version).toBe("function");
    expect(typeof builder.argumentHint).toBe("function");
    expect(typeof builder.state).toBe("function");
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
    const builder: WorkflowBuilderInterface = defineWorkflow("w", "d");

    // Every chained call should return the same builder via `this`
    const chained = builder
      .version("1.0.0")
      .argumentHint("hint")
      .state({ x: { default: 0 } })
      .stage("s1", makeStageConfig())
      .tool("t1", makeToolConfig())
      .if(() => true)
      .else()
      .endIf()
      .loop(makeLoopConfig())
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
    const config = makeStageConfig();
    const builder = defineWorkflow("w", "d").stage("s1", config);

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "stage" }
    >;
    expect(instruction.config).toBe(config);
  });

  test("tool config references are preserved (not cloned)", () => {
    const config = makeToolConfig();
    const builder = defineWorkflow("w", "d").tool("t1", config);

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "tool" }
    >;
    expect(instruction.config).toBe(config);
  });

  test("loop config references are preserved (not cloned)", () => {
    const config = makeLoopConfig();
    const builder = defineWorkflow("w", "d").loop(config);

    const instruction = builder.instructions[0] as Extract<
      Instruction,
      { type: "loop" }
    >;
    expect(instruction.config).toBe(config);
  });

  test("condition function references are preserved", () => {
    const condition = () => true;
    const builder = defineWorkflow("w", "d").if(condition);

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
    const builder = new WorkflowBuilder("direct", "Constructed directly");

    expect(builder.name).toBe("direct");
    expect(builder.description).toBe("Constructed directly");
    expect(builder.instructions).toEqual([]);
  });

  test("readonly properties are set correctly", () => {
    const builder = new WorkflowBuilder("test", "Test workflow");

    expect(builder.name).toBe("test");
    expect(builder.description).toBe("Test workflow");
  });
});
