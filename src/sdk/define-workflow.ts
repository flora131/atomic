/**
 * Workflow Builder — defines a workflow with a single `.run()` entry point.
 *
 * Usage:
 *   defineWorkflow({ name: "my-workflow", description: "..." })
 *     .run(async (ctx) => {
 *       await ctx.session({ name: "research" }, async (s) => { ... });
 *       await ctx.session({ name: "plan" }, async (s) => { ... });
 *     })
 *     .compile()
 */

import type { WorkflowOptions, WorkflowContext, WorkflowDefinition } from "./types.ts";

/**
 * Chainable workflow builder. Records the run callback,
 * then .compile() seals it into a WorkflowDefinition.
 */
export class WorkflowBuilder {
  /** @internal Brand for detection across package boundaries */
  readonly __brand = "WorkflowBuilder" as const;
  private readonly options: WorkflowOptions;
  private runFn: ((ctx: WorkflowContext) => Promise<void>) | null = null;

  constructor(options: WorkflowOptions) {
    this.options = options;
  }

  /**
   * Set the workflow's entry point.
   *
   * The callback receives a {@link WorkflowContext} with `session()` for
   * spawning agent sessions, and `transcript()` / `getMessages()` for
   * reading completed session outputs. Use native TypeScript control flow
   * (loops, conditionals, `Promise.all()`) for orchestration.
   */
  run(fn: (ctx: WorkflowContext) => Promise<void>): this {
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
  compile(): WorkflowDefinition {
    if (!this.runFn) {
      throw new Error(
        `Workflow "${this.options.name}" has no run callback. ` +
          `Add a .run(async (ctx) => { ... }) call before .compile().`,
      );
    }

    const runFn = this.runFn;

    return {
      __brand: "WorkflowDefinition" as const,
      name: this.options.name,
      description: this.options.description ?? "",
      run: runFn,
    };
  }
}

/**
 * Entry point for defining a workflow.
 *
 * @example
 * ```typescript
 * import { defineWorkflow } from "@bastani/atomic/workflows";
 *
 * export default defineWorkflow({
 *   name: "hello",
 *   description: "Two-session demo",
 * })
 *   .run(async (ctx) => {
 *     const describe = await ctx.session({ name: "describe" }, async (s) => {
 *       // ... agent SDK code using s.serverUrl, s.paneId, s.save() ...
 *     });
 *     await ctx.session({ name: "summarize" }, async (s) => {
 *       const research = await s.transcript(describe);
 *       // ...
 *     });
 *   })
 *   .compile();
 * ```
 */
export function defineWorkflow(options: WorkflowOptions): WorkflowBuilder {
  if (!options.name || options.name.trim() === "") {
    throw new Error("Workflow name is required.");
  }
  return new WorkflowBuilder(options);
}
