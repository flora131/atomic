/**
 * DSL Type Definitions
 *
 * Core types for the chainable workflow DSL. The DSL provides a fluent,
 * builder-pattern API for defining multi-stage workflows with conditional
 * branching and bounded loops. Workflows are declared as a linear sequence
 * of instructions that the builder records and `.compile()` transforms into
 * a `CompiledGraph` for the conductor to execute.
 *
 * Design principles:
 * - Instruction-based: the builder records an ordered list of `Instruction`
 *   discriminated-union values; compilation interprets them into graph nodes.
 * - Re-uses existing types: `StageContext` from the conductor, `BaseState`
 *   and `ExecutionContext` from the graph contracts, and `SessionConfig`
 *   from the agent contracts.
 * - Opaque compiled output: `CompiledWorkflow` is a branded type that hides
 *   internal structure, enforcing that workflows are only executed through
 *   the conductor.
 *
 * @see specs/workflow-sdk-simplification.md section 5.1.5
 */

import type { BaseState, ExecutionContext } from "@/services/workflows/graph/types.ts";
import type { SessionConfig } from "@/services/agents/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";

// ---------------------------------------------------------------------------
// Stage Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a workflow stage — a single agent session that receives
 * a prompt, streams a response, and maps the output into workflow state.
 *
 * Stages are the primary unit of work in a DSL workflow. Each stage runs in
 * a fresh agent session with an isolated context window.
 */
export interface StageConfig {
  /** Human-readable name displayed in the UI during execution. */
  readonly name: string;

  /** Brief description of the stage's purpose (used in logging and debugging). */
  readonly description: string;

  /**
   * Builds the prompt sent to the agent session for this stage.
   * Receives the full `StageContext` so it can reference prior stage outputs,
   * the user's original prompt, and accumulated context pressure.
   */
  readonly prompt: (context: StageContext) => string;

  /**
   * Maps the raw assistant response into structured state updates.
   * The returned record is merged into the workflow state after the
   * stage completes.
   */
  readonly outputMapper: (response: string) => Record<string, unknown>;

  /**
   * Optional session configuration overrides for this stage.
   * Merged with the conductor's default session config (e.g., to set a
   * specific model or additional instructions per stage).
   */
  readonly sessionConfig?: Partial<SessionConfig>;

  /**
   * Maximum byte size for this stage's raw response when forwarded to
   * downstream stages. Overrides the global limit for this stage only.
   * Set to `0` or `Infinity` to disable truncation.
   */
  readonly maxOutputBytes?: number;

  /**
   * State field names that this stage reads from.
   * Used for documentation and future dependency analysis.
   */
  readonly reads?: string[];

  /**
   * State field names that this stage writes to.
   * Used for documentation and future dependency analysis.
   */
  readonly outputs?: string[];
}

// ---------------------------------------------------------------------------
// Tool Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a deterministic tool node — a synchronous or
 * asynchronous function that transforms workflow state without an
 * agent session.
 *
 * Tools are useful for data transformation, API calls, file I/O,
 * or any deterministic operation between agent stages.
 */
export interface ToolConfig {
  /** Human-readable name for the tool (used in logging and debugging). */
  readonly name: string;

  /**
   * The function to execute. Receives the full `ExecutionContext` with
   * current workflow state and returns a record of state updates.
   */
  readonly execute: (
    context: ExecutionContext<BaseState>,
  ) => Promise<Record<string, unknown>>;

  /** Optional description of what the tool does. */
  readonly description?: string;

  /**
   * State field names that this tool reads from.
   * Used for documentation and future dependency analysis.
   */
  readonly reads?: string[];

  /**
   * State field names that this tool writes to.
   * Used for documentation and future dependency analysis.
   */
  readonly outputs?: string[];
}

// ---------------------------------------------------------------------------
// Loop Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a bounded loop construct.
 *
 * Loops repeat all instructions between `.loop()` and `.endLoop()`
 * until the `until` predicate returns `true` or `maxCycles` is
 * reached, whichever comes first.
 */
export interface LoopConfig {
  /**
   * Predicate evaluated before each iteration. The loop terminates
   * when this returns `true`.
   */
  readonly until: (state: BaseState) => boolean;

  /**
   * Hard upper bound on the number of iterations. Prevents runaway
   * loops even when the `until` predicate never returns `true`.
   */
  readonly maxCycles: number;
}

// ---------------------------------------------------------------------------
// State Field Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a single field in the workflow state schema.
 *
 * Defines the field's default value and an optional reducer that
 * controls how concurrent or sequential updates are merged.
 *
 * @typeParam T - The type of the state field value.
 */
export interface StateFieldConfig<T = unknown> {
  /**
   * Default value for this field when the workflow starts.
   * Can be a static value or a factory function for mutable defaults
   * (e.g., arrays, maps).
   */
  readonly default: T | (() => T);

  /**
   * Reducer strategy for merging updates into this field.
   *
   * Built-in strategies:
   * - `"replace"` — new value replaces the old value (default behavior).
   * - `"concat"` — arrays are concatenated; strings are appended.
   * - `"merge"` — objects are shallow-merged (`Object.assign`).
   * - `"mergeById"` — arrays of objects are merged by a key field (requires `key`).
   * - `"max"` — keeps the larger of old and new numeric values.
   * - `"min"` — keeps the smaller of old and new numeric values.
   * - `"sum"` — adds old and new numeric values.
   * - `"or"` — logical OR of old and new boolean values.
   * - `"and"` — logical AND of old and new boolean values.
   *
   * A custom function `(current: T, update: T) => T` can be provided
   * for complex merge logic.
   */
  readonly reducer?:
    | "replace"
    | "concat"
    | "merge"
    | "mergeById"
    | "max"
    | "min"
    | "sum"
    | "or"
    | "and"
    | ((current: T, update: T) => T);

