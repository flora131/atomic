/**
 * Workflow Builder — defines a workflow with a single `.run()` entry point.
 *
 * Usage:
 *   defineWorkflow({ name: "my-workflow", inputs: [...] })
 *     .for<"copilot">()
 *     .run(async (ctx) => {
 *       await ctx.stage({ name: "research" }, {}, {}, async (s) => { ... });
 *       await ctx.stage({ name: "plan" }, {}, {}, async (s) => { ... });
 *     })
 *     .compile()
 */

import type {
  AgentType,
  WorkflowOptions,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowInput,
} from "./types.ts";

/**
 * Validate a single declared workflow input, throwing on authoring
 * mistakes that would otherwise surface as confusing runtime errors
 * inside the picker or the flag parser.
 */
function validateWorkflowInput(input: WorkflowInput, workflowName: string): void {
  if (!input.name || input.name.trim() === "") {
    throw new Error(
      `Workflow "${workflowName}" has an input with an empty name.`,
    );
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(input.name)) {
    throw new Error(
      `Workflow "${workflowName}" input "${input.name}" has an invalid ` +
        `name — must start with a letter and contain only letters, ` +
        `digits, underscores, and dashes (so it can be used as a ` +
        `\`--${input.name}\` CLI flag).`,
    );
  }
  if (input.type === "enum") {
    if (!Array.isArray(input.values) || input.values.length === 0) {
      throw new Error(
        `Workflow "${workflowName}" input "${input.name}" is an enum but ` +
          `declares no \`values\`.`,
      );
    }
    if (input.default !== undefined && !input.values.includes(input.default)) {
      throw new Error(
        `Workflow "${workflowName}" input "${input.name}" has a default ` +
          `"${input.default}" that is not one of its declared values: ` +
          `${input.values.join(", ")}.`,
      );
    }
  }
}

/**
 * Chainable workflow builder. Records the run callback,
 * then .compile() seals it into a WorkflowDefinition.
 */
export class WorkflowBuilder<A extends AgentType = AgentType, N extends string = string> {
  /** @internal Brand for detection across package boundaries */
  readonly __brand = "WorkflowBuilder" as const;
  private readonly options: WorkflowOptions;
  private runFn: ((ctx: WorkflowContext<A, N>) => Promise<void>) | null = null;

  constructor(options: WorkflowOptions) {
    this.options = options;
  }

  /**
   * Narrow the agent type for this workflow while preserving typed inputs.
   *
   * Use `.for<"copilot">()` **before** `.run()` instead of passing the
   * agent as a type parameter to `defineWorkflow`. This allows TypeScript
   * to infer input names from the `inputs` array AND narrow the agent
   * type for `stage()` callbacks.
   *
   * @example
   * ```typescript
   * defineWorkflow({
   *   name: "my-workflow",
   *   inputs: [{ name: "greeting", type: "string" }],
   * })
   *   .for<"copilot">()
   *   .run(async (ctx) => {
   *     ctx.inputs.greeting; // ✓ typed
   *     ctx.inputs.prompt;   // ✗ compile error
   *   })
   *   .compile();
   * ```
   */
  for<B extends AgentType>(): WorkflowBuilder<B, N> {
    return this as unknown as WorkflowBuilder<B, N>;
  }

  /**
   * Set the workflow's entry point.
   *
   * The callback receives a {@link WorkflowContext} with `stage()` for
   * spawning agent sessions, and `transcript()` / `getMessages()` for
   * reading completed session outputs. Use native TypeScript control flow
   * (loops, conditionals, `Promise.all()`) for orchestration.
   */
  run(fn: (ctx: WorkflowContext<A, N>) => Promise<void>): this {
    if (this.runFn) {
      throw new Error("run() can only be called once per workflow.");
    }
    if (typeof fn !== "function") {
      throw new Error(`run() requires a function, got ${typeof fn}.`);
    }
    this.runFn = fn;
    return this;
  }

  /**
   * Compile the workflow into a sealed WorkflowDefinition.
   *
   * After calling compile(), the returned object is consumed by the
   * Atomic CLI runtime.
   */
  compile(): WorkflowDefinition<A, N> {
    if (!this.runFn) {
      throw new Error(
        `Workflow "${this.options.name}" has no run callback. ` +
          `Add a .run(async (ctx) => { ... }) call before .compile().`,
      );
    }

    const runFn = this.runFn;

    // Freeze the declared inputs so consumers can read the schema without
    // worrying that picker or executor code has mutated it upstream.
    const declaredInputs = this.options.inputs ?? [];
    const seen = new Set<string>();
    for (const input of declaredInputs) {
      validateWorkflowInput(input, this.options.name);
      if (seen.has(input.name)) {
        throw new Error(
          `Workflow "${this.options.name}" has duplicate input name "${input.name}".`,
        );
      }
      seen.add(input.name);
    }
    const inputs = Object.freeze(
      declaredInputs.map((i) => Object.freeze({ ...i })),
    ) as readonly WorkflowInput[];

    return {
      __brand: "WorkflowDefinition" as const,
      name: this.options.name,
      description: this.options.description ?? "",
      inputs,
      minSDKVersion: this.options.minSDKVersion ?? null,
      run: runFn,
    };
  }
}

/**
 * Entry point for defining a workflow.
 *
 * Write the `inputs` array inline so TypeScript infers literal field
 * names and enforces them on `ctx.inputs`. Use `.for<Agent>()` to
 * narrow the agent type while keeping typed inputs:
 *
 * @example
 * ```typescript
 * import { defineWorkflow } from "@bastani/atomic/workflows";
 *
 * export default defineWorkflow({
 *   name: "hello",
 *   description: "Two-session demo",
 *   inputs: [
 *     { name: "greeting", type: "string", required: true },
 *   ],
 * })
 *   .for<"copilot">()
 *   .run(async (ctx) => {
 *     ctx.inputs.greeting; // ✓ string | undefined
 *     ctx.inputs.prompt;   // ✗ compile error — not declared
 *   })
 *   .compile();
 * ```
 */
export function defineWorkflow<
  const I extends readonly WorkflowInput[] = readonly WorkflowInput[],
>(
  options: WorkflowOptions<I>,
): WorkflowBuilder<AgentType, I[number]["name"]> {
  if (!options.name || options.name.trim() === "") {
    throw new Error("Workflow name is required.");
  }
  return new WorkflowBuilder<AgentType, I[number]["name"]>(options);
}
