/**
 * Workflow Builder — chainable DSL for defining multi-session workflows.
 *
 * Usage:
 *   defineWorkflow({ name: "ralph", description: "..." })
 *     .session({ name: "research", run: async (ctx) => { ... } })
 *     .session({ name: "plan", run: async (ctx) => { ... } })
 *     .compile()
 */

import type { WorkflowOptions, SessionOptions, WorkflowDefinition } from "./types.ts";

/**
 * Chainable workflow builder. Records session definitions in order,
 * then .compile() seals them into a WorkflowDefinition.
 */
export class WorkflowBuilder {
  /** @internal Brand for detection across package boundaries */
  readonly __brand = "WorkflowBuilder" as const;
  private readonly options: WorkflowOptions;
  private readonly stepDefs: SessionOptions[][] = [];
  private readonly namesSeen = new Set<string>();

  constructor(options: WorkflowOptions) {
    this.options = options;
  }

  /**
   * Add a session (or parallel group of sessions) to the workflow.
   *
   * Pass a single SessionOptions for sequential execution.
   * Pass an array of SessionOptions for parallel execution —
   * all sessions in the array run concurrently, and the next
   * .session() call waits for the entire group to complete.
   */
  session(opts: SessionOptions | SessionOptions[]): this {
    const step = Array.isArray(opts) ? opts : [opts];
    if (step.length === 0) {
      throw new Error("session() requires at least one SessionOptions.");
    }
    for (const s of step) {
      if (!s.name || s.name.trim() === "") {
        throw new Error("Session name is required.");
      }
      if (typeof s.run !== "function") {
        throw new Error(`Session "${s.name}": run must be a function, got ${typeof s.run}.`);
      }
      if (this.namesSeen.has(s.name)) {
        throw new Error(`Duplicate session name: "${s.name}"`);
      }
      this.namesSeen.add(s.name);
    }
    this.stepDefs.push(step);
    return this;
  }

  /**
   * Compile the workflow into a sealed WorkflowDefinition.
   *
   * After calling compile(), no more sessions can be added.
   * The returned object is consumed by the Atomic CLI runtime.
   */
  compile(): WorkflowDefinition {
    if (this.stepDefs.length === 0) {
      throw new Error(`Workflow "${this.options.name}" has no sessions. Add at least one .session() call.`);
    }

    return {
      __brand: "WorkflowDefinition" as const,
      name: this.options.name,
      description: this.options.description ?? "",
      steps: Object.freeze(this.stepDefs.map((step) => Object.freeze([...step]))),
    };
  }
}

/**
 * Entry point for defining a workflow.
 *
 * @example
 * ```typescript
 * import { defineWorkflow } from "@bastani/atomic-workflows";
 *
 * export default defineWorkflow({
 *   name: "ralph",
 *   description: "Research, plan, implement",
 * })
 *   .session({ name: "research", run: async (ctx) => { ... } })
 *   .session({ name: "plan", run: async (ctx) => { ... } })
 *   .compile();
 * ```
 */
export function defineWorkflow(options: WorkflowOptions): WorkflowBuilder {
  if (!options.name || options.name.trim() === "") {
    throw new Error("Workflow name is required.");
  }
  return new WorkflowBuilder(options);
}
