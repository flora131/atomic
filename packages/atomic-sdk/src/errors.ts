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

/**
 * Thrown by session primitives when the requested tmux session id is
 * not present on the atomic socket. Carries the id so the CLI layer can
 * render an actionable "run `atomic session list` to see what's
 * running" hint without parsing message text.
 */
export class SessionNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`session not found: ${id}`);
    this.name = "SessionNotFoundError";
  }
}

/**
 * Thrown when a workflow declares a `minSDKVersion` newer than the
 * bundled CLI. Carries both versions so the CLI can render an
 * actionable "update atomic or re-save the workflow" hint rather than
 * a generic load error.
 */
export class IncompatibleSDKError extends Error {
  constructor(
    public readonly path: string,
    public readonly requiredVersion: string,
    public readonly currentVersion: string,
  ) {
    super(
      `${path} requires Atomic SDK v${requiredVersion}, but v${currentVersion} is installed.\n` +
      `  Update Atomic, or re-save the workflow against the current SDK.`,
    );
    this.name = "IncompatibleSDKError";
  }
}

/**
 * Thrown by `resolveDispatcher()` when no dispatcher branch resolves.
 * The SDK's only default is its prebundled CLI dispatcher
 * (`@bastani/atomic-sdk/cli`); when that can't be located on disk
 * (typically because the SDK is bundled into a `bun build --compile`
 * binary that did NOT auto-default `pathToAtomicExecutable` — which the
 * SDK normally does for compiled hosts) the caller must pass it
 * explicitly. Carries `searchedFor` so callers can render an actionable
 * hint.
 */
export class NoDispatcherError extends Error {
  override readonly name = "NoDispatcherError";
  readonly searchedFor: ReadonlyArray<string>;
  constructor(opts: { searchedFor: ReadonlyArray<string> }) {
    super(
      `runWorkflow() could not locate the atomic SDK dispatcher.\n` +
      `Searched: ${opts.searchedFor.join(", ")}.\n` +
      `This usually means the SDK is bundled into a compiled binary and\n` +
      `the auto-default to \`process.execPath\` was disabled. Pass an\n` +
      `explicit \`pathToAtomicExecutable\` to runWorkflow() pointing at\n` +
      `a binary that handles \`_orchestrator-entry\` — atomic's own CLI\n` +
      `does, and any \`bun build --compile\`d host that imports\n` +
      `\`runWorkflow\` from \`@bastani/atomic-sdk/workflows\` self-\n` +
      `dispatches automatically (the SDK barrel intercepts argv at\n` +
      `module-load time).`,
    );
    this.searchedFor = opts.searchedFor;
  }
}

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
