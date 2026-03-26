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
  AskUserQuestionConfig,
  AskUserQuestionOptions,
  CompiledWorkflow,
  Instruction,
  LoopOptions,
  StageOptions,
  StateFieldOptions,
  ToolOptions,
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
// StageOptions
// ---------------------------------------------------------------------------

describe("StageOptions", () => {
  test("accepts a minimal valid stage config", () => {
    const config: StageOptions = {
      name: "planner",
      agent: "planner",
      description: "Plans the work",
      prompt: (ctx: StageContext) => `Plan: ${ctx.userPrompt}`,
      outputMapper: (response: string) => ({ plan: response }),
    };

    expect(config.name).toBe("planner");
    expect(config.agent).toBe("planner");
    expect(config.description).toBe("Plans the work");
    expect(typeof config.prompt).toBe("function");
    expect(typeof config.outputMapper).toBe("function");
  });

  test("accepts optional fields", () => {
    const config: StageOptions = {
      name: "executor",
      agent: "executor",
      description: "Executes tasks",
      prompt: () => "Execute",
      outputMapper: () => ({}),
      sessionConfig: { model: { claude: "claude-sonnet" } },
      maxOutputBytes: 1024,
      reads: ["plan"],
      outputs: ["result"],
    };

    expect(config.sessionConfig?.model).toEqual({ claude: "claude-sonnet" });
    expect(config.maxOutputBytes).toBe(1024);
    expect(config.reads).toEqual(["plan"]);
    expect(config.outputs).toEqual(["result"]);
  });

  test("accepts null agent to use default SDK instructions", () => {
    const config: StageOptions = {
      name: "default-agent",
      agent: null,
      description: "Uses default SDK instructions",
      prompt: () => "Do something",
      outputMapper: (response: string) => ({ result: response }),
    };

    expect(config.agent).toBeNull();
  });

  test("accepts omitted agent (defaults to undefined)", () => {
    const config: StageOptions = {
      name: "no-agent",
      description: "Uses default SDK instructions",
      prompt: () => "Do something",
      outputMapper: (response: string) => ({ result: response }),
    };

    expect(config.agent).toBeUndefined();
  });

  test("prompt receives StageContext and returns string", () => {
    const config: StageOptions = {
      name: "test",
      agent: "test",
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
// ToolOptions
// ---------------------------------------------------------------------------

describe("ToolOptions", () => {
  test("accepts a minimal valid tool config", () => {
    const config: ToolOptions = {
      name: "parser",
      execute: async (_ctx: ExecutionContext<BaseState>) => ({ parsed: true }),
    };

    expect(config.name).toBe("parser");
    expect(typeof config.execute).toBe("function");
  });

  test("accepts optional fields", () => {
    const config: ToolOptions = {
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
    const config: ToolOptions = {
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
// AskUserQuestionConfig
// ---------------------------------------------------------------------------

describe("AskUserQuestionConfig", () => {
  test("accepts minimal config with just question text", () => {
    const config: AskUserQuestionConfig = {
      question: "Do you want to continue?",
    };

    expect(config.question).toBe("Do you want to continue?");
    expect(config.header).toBeUndefined();
    expect(config.options).toBeUndefined();
    expect(config.multiSelect).toBeUndefined();
  });

  test("accepts optional fields (header, options, multiSelect)", () => {
    const config: AskUserQuestionConfig = {
      question: "Which strategy should we use?",
      header: "Strategy Selection",
      options: [
        { label: "Conservative", description: "Slow but safe" },
        { label: "Aggressive", description: "Fast but risky" },
        { label: "Balanced" },
      ],
      multiSelect: true,
    };

    expect(config.question).toBe("Which strategy should we use?");
    expect(config.header).toBe("Strategy Selection");
    expect(config.options).toHaveLength(3);
    expect(config.options![0]!.label).toBe("Conservative");
    expect(config.options![0]!.description).toBe("Slow but safe");
    expect(config.options![2]!.description).toBeUndefined();
    expect(config.multiSelect).toBe(true);
  });

  test("options with only labels (no descriptions)", () => {
    const config: AskUserQuestionConfig = {
      question: "Pick one",
      options: [
        { label: "Yes" },
        { label: "No" },
      ],
    };

    expect(config.options).toHaveLength(2);
    expect(config.options![0]!.label).toBe("Yes");
    expect(config.options![1]!.label).toBe("No");
  });

  test("multiSelect defaults to undefined when not set", () => {
    const config: AskUserQuestionConfig = {
      question: "Continue?",
      options: [{ label: "Yes" }, { label: "No" }],
    };

    expect(config.multiSelect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AskUserQuestionOptions
// ---------------------------------------------------------------------------

describe("AskUserQuestionOptions", () => {
  test("accepts minimal config (name + static question)", () => {
    const config: AskUserQuestionOptions = {
      name: "confirm",
      question: { question: "Continue with implementation?" },
    };

    expect(config.name).toBe("confirm");
    expect(typeof config.question).toBe("object");
  });

  test("accepts optional fields (header, options, multiSelect, onAnswer, description, reads, outputs)", () => {
    const config: AskUserQuestionOptions = {
      name: "review-choice",
      question: {
        question: "How should we proceed?",
        header: "Review Required",
        options: [
          { label: "Approve", description: "Accept the changes" },
          { label: "Reject" },
        ],
        multiSelect: true,
      },
      description: "Ask user for review decision",
      onAnswer: (answer) => ({ decision: answer }),
      reads: ["plan"],
      outputs: ["decision"],
    };

    expect(config.name).toBe("review-choice");
    expect(config.description).toBe("Ask user for review decision");
    expect(typeof config.onAnswer).toBe("function");
    expect(config.reads).toEqual(["plan"]);
    expect(config.outputs).toEqual(["decision"]);
  });

  test("accepts dynamic question function (state) => AskUserQuestionConfig", () => {
    const config: AskUserQuestionOptions = {
      name: "dynamic-q",
      question: (state: BaseState) => ({
        question: `Found ${Object.keys(state.outputs).length} outputs. Continue?`,
        options: [{ label: "Yes" }, { label: "No" }],
      }),
    };

    expect(typeof config.question).toBe("function");
  });

  test("onAnswer receives string and returns record", () => {
    const onAnswer = (answer: string | string[]) => ({ userChoice: answer });
    const config: AskUserQuestionOptions = {
      name: "test",
      question: { question: "Pick one" },
      onAnswer,
    };

    expect(config.onAnswer!("Approve")).toEqual({ userChoice: "Approve" });
  });

  test("onAnswer receives string[] for multi-select and returns record", () => {
    const onAnswer = (answer: string | string[]) => ({ selections: answer });
    const config: AskUserQuestionOptions = {
      name: "test",
      question: { question: "Pick many", multiSelect: true },
      onAnswer,
    };

    expect(config.onAnswer!(["A", "B"])).toEqual({ selections: ["A", "B"] });
  });
});

// ---------------------------------------------------------------------------
// LoopOptions
// ---------------------------------------------------------------------------

describe("LoopOptions", () => {
  test("accepts a config with maxCycles", () => {
    const config: LoopOptions = {
      maxCycles: 5,
    };

    expect(config.maxCycles).toBe(5);
  });

  test("accepts an empty config (all fields optional)", () => {
    const config: LoopOptions = {};

    expect(config.maxCycles).toBeUndefined();
    expect(config.loopState).toBeUndefined();
  });

  test("accepts loopState field configuration", () => {
    const config: LoopOptions = {
      maxCycles: 10,
      loopState: {
        iteration: { default: 0, reducer: "sum" },
        findings: { default: () => [], reducer: "concat" },
      },
    };

    expect(config.loopState).toBeDefined();
    expect(config.loopState!.iteration).toEqual({ default: 0, reducer: "sum" });
  });
});

// ---------------------------------------------------------------------------
// StateFieldOptions
// ---------------------------------------------------------------------------

describe("StateFieldOptions", () => {
  test("accepts a static default value", () => {
    const config: StateFieldOptions<number> = {
      default: 0,
    };

    expect(config.default).toBe(0);
  });

  test("accepts a factory function default", () => {
    const config: StateFieldOptions<string[]> = {
      default: () => [],
    };

    expect(typeof config.default).toBe("function");
  });

  test("accepts built-in reducer strings", () => {
    const reducers: Array<StateFieldOptions["reducer"]> = [
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
      const config: StateFieldOptions = { default: null, reducer };
      expect(config.reducer).toBe(reducer);
    }
  });

  test("accepts a custom reducer function", () => {
    const config: StateFieldOptions<number> = {
      default: 0,
      reducer: (current, update) => current + update,
    };

    expect(typeof config.reducer).toBe("function");
    if (typeof config.reducer === "function") {
      expect(config.reducer(1, 2)).toBe(3);
    }
  });

  test("accepts key field for mergeById reducer", () => {
    const config: StateFieldOptions<Array<{ id: string; status: string }>> = {
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
  test("stage instruction carries id and StageOptions", () => {
    const instruction: Instruction = {
      type: "stage",
      id: "planner",
      config: {
        name: "planner",
        agent: "planner",
        description: "Plans work",
        prompt: () => "plan",
        outputMapper: () => ({}),
      },
    };

    assertInstructionType(instruction, "stage");
    expect(instruction.id).toBe("planner");
    expect(instruction.config.name).toBe("planner");
    expect(instruction.config.agent).toBe("planner");
  });

  test("tool instruction carries id and ToolOptions", () => {
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

  test("askUserQuestion instruction carries id and AskUserQuestionOptions", () => {
    const instruction: Instruction = {
      type: "askUserQuestion",
      id: "confirm",
      config: {
        name: "confirm",
        question: { question: "Continue?" },
      },
    };

    assertInstructionType(instruction, "askUserQuestion");
    expect(instruction.id).toBe("confirm");
    expect(instruction.config.name).toBe("confirm");
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

  test("loop instruction carries LoopOptions", () => {
    const instruction: Instruction = {
      type: "loop",
      config: {
        maxCycles: 10,
      },
    };

    assertInstructionType(instruction, "loop");
    expect(instruction.config.maxCycles).toBe(10);
  });

  test("break instruction accepts optional condition factory", () => {
    const instruction: Instruction = {
      type: "break",
      condition: () => (state: BaseState) => "reviewer" in state.outputs,
    };

    assertInstructionType(instruction, "break");
    expect(typeof instruction.condition).toBe("function");
  });

  test("endLoop instruction has no extra fields", () => {
    const instruction: Instruction = { type: "endLoop" };

    assertInstructionType(instruction, "endLoop");
    expect(instruction.type).toBe("endLoop");
  });

  test("exhaustive switch covers all instruction types", () => {
    const instructions: Instruction[] = [
      { type: "stage", id: "s1", config: { name: "s1", agent: "s1", description: "d", prompt: () => "", outputMapper: () => ({}) } },
      { type: "tool", id: "t1", config: { name: "T1", execute: async () => ({}) } },
      { type: "askUserQuestion", id: "q1", config: { name: "q1", question: { question: "Continue?" } } },
      { type: "if", condition: () => true },
      { type: "elseIf", condition: () => false },
      { type: "else" },
      { type: "endIf" },
      { type: "loop", config: { maxCycles: 1 } },
      { type: "endLoop" },
      { type: "break" },
    ];

    const types = instructions.map((i) => i.type);
    expect(types).toEqual([
      "stage", "tool", "askUserQuestion", "if", "elseIf", "else", "endIf", "loop", "endLoop", "break",
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
      stage(_options: StageOptions) { return this; },
      tool(_options: ToolOptions) { return this; },
      askUserQuestion(_options: AskUserQuestionOptions) { return this; },
      if(_condition: (ctx: StageContext) => boolean) { return this; },
      elseIf(_condition: (ctx: StageContext) => boolean) { return this; },
      else() { return this; },
      endIf() { return this; },
      loop(_options?: LoopOptions) { return this; },
      endLoop() { return this; },
      break(_condition?: () => (state: BaseState) => boolean) { return this; },
      compile() { return { name: "mock", description: "mock", __compiledWorkflow: true } as CompiledWorkflow; },
    };

    // Verify chaining works
    const result = mockBuilder
      .version("1.0.0")
      .argumentHint("Describe the task")
      .stage({
        name: "s1",
        agent: "s1",
        description: "First stage",
        prompt: () => "hello",
        outputMapper: () => ({}),
      })
      .tool({
        name: "t1",
        execute: async () => ({}),
      })
      .if(() => true)
        .stage({
          name: "s2",
          agent: "s2",
          description: "Conditional stage",
          prompt: () => "conditional",
          outputMapper: () => ({}),
        })
      .else()
        .stage({
          name: "s3",
          agent: "s3",
          description: "Fallback stage",
          prompt: () => "fallback",
          outputMapper: () => ({}),
        })
      .endIf()
      .loop({ maxCycles: 3 })
        .stage({
          name: "s4",
          agent: "s4",
          description: "Loop stage",
          prompt: () => "loop",
          outputMapper: () => ({}),
        })
      .endLoop()
      .compile();

    expect(result.__compiledWorkflow).toBeDefined();
  });
});
