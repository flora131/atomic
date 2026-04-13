/**
 * Workflow Builder — defines a workflow with a single `.run()` entry point.
 *
 * Usage:
 *   defineWorkflow<"copilot">({ name: "my-workflow", description: "..." })
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
export class WorkflowBuilder<A extends AgentType = AgentType> {
  /** @internal Brand for detection across package boundaries */
  readonly __brand = "WorkflowBuilder" as const;
  private readonly options: WorkflowOptions;
  private runFn: ((ctx: WorkflowContext<A>) => Promise<void>) | null = null;

  constructor(options: WorkflowOptions) {
    this.options = options;
  }

  /**
   * Set the workflow's entry point.
   *
   * The callback receives a {@link WorkflowContext} with `stage()` for
   * spawning agent sessions, and `transcript()` / `getMessages()` for
   * reading completed session outputs. Use native TypeScript control flow
   * (loops, conditionals, `Promise.all()`) for orchestration.
   */
  run(fn: (ctx: WorkflowContext<A>) => Promise<void>): this {
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
  compile(): WorkflowDefinition<A> {
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
      run: runFn,
    };
  }
}

/**
 * Entry point for defining a workflow.
 *
 * Pass a type parameter to narrow all context types to a specific agent:
 *
 * @example
 * ```typescript
 * import { defineWorkflow } from "@bastani/atomic/workflows";
 *
 * export default defineWorkflow<"copilot">({
 *   name: "hello",
 *   description: "Two-session demo",
 * })
 *   .run(async (ctx) => {
 *     const describe = await ctx.stage(
 *       { name: "describe" },
 *       {},
 *       {},
 *       async (s) => {
 *         // s.client: CopilotClient, s.session: CopilotSession
 *         await s.session.send({ prompt: s.inputs.prompt ?? "" });
 *         s.save(await s.session.getMessages());
 *       },
 *     );
 *     await ctx.stage(
 *       { name: "summarize" },
 *       {},
 *       {},
 *       async (s) => {
 *         const research = await s.transcript(describe);
 *         // ...
 *       },
 *     );
 *   })
 *   .compile();
 * ```
 */
export function defineWorkflow<A extends AgentType = AgentType>(
  options: WorkflowOptions,
): WorkflowBuilder<A> {
  if (!options.name || options.name.trim() === "") {
    throw new Error("Workflow name is required.");
  }
  return new WorkflowBuilder<A>(options);
}
