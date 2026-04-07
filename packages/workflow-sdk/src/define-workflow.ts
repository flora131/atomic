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
  private readonly sessionDefs: SessionOptions[] = [];

  constructor(options: WorkflowOptions) {
    this.options = options;
  }

  /**
   * Add a session to the workflow.
   *
   * Sessions execute sequentially in the order they are defined.
   * Each session runs in its own tmux pane with the chosen agent.
   */
  session(opts: SessionOptions): this {
    if (this.sessionDefs.some((s) => s.name === opts.name)) {
      throw new Error(`Duplicate session name: "${opts.name}"`);
    }
    this.sessionDefs.push(opts);
    return this;
  }

  /**
   * Compile the workflow into a sealed WorkflowDefinition.
   *
   * After calling compile(), no more sessions can be added.
   * The returned object is consumed by the Atomic CLI runtime.
   */
  compile(): WorkflowDefinition {
    if (this.sessionDefs.length === 0) {
      throw new Error(`Workflow "${this.options.name}" has no sessions. Add at least one .session() call.`);
    }

    return {
      __brand: "WorkflowDefinition" as const,
      name: this.options.name,
      description: this.options.description ?? "",
      sessions: Object.freeze([...this.sessionDefs]),
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
