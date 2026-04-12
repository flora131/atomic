/**
 * Typed error classes for the SDK.
 *
 * The SDK throws these instead of calling process.exit() or console.error().
 * The CLI layer catches them and maps to user-visible output.
 */

/** Thrown when a required system dependency is not found on PATH. */
export class MissingDependencyError extends Error {
  constructor(public readonly dependency: "tmux" | "psmux" | "bun") {
    super(`Required dependency not found: ${dependency}`);
    this.name = "MissingDependencyError";
  }
}

/** Thrown when a workflow file is defined but missing .compile(). */
export class WorkflowNotCompiledError extends Error {
  constructor(public readonly path: string) {
    super(
      `Workflow at ${path} was defined but not compiled.\n` +
      `  Add .compile() at the end of your defineWorkflow() chain:\n\n` +
      `    export default defineWorkflow({ ... })\n` +
      `      .run(async (ctx) => { ... })\n` +
      `      .compile();`,
    );
    this.name = "WorkflowNotCompiledError";
  }
}

/** Thrown when a workflow file does not export a valid WorkflowDefinition. */
export class InvalidWorkflowError extends Error {
  constructor(public readonly path: string) {
    super(
      `${path} does not export a valid WorkflowDefinition.\n` +
      `  Make sure it exports defineWorkflow(...).compile() as the default export.`,
    );
    this.name = "InvalidWorkflowError";
  }
}

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
