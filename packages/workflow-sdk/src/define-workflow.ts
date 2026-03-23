/**
 * Chainable Workflow Builder (SDK)
 *
 * Lightweight version of the workflow builder for end-user workflow files.
 * Records an ordered instruction list and returns a branded "blueprint"
 * from `.compile()` that the Atomic CLI binary compiles at load time.
 *
 * Usage:
 * ```ts
 * import { defineWorkflow } from "@bastani/atomic-workflows";
 *
 * export default defineWorkflow({
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
 */

import type {
  BaseState,
  StageContext,
  StageOptions,
  ToolOptions,
  AskUserQuestionOptions,
  LoopOptions,
  StateFieldOptions,
  WorkflowOptions,
  CompiledWorkflow,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Instruction — internal discriminated union recorded by the builder
// ---------------------------------------------------------------------------

type Instruction =
  | { readonly type: "stage"; readonly id: string; readonly config: StageOptions }
  | { readonly type: "tool"; readonly id: string; readonly config: ToolOptions }
  | { readonly type: "askUserQuestion"; readonly id: string; readonly config: AskUserQuestionOptions }
  | { readonly type: "if"; readonly condition: (ctx: StageContext) => boolean }
  | { readonly type: "elseIf"; readonly condition: (ctx: StageContext) => boolean }
  | { readonly type: "else" }
  | { readonly type: "endIf" }
  | { readonly type: "loop"; readonly config: LoopOptions }
  | { readonly type: "endLoop" }
  | { readonly type: "break"; readonly condition?: () => (state: BaseState) => boolean };

// ---------------------------------------------------------------------------
// Blueprint — the data structure carried by the branded CompiledWorkflow
// ---------------------------------------------------------------------------

/**
 * Internal blueprint data attached to the branded CompiledWorkflow.
 * The Atomic CLI binary extracts this to compile the workflow at load time.
 */
export interface WorkflowBlueprint {
  readonly name: string;
  readonly description: string;
  readonly instructions: readonly Instruction[];
  readonly version?: string;
  readonly argumentHint?: string;
  readonly stateSchema?: Record<string, StateFieldOptions>;
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

export function defineWorkflow(options: WorkflowOptions): WorkflowBuilder {
  return new WorkflowBuilder(options);
}

// ---------------------------------------------------------------------------
// WorkflowBuilder
// ---------------------------------------------------------------------------

export class WorkflowBuilder {
  readonly name: string;
  readonly description: string;
  readonly instructions: Instruction[] = [];

  private _version: string | undefined;
  private _argumentHint: string | undefined;
  private readonly _globalState: Record<string, StateFieldOptions> | undefined;
  private loopDepth: number = 0;
  private nodeNames: Set<string> = new Set();

  constructor(options: WorkflowOptions) {
    this.name = options.name;
    this.description = options.description;
    this._globalState = options.globalState;
  }

  // -- Metadata -------------------------------------------------------------

  version(v: string): this {
    this._version = v;
    return this;
  }

  argumentHint(hint: string): this {
    this._argumentHint = hint;
    return this;
  }

  // -- Linear flow ----------------------------------------------------------

  stage(options: StageOptions): this {
    if (this.nodeNames.has(options.name)) {
      throw new Error(
        `Duplicate node name: "${options.name}". Each node must have a unique name within the workflow.`,
      );
    }
    this.nodeNames.add(options.name);
    this.instructions.push({ type: "stage", id: options.name, config: options });
    return this;
  }

  tool(options: ToolOptions): this {
    if (this.nodeNames.has(options.name)) {
      throw new Error(
        `Duplicate node name: "${options.name}". Each node must have a unique name within the workflow.`,
      );
    }
    this.nodeNames.add(options.name);
    this.instructions.push({ type: "tool", id: options.name, config: options });
    return this;
  }

  askUserQuestion(options: AskUserQuestionOptions): this {
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

  if(condition: (ctx: StageContext) => boolean): this {
    this.instructions.push({ type: "if", condition });
    return this;
  }

  elseIf(condition: (ctx: StageContext) => boolean): this {
    this.instructions.push({ type: "elseIf", condition });
    return this;
  }

  else(): this {
    this.instructions.push({ type: "else" });
    return this;
  }

  endIf(): this {
    this.instructions.push({ type: "endIf" });
    return this;
  }

  // -- Bounded loops --------------------------------------------------------

  loop(options?: LoopOptions): this {
    this.loopDepth++;
    this.instructions.push({ type: "loop", config: options ?? {} });
    return this;
  }

  endLoop(): this {
    if (this.loopDepth === 0) {
      throw new Error("endLoop() called without a matching loop()");
    }
    this.loopDepth--;
    this.instructions.push({ type: "endLoop" });
    return this;
  }

  break(condition?: () => (state: BaseState) => boolean): this {
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
   * Returns a branded "blueprint" object that the Atomic CLI binary
   * detects and compiles at load time. The blueprint carries the
   * recorded instructions and metadata — no heavy compilation runs
   * in the SDK.
   */
  compile(): CompiledWorkflow {
    return {
      __compiledWorkflow: true,
      name: this.name,
      description: this.description,
      __blueprint: {
        name: this.name,
        description: this.description,
        instructions: this.instructions,
        version: this._version,
        argumentHint: this._argumentHint,
        stateSchema: this.getStateSchema(),
      },
    } as CompiledWorkflow;
  }

  // -- Accessors (used by the binary's compiler via blueprint) ---------------

  getVersion(): string | undefined {
    return this._version;
  }

  getArgumentHint(): string | undefined {
    return this._argumentHint;
  }

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
