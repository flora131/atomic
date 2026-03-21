/**
 * Chainable Workflow Builder
 *
 * Entry point for the workflow DSL. The builder records an ordered list
 * of instructions as methods are called. `.compile()` triggers the
 * compiler + Z3 verifier to produce a validated WorkflowDefinition.
 *
 * Usage:
 * ```ts
 * const workflow = defineWorkflow("my-workflow", "A workflow that does X")
 *   .version("1.0.0")
 *   .argumentHint("<file-path>")
 *   .state({
 *     count: { default: 0, reducer: "sum" },
 *     items: { default: () => [], reducer: "concat" },
 *   })
 *   .stage("planner", { ... })
 *   .if(ctx => ctx.stageOutputs.has("planner"))
 *     .stage("executor", { ... })
 *   .else()
 *     .stage("fallback", { ... })
 *   .endIf()
 *   .compile();
 * ```
 *
 * @see specs/workflow-sdk-simplification.md section 5.1
 */

import type {
  Instruction,
  StageConfig,
  ToolConfig,
  LoopConfig,
  StateFieldConfig,
  CompiledWorkflow,
  WorkflowBuilderInterface,
} from "@/services/workflows/dsl/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

/**
 * Entry point for defining a workflow using the chainable DSL.
 *
 * @param name - Unique workflow identifier
 * @param description - Human-readable description
 * @returns A WorkflowBuilder instance for chaining
 */
export function defineWorkflow(
  name: string,
  description: string,
): WorkflowBuilder {
  return new WorkflowBuilder(name, description);
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
  private _stateSchema: Record<string, StateFieldConfig> | undefined;

  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
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

  /**
   * Define the workflow state schema.
   * Each key maps to a `StateFieldConfig` that declares its default
   * value and optional reducer.
   */
  state(schema: Record<string, StateFieldConfig>): this {
    this._stateSchema = schema;
    return this;
  }

  // -- Linear flow ----------------------------------------------------------

  /**
   * Add an agent stage to the workflow.
   * @param id - Unique identifier for this stage (must be unique within the workflow).
   * @param config - Stage configuration (prompt, output mapper, etc.).
   */
  stage(id: string, config: StageConfig): this {
    this.instructions.push({ type: "stage", id, config });
    return this;
  }

  /**
   * Add a deterministic tool node to the workflow.
   * @param id - Unique identifier for this tool (must be unique within the workflow).
   * @param config - Tool configuration (execute function, etc.).
   */
  tool(id: string, config: ToolConfig): this {
    this.instructions.push({ type: "tool", id, config });
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
   * Instructions between `.loop()` and `.endLoop()` repeat until the
   * `until` predicate returns `true` or `maxIterations` is reached.
   */
  loop(config: LoopConfig): this {
    this.instructions.push({ type: "loop", config });
    return this;
  }

  /** Close the current loop block. */
  endLoop(): this {
    this.instructions.push({ type: "endLoop" });
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
   * @throws Error until the compiler and verifier are wired (task #4).
   */
  compile(): CompiledWorkflow {
    // The compiler + verifier will be wired in a later task.
    // For now, provide a placeholder that throws.
    throw new Error(
      "WorkflowBuilder.compile() is not yet wired to the compiler. " +
        "This will be implemented when the compiler and verifier are ready.",
    );
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

  /** Returns the state schema, or `undefined` if not set. */
  getStateSchema(): Record<string, StateFieldConfig> | undefined {
    return this._stateSchema;
  }
}
