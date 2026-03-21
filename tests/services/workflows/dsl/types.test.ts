/**
 * Type-level tests for the DSL type definitions.
 *
 * These tests verify that the exported types are structurally correct
 * and compose properly. Since these are pure type definitions, the
 * tests focus on ensuring type compatibility and exhaustive coverage
 * of the Instruction discriminated union.
 */

import { describe, test, expect } from "bun:test";
import type {
  CompiledWorkflow,
  Instruction,
  LoopConfig,
  StageConfig,
  StateFieldConfig,
  ToolConfig,
  WorkflowBuilderInterface,
} from "@/services/workflows/dsl/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type { BaseState, ExecutionContext } from "@/services/workflows/graph/types.ts";

// ---------------------------------------------------------------------------
// Helpers — narrow Instruction by discriminant
// ---------------------------------------------------------------------------

function assertInstructionType<T extends Instruction["type"]>(
  instruction: Instruction,
  expectedType: T,
): asserts instruction is Extract<Instruction, { type: T }> {
  if (instruction.type !== expectedType) {
    throw new Error(`Expected instruction type "${expectedType}", got "${instruction.type}"`);
  }
}

// ---------------------------------------------------------------------------
// StageConfig
// ---------------------------------------------------------------------------

describe("StageConfig", () => {
  test("accepts a minimal valid stage config", () => {
    const config: StageConfig = {
      name: "planner",
      description: "Plans the work",
      prompt: (ctx: StageContext) => `Plan: ${ctx.userPrompt}`,
      outputMapper: (response: string) => ({ plan: response }),
    };

    expect(config.name).toBe("planner");
    expect(config.description).toBe("Plans the work");
    expect(typeof config.prompt).toBe("function");
    expect(typeof config.outputMapper).toBe("function");
  });

  test("accepts optional fields", () => {
    const config: StageConfig = {
      name: "executor",
      description: "Executes tasks",
      prompt: () => "Execute",
      outputMapper: () => ({}),
      sessionConfig: { model: "claude-sonnet" },
      maxOutputBytes: 1024,
      reads: ["plan"],
      outputs: ["result"],
    };

    expect(config.sessionConfig?.model).toBe("claude-sonnet");
    expect(config.maxOutputBytes).toBe(1024);
    expect(config.reads).toEqual(["plan"]);
    expect(config.outputs).toEqual(["result"]);
  });

  test("prompt receives StageContext and returns string", () => {
    const config: StageConfig = {
      name: "test",
      description: "test",
      prompt: (ctx) => {
        // Verify StageContext shape is accessible
        const _prompt: string = ctx.userPrompt;
        const _outputs: ReadonlyMap<string, unknown> = ctx.stageOutputs;
        const _signal: AbortSignal = ctx.abortSignal;
        return `Prompt: ${_prompt}, outputs: ${_outputs.size}, aborted: ${_signal.aborted}`;
      },
      outputMapper: () => ({}),
    };

    expect(typeof config.prompt).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ToolConfig
// ---------------------------------------------------------------------------

describe("ToolConfig", () => {
  test("accepts a minimal valid tool config", () => {
    const config: ToolConfig = {
      name: "parser",
      execute: async (_ctx: ExecutionContext<BaseState>) => ({ parsed: true }),
    };

    expect(config.name).toBe("parser");
    expect(typeof config.execute).toBe("function");
  });

  test("accepts optional fields", () => {
    const config: ToolConfig = {
      name: "formatter",
      execute: async () => ({}),
      description: "Formats output",
      reads: ["rawData"],
      outputs: ["formattedData"],
    };

    expect(config.description).toBe("Formats output");
    expect(config.reads).toEqual(["rawData"]);
    expect(config.outputs).toEqual(["formattedData"]);
  });

  test("execute receives ExecutionContext and returns record", async () => {
    const config: ToolConfig = {
      name: "transformer",
      execute: async (ctx) => {
        // Verify ExecutionContext<BaseState> shape is accessible
        const _state: BaseState = ctx.state;
        const _id: string = _state.executionId;
        return { transformed: true, executionId: _id };
      },
    };

    const mockContext: ExecutionContext<BaseState> = {
      state: {
        executionId: "test-123",
        lastUpdated: new Date().toISOString(),
        outputs: {},
      },
      config: {},
      errors: [],
    };

    const result = await config.execute(mockContext);
    expect(result).toEqual({ transformed: true, executionId: "test-123" });
  });
});

// ---------------------------------------------------------------------------
// LoopConfig
// ---------------------------------------------------------------------------

describe("LoopConfig", () => {
  test("accepts a valid loop config", () => {
    const config: LoopConfig = {
      until: (_ctx: StageContext) => true,
      maxIterations: 5,
    };

    expect(typeof config.until).toBe("function");
    expect(config.maxIterations).toBe(5);
  });

  test("until predicate receives StageContext", () => {
    const config: LoopConfig = {
      until: (ctx) => ctx.stageOutputs.has("reviewer"),
      maxIterations: 3,
    };

    expect(typeof config.until).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// StateFieldConfig
// ---------------------------------------------------------------------------

describe("StateFieldConfig", () => {
  test("accepts a static default value", () => {
    const config: StateFieldConfig<number> = {
      default: 0,
    };

    expect(config.default).toBe(0);
  });

  test("accepts a factory function default", () => {
    const config: StateFieldConfig<string[]> = {
      default: () => [],
    };

    expect(typeof config.default).toBe("function");
  });

  test("accepts built-in reducer strings", () => {
    const reducers: Array<StateFieldConfig["reducer"]> = [
      "replace",
      "concat",
      "merge",
      "mergeById",
      "max",
      "min",
      "sum",
      "or",
      "and",
    ];

    for (const reducer of reducers) {
      const config: StateFieldConfig = { default: null, reducer };
      expect(config.reducer).toBe(reducer);
    }
  });

  test("accepts a custom reducer function", () => {
    const config: StateFieldConfig<number> = {
      default: 0,
      reducer: (current, update) => current + update,
    };

    expect(typeof config.reducer).toBe("function");
    if (typeof config.reducer === "function") {
      expect(config.reducer(1, 2)).toBe(3);
    }
  });

  test("accepts key field for mergeById reducer", () => {
    const config: StateFieldConfig<Array<{ id: string; status: string }>> = {
      default: () => [],
      reducer: "mergeById",
      key: "id",
    };

    expect(config.reducer).toBe("mergeById");
    expect(config.key).toBe("id");
  });
});

// ---------------------------------------------------------------------------
// Instruction — discriminated union
// ---------------------------------------------------------------------------

describe("Instruction", () => {
  test("stage instruction carries id and StageConfig", () => {
    const instruction: Instruction = {
      type: "stage",
      id: "planner",
      config: {
        name: "Planner",
        description: "Plans work",
        prompt: () => "plan",
        outputMapper: () => ({}),
      },
    };

    assertInstructionType(instruction, "stage");
    expect(instruction.id).toBe("planner");
    expect(instruction.config.name).toBe("Planner");
  });

  test("tool instruction carries id and ToolConfig", () => {
    const instruction: Instruction = {
      type: "tool",
      id: "parser",
      config: {
        name: "Parser",
        execute: async () => ({}),
      },
    };

    assertInstructionType(instruction, "tool");
    expect(instruction.id).toBe("parser");
    expect(instruction.config.name).toBe("Parser");
  });

  test("if instruction carries a condition function", () => {
    const instruction: Instruction = {
      type: "if",
      condition: (ctx) => ctx.stageOutputs.has("planner"),
    };

    assertInstructionType(instruction, "if");
    expect(typeof instruction.condition).toBe("function");
  });

  test("elseIf instruction carries a condition function", () => {
    const instruction: Instruction = {
      type: "elseIf",
      condition: () => false,
    };

    assertInstructionType(instruction, "elseIf");
    expect(typeof instruction.condition).toBe("function");
  });

  test("else instruction has no extra fields", () => {
    const instruction: Instruction = { type: "else" };

    assertInstructionType(instruction, "else");
    expect(instruction.type).toBe("else");
  });

  test("endIf instruction has no extra fields", () => {
    const instruction: Instruction = { type: "endIf" };

    assertInstructionType(instruction, "endIf");
    expect(instruction.type).toBe("endIf");
  });

  test("loop instruction carries LoopConfig", () => {
    const instruction: Instruction = {
      type: "loop",
      config: {
        until: () => true,
        maxIterations: 10,
      },
    };

    assertInstructionType(instruction, "loop");
    expect(instruction.config.maxIterations).toBe(10);
  });

  test("endLoop instruction has no extra fields", () => {
    const instruction: Instruction = { type: "endLoop" };

    assertInstructionType(instruction, "endLoop");
    expect(instruction.type).toBe("endLoop");
  });

  test("exhaustive switch covers all instruction types", () => {
    const instructions: Instruction[] = [
      { type: "stage", id: "s1", config: { name: "S1", description: "d", prompt: () => "", outputMapper: () => ({}) } },
      { type: "tool", id: "t1", config: { name: "T1", execute: async () => ({}) } },
      { type: "if", condition: () => true },
      { type: "elseIf", condition: () => false },
      { type: "else" },
      { type: "endIf" },
      { type: "loop", config: { until: () => true, maxIterations: 1 } },
      { type: "endLoop" },
    ];

    const types = instructions.map((i) => i.type);
    expect(types).toEqual([
      "stage", "tool", "if", "elseIf", "else", "endIf", "loop", "endLoop",
    ]);
  });
});

// ---------------------------------------------------------------------------
// CompiledWorkflow
// ---------------------------------------------------------------------------

describe("CompiledWorkflow", () => {
  test("has branded __compiledWorkflow field", () => {
    const compiled = {
      name: "test",
      description: "test workflow",
      __compiledWorkflow: true as const,
    } as CompiledWorkflow;

    expect(compiled.__compiledWorkflow).toBe(true);
    expect(compiled.name).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// WorkflowBuilderInterface — structural compatibility
// ---------------------------------------------------------------------------

describe("WorkflowBuilderInterface", () => {
  test("all methods return this for chaining", () => {
    // Create a mock object that satisfies the interface
    const mockBuilder: WorkflowBuilderInterface = {
      version(_v: string) { return this; },
      argumentHint(_hint: string) { return this; },
      state(_schema: Record<string, StateFieldConfig>) { return this; },
      stage(_id: string, _config: StageConfig) { return this; },
      tool(_id: string, _config: ToolConfig) { return this; },
      if(_condition: (ctx: StageContext) => boolean) { return this; },
      elseIf(_condition: (ctx: StageContext) => boolean) { return this; },
      else() { return this; },
      endIf() { return this; },
      loop(_config: LoopConfig) { return this; },
      endLoop() { return this; },
      compile() { return { name: "mock", description: "mock", __compiledWorkflow: true } as CompiledWorkflow; },
    };

    // Verify chaining works
    const result = mockBuilder
      .version("1.0.0")
      .argumentHint("Describe the task")
      .state({ count: { default: 0 } })
      .stage("s1", {
        name: "Stage 1",
        description: "First stage",
        prompt: () => "hello",
        outputMapper: () => ({}),
      })
      .tool("t1", {
        name: "Tool 1",
        execute: async () => ({}),
      })
      .if(() => true)
        .stage("s2", {
          name: "Stage 2",
          description: "Conditional stage",
          prompt: () => "conditional",
          outputMapper: () => ({}),
        })
      .else()
        .stage("s3", {
          name: "Stage 3",
          description: "Fallback stage",
          prompt: () => "fallback",
          outputMapper: () => ({}),
        })
      .endIf()
      .loop({ until: () => true, maxIterations: 3 })
        .stage("s4", {
          name: "Stage 4",
          description: "Loop stage",
          prompt: () => "loop",
          outputMapper: () => ({}),
        })
      .endLoop()
      .compile();

    expect(result.__compiledWorkflow).toBeDefined();
  });
});