  /**
   * Key field name for the `"mergeById"` reducer.
   * Required when `reducer` is `"mergeById"`, ignored otherwise.
   *
   * @example For an array of `{ id: string; status: string }`, set `key: "id"`.
   */
  readonly key?: string;
}

// ---------------------------------------------------------------------------
// Instruction — discriminated union recorded by the builder
// ---------------------------------------------------------------------------

/**
 * A single instruction recorded by the builder during workflow definition.
 *
 * The builder records an ordered array of these instructions as the user
 * chains `.stage()`, `.tool()`, `.if()`, `.loop()`, etc. At `.compile()`
 * time, the instruction tape is transformed into a `CompiledGraph`.
 *
 * This is a discriminated union on the `type` field.
 */
export type Instruction =
  | { readonly type: "stage"; readonly id: string; readonly config: StageConfig }
  | { readonly type: "tool"; readonly id: string; readonly config: ToolConfig }
  | { readonly type: "if"; readonly condition: (ctx: StageContext) => boolean }
  | { readonly type: "elseIf"; readonly condition: (ctx: StageContext) => boolean }
  | { readonly type: "else" }
  | { readonly type: "endIf" }
  | { readonly type: "loop"; readonly config: LoopConfig }
  | { readonly type: "endLoop" }
  | { readonly type: "break" };

// ---------------------------------------------------------------------------
// Compiled Workflow — opaque branded output
// ---------------------------------------------------------------------------

/**
 * Branded type returned by `.compile()`.
 *
 * Extends `WorkflowDefinition` so the compiled result can be used
 * directly wherever a `WorkflowDefinition` is expected — no cast needed.
 * The `__compiledWorkflow` brand allows the loader to distinguish
 * DSL-compiled workflows from legacy definitions.
 *
 * Usage:
 * ```ts
 * // Export directly — no unwrapping required
 * export const myWorkflow = defineWorkflow("my-wf", "...").stage(...).compile();
 * ```
 */
export interface CompiledWorkflow extends WorkflowDefinition {
  /** @internal Brand property for loader detection. Do not access directly. */
  readonly __compiledWorkflow: true;
}

// ---------------------------------------------------------------------------
// Builder Interface — fluent API for workflow definition
// ---------------------------------------------------------------------------

/**
 * Fluent builder interface for defining workflows.
 *
 * All methods return `this` for chaining. The builder records instructions
 * internally and transforms them into a compiled graph when `.compile()`
 * is called.
 *
 * @example
 * ```ts
 * const workflow = defineWorkflow("my-workflow")
 *   .version("1.0.0")
 *   .state({ count: { default: 0, reducer: "sum" } })
 *   .stage("planner", { ... })
 *   .if(ctx => ctx.stageOutputs.has("planner"))
 *     .stage("executor", { ... })
 *   .else()
 *     .stage("fallback", { ... })
 *   .endIf()
 *   .compile();
 * ```
 */
export interface WorkflowBuilderInterface {
  // -- Metadata -------------------------------------------------------------

  /** Set the workflow version string (SemVer recommended). */
  version(v: string): this;

  /** Set a hint displayed to users about expected arguments. */
  argumentHint(hint: string): this;

  /**
   * Define the workflow state schema.
   * Each key maps to a `StateFieldConfig` that declares its default
   * value and optional reducer.
   */
  state(schema: Record<string, StateFieldConfig>): this;

  // -- Linear flow ----------------------------------------------------------

  /**
   * Add an agent stage to the workflow.
   * @param id - Unique identifier for this stage (must be unique within the workflow).
   * @param config - Stage configuration (prompt, output mapper, etc.).
   */
  stage(id: string, config: StageConfig): this;

  /**
   * Add a deterministic tool node to the workflow.
   * @param id - Unique identifier for this tool (must be unique within the workflow).
   * @param config - Tool configuration (execute function, etc.).
   */
  tool(id: string, config: ToolConfig): this;

  // -- Conditional branching ------------------------------------------------

  /**
   * Begin a conditional branch.
   * Instructions between `.if()` and the matching `.endIf()` execute
   * only when the condition returns `true`.
   */
  if(condition: (ctx: StageContext) => boolean): this;

  /**
   * Add an alternative branch to the current conditional.
   * Executes when the preceding `.if()` or `.elseIf()` condition was
   * `false` and this condition returns `true`.
   */
  elseIf(condition: (ctx: StageContext) => boolean): this;

  /**
   * Add a default branch to the current conditional.
   * Executes when all preceding `.if()` and `.elseIf()` conditions
   * were `false`.
   */
  else(): this;

  /** Close the current conditional block. */
  endIf(): this;

  // -- Bounded loops --------------------------------------------------------

  /**
   * Begin a bounded loop.
   * Instructions between `.loop()` and `.endLoop()` repeat until the
   * `until` predicate returns `true` or `maxCycles` is reached.
   */
  loop(config: LoopConfig): this;

  /** Close the current loop block. */
  endLoop(): this;

  /**
   * Break out of the current loop immediately.
   * Must be used inside a `.loop()` / `.endLoop()` block.
   */
  break(): this;

  // -- Terminal -------------------------------------------------------------

  /**
   * Compile the recorded instructions into a `CompiledWorkflow`.
   *
   * This is a terminal operation — the builder should not be used after
   * calling `.compile()`. The returned value is passed to the conductor
   * for execution.
   */
  compile(): CompiledWorkflow;
}
