/**
 * Chainable Workflow Builder
 *
 * Entry point for the workflow DSL. The builder records an ordered list
 * of instructions as methods are called. `.compile()` triggers the
 * compiler + verifier to produce a validated WorkflowDefinition.
 *
 * Usage:
 * ```ts
 * const workflow = defineWorkflow({
 *     name: "my-workflow",
 *     description: "A workflow that does X",
 *     globalState: {
 *       count: { default: 0, reducer: "sum" },
 *       items: { default: () => [], reducer: "concat" },
 *     },
 *   })
 *   .version("1.0.0")
 *   .argumentHint("<file-path>")
 *   .stage({ name: "planner", agent: "planner", ... })
 *   .if(ctx => ctx.stageOutputs.has("planner"))
 *     .stage({ name: "executor", agent: "executor", ... })
 *   .else()
 *     .stage({ name: "fallback", agent: "fallback", ... })
 *   .endIf()
 *   .compile();
 * ```
 *
 * @see specs/2026-03-23-workflow-sdk-simplification-z3-verification.md section 5.1
 */

import type {
  Instruction,
  StageOptions,
  ToolOptions,
  AskUserQuestionOptions,
  LoopOptions,
  StateFieldOptions,
  CompiledWorkflow,
  WorkflowBuilderInterface,
  WorkflowOptions,
} from "@/services/workflows/dsl/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import { compileWorkflow } from "@/services/workflows/dsl/compiler.ts";

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

/**
 * Entry point for defining a workflow using the chainable DSL.
 *
 * @param options - Workflow configuration (name, description, globalState, etc.)
 * @returns A WorkflowBuilder instance for chaining
 */
export function defineWorkflow(options: WorkflowOptions<any>): WorkflowBuilder {
  return new WorkflowBuilder(options);
}

// ---------------------------------------------------------------------------
// WorkflowBuilder
// ---------------------------------------------------------------------------

/**
 * Chainable workflow builder that records instructions.
 * All methods return `this` for fluent chaining.
 * `.compile()` is the terminal method that produces a CompiledWorkflow.
 */
export class WorkflowBuilder implements WorkflowBuilderInterface {
  /** Workflow name (ID). */
  readonly name: string;

  /** Human-readable description. */
  readonly description: string;

  /** Recorded instructions — the "program" that .compile() interprets. */
  readonly instructions: Instruction[] = [];

  private _version: string | undefined;
  private _argumentHint: string | undefined;
  private readonly _globalState: Record<string, StateFieldOptions> | undefined;
  private loopDepth: number = 0;
  private nodeNames: Set<string> = new Set();

  constructor(options: WorkflowOptions<any>) {
    this.name = options.name;
    this.description = options.description;
    this._globalState = options.globalState;
  }

  // -- Metadata -------------------------------------------------------------

  /** Set the workflow version string (SemVer recommended). */
  version(v: string): this {
    this._version = v;
    return this;
  }

  /** Set a hint displayed to users about expected arguments. */
  argumentHint(hint: string): this {
    this._argumentHint = hint;
    return this;
  }

  // -- Linear flow ----------------------------------------------------------

  /**
   * Add an agent stage to the workflow.
   * @param options - Stage configuration (name, agent, prompt, output mapper, etc.).
   * @throws Error if `options.name` duplicates an existing node name.
   */
  stage(options: StageOptions<any>): this {
    if (this.nodeNames.has(options.name)) {
      throw new Error(
        `Duplicate node name: "${options.name}". Each node must have a unique name within the workflow.`,
      );
    }
    this.nodeNames.add(options.name);
    this.instructions.push({ type: "stage", id: options.name, config: options });
    return this;
  }

  /**
   * Add a deterministic tool node to the workflow.
   * @param options - Tool configuration (name, execute function, etc.).
   * @throws Error if `options.name` duplicates an existing node name.
   */
  tool(options: ToolOptions<any>): this {
    if (this.nodeNames.has(options.name)) {
      throw new Error(
        `Duplicate node name: "${options.name}". Each node must have a unique name within the workflow.`,
      );
    }
    this.nodeNames.add(options.name);
    this.instructions.push({ type: "tool", id: options.name, config: options });
    return this;
  }

  /**
   * Add a human-in-the-loop question node to the workflow.
   * Pauses execution and presents an interactive question dialog.
   * The user's answer is mapped into workflow state via `outputMapper`.
   *
   * @param options - Question configuration (name, question, options, outputMapper, etc.).
   * @throws Error if `options.name` duplicates an existing node name.
   */
  askUserQuestion(options: AskUserQuestionOptions<any>): this {
    if (this.nodeNames.has(options.name)) {
      throw new Error(
        `Duplicate node name: "${options.name}". Each node must have a unique name within the workflow.`,
      );
    }
    this.nodeNames.add(options.name);
    this.instructions.push({ type: "askUserQuestion", id: options.name, config: options });
    return this;
  }

  // -- Conditional branching ------------------------------------------------

  /**
   * Begin a conditional branch.
   * Instructions between `.if()` and the matching `.endIf()` execute
   * only when the condition returns `true`.
   */
  if(condition: (ctx: StageContext) => boolean): this {
    this.instructions.push({ type: "if", condition });
    return this;
  }

  /**
   * Add an alternative branch to the current conditional.
   * Executes when the preceding `.if()` or `.elseIf()` condition was
   * `false` and this condition returns `true`.
   */
  elseIf(condition: (ctx: StageContext) => boolean): this {
    this.instructions.push({ type: "elseIf", condition });
    return this;
  }

  /**
   * Add a default branch to the current conditional.
   * Executes when all preceding `.if()` and `.elseIf()` conditions
   * were `false`.
   */
  else(): this {
    this.instructions.push({ type: "else" });
    return this;
  }

  /** Close the current conditional block. */
  endIf(): this {
    this.instructions.push({ type: "endIf" });
    return this;
  }

  // -- Bounded loops --------------------------------------------------------

  /**
   * Begin a bounded loop.
   * Instructions between `.loop()` and `.endLoop()` repeat up to
   * `maxCycles` iterations. Use `.break()` for early termination.
   */
  loop(options?: LoopOptions): this {
    this.loopDepth++;
    this.instructions.push({ type: "loop", config: options ?? {} });
    return this;
  }

  /** Close the current loop block. */
  endLoop(): this {
    if (this.loopDepth === 0) {
      throw new Error("endLoop() called without a matching loop()");
    }
    this.loopDepth--;
    this.instructions.push({ type: "endLoop" });
    return this;
  }

  /**
   * Conditionally break out of the current loop.
   * Must be used inside a `.loop()` / `.endLoop()` block.
   *
   * @param condition - Factory that creates a fresh predicate per
   *   execution. The loop exits when the predicate returns `true`.
   *   Omit for an unconditional break.
   */
  break(condition?: Parameters<WorkflowBuilderInterface["break"]>[0]): this {
    if (this.loopDepth === 0) {
      throw new Error("break() can only be used inside a loop() block");
    }
    this.instructions.push({ type: "break", condition });
    return this;
  }

  // -- Terminal -------------------------------------------------------------

  /**
   * Compile the recorded instructions into a `CompiledWorkflow`.
   *
   * This is a terminal operation — the builder should not be used after
   * calling `.compile()`. The returned value is passed to the conductor
   * for execution.
   *
   * Steps:
   * 1. Runs the DSL compiler to validate instructions and produce a
   *    `WorkflowDefinition` (synchronous — validation, graph generation,
   *    state factory creation).
   * 2. Returns a branded `CompiledWorkflow` wrapping the definition.
   *
   * Verification is performed separately (asynchronously) by the
   * workflow loader or CLI command, since the verifier requires an async
   * initialization step that cannot run in a synchronous method.
   *
   * @throws Error if the instruction sequence is structurally invalid
   *   (e.g., unbalanced if/endIf, duplicate node IDs, empty branches).
   */
  compile(): CompiledWorkflow {
    const definition = compileWorkflow(this);
    // Spread all WorkflowDefinition properties onto the return value so it
    // can be used directly as a WorkflowDefinition (no ugly cast needed).
    // The __compiledWorkflow brand lets the loader detect DSL-compiled workflows.
    return {
      ...definition,
      __compiledWorkflow: true,
    } as CompiledWorkflow;
  }

  // -- Accessors for the compiler -------------------------------------------

  /** Returns the version string, or `undefined` if not set. */
  getVersion(): string | undefined {
    return this._version;
  }

  /** Returns the argument hint, or `undefined` if not set. */
  getArgumentHint(): string | undefined {
    return this._argumentHint;
  }

  /**
   * Returns the merged state schema (globalState + all loopState fields),
   * or `undefined` if neither is defined.
   */
  getStateSchema(): Record<string, StateFieldOptions> | undefined {
    const loopStates = this.instructions
      .filter((i): i is Extract<Instruction, { type: "loop" }> => i.type === "loop")
      .map((i) => i.config.loopState)
      .filter((s): s is Record<string, StateFieldOptions> => s !== undefined);

    if (!this._globalState && loopStates.length === 0) {
      return undefined;
    }

    return {
      ...this._globalState,
      ...Object.assign({}, ...loopStates),
    };
  }
}
