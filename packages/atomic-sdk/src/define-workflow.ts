/**
 * Workflow Builder — defines a workflow with a single `.run()` entry point.
 *
 * Usage:
 *   defineWorkflow({ name: "my-workflow", inputs: [...] })
 *     .for("copilot")
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

// ─── Caller-path capture ────────────────────────────────────────────────────

/**
 * Walk a V8-style stack trace and return the absolute path of the first
 * frame outside this module. Used by `defineWorkflow()` to auto-populate
 * `WorkflowOptions.source` so consumers don't have to pass it manually.
 *
 * Stack formats handled (V8, Bun, Node, both POSIX and Windows):
 *   `at fnName (/abs/path.ts:LINE:COL)`           — named frame, POSIX
 *   `at fnName (file:///abs/path.ts:LINE:COL)`    — file:// URL form
 *   `at /abs/path.ts:LINE:COL`                    — module-level POSIX
 *   `at file:///abs/path.ts:LINE:COL`             — module-level file://
 *   `at fnName (C:\path\file.ts:LINE:COL)`        — Windows backslash
 *   `at fnName (file:///C:/path/file.ts:L:C)`     — Windows file:// form
 *
 * Returns `null` when no caller frame can be parsed (e.g. compiled
 * binary where every frame collapses to `/$bunfs/root/<bin>`); the
 * caller falls through to the explicit-source validation error.
 *
 * Exported with a `_` prefix for cross-platform unit testing — production
 * callers should use `defineWorkflow()` directly. Accepting an injected
 * `stack` string lets tests assert against canned V8/Node/Windows traces
 * without spinning up runtimes.
 *
 * @internal
 */
export function _captureCallerPath(stack?: string): string | null {
  const raw = stack ?? new Error().stack;
  if (!raw) return null;

  const lines = raw.split("\n");
  for (const line of lines) {
    // Skip the "Error" header and any non-frame lines.
    if (!line.includes(" at ")) continue;
    // Skip frames inside this module.
    if (line.includes("define-workflow.ts")) continue;
    // Skip native/internal frames where there's no on-disk source path.
    if (line.includes("native:") || line.includes("[native code]")) continue;

    const path = extractPathFromFrame(line);
    if (path !== null) return path;
  }
  return null;
}

/** Extract the absolute file path from a single stack-frame line. */
function extractPathFromFrame(line: string): string | null {
  // Parenthesised form: `at fnName (LOCATION)` — preferred.
  const parenMatch = line.match(/\(([^()]+)\)\s*$/);
  if (parenMatch) {
    const path = stripFileUrlAndPosition(parenMatch[1]!);
    if (path) return path;
  }
  // Bare form: `at LOCATION` — module-level frames in V8.
  const bareMatch = line.match(/\s+at\s+(.+)$/);
  if (bareMatch) {
    const path = stripFileUrlAndPosition(bareMatch[1]!);
    if (path) return path;
  }
  return null;
}

/**
 * Strip the trailing `:LINE:COL` and any `file://` URL prefix from a
 * frame's location string. Handles POSIX paths, Windows drive paths,
 * and `file:///C:/...` URL forms.
 */
function stripFileUrlAndPosition(location: string): string | null {
  const positionMatch = location.match(/^(.*?):\d+:\d+$/);
  if (!positionMatch) return null;
  let path = positionMatch[1]!;

  if (path.startsWith("file://")) {
    path = path.slice("file://".length);
    // file:///C:/path → /C:/path → strip leading `/` so Windows drives
    // surface as `C:/path` (matching what `import.meta.path` returns).
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  }
  return path.length > 0 ? path : null;
}

// ─── Module-private compiled workflow registry ──────────────────────────────

/**
 * All `WorkflowDefinition`s compiled in this process via `.compile()`.
 * Populated as a side-effect of each `.compile()` call so that the
 * `_emit-workflow-meta` auto-dispatch handler can drain this list
 * without any boilerplate from the third-party author.
 *
 * @internal — not part of the public API surface.
 */
const _compiledWorkflowRegistry: WorkflowDefinition[] = [];

/**
 * Return a snapshot of every `WorkflowDefinition` compiled in this process.
 * Called by the `_emit-workflow-meta` auto-dispatch handler.
 *
 * @internal
 */
export function getCompiledWorkflows(): readonly WorkflowDefinition[] {
  return _compiledWorkflowRegistry.slice();
}

type AnyInputs = readonly WorkflowInput[];

/**
 * Input names reserved because they collide with the atomic CLI's `workflow`
 * subcommand surface. The first block (`name` / `agent` / `detach` / `list`
 * / `help` / `version`) collides with the atomic CLI's `workflow` subcommand
 * flags (`-n/--name`, `-a/--agent`, `-d/--detach`, `-l/--list`, `-h/--help`,
 * `-v/--version`). The second block (`session` / `status`) collides with the
 * atomic CLI's management subcommands (`atomic workflow session …`,
 * `atomic workflow status`).
 *
 * User-app CLIs built with the SDK primitives are NOT bound by these
 * reservations at runtime — the check runs only inside `defineWorkflow` so
 * that workflows remain portable to the atomic CLI without renaming.
 */
export const RESERVED_INPUT_NAMES = [
  "name",
  "agent",
  "detach",
  "list",
  "help",
  "version",
  "session",
  "status",
] as const;

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
  if ((RESERVED_INPUT_NAMES as readonly string[]).includes(input.name)) {
    throw new Error(
      `defineWorkflow: input name "${input.name}" is reserved by the worker CLI. ` +
        `Rename it. Reserved names: ${RESERVED_INPUT_NAMES.join(", ")}.`,
    );
  }
  if (input.type === "enum") {
    if (!Array.isArray(input.values) || input.values.length === 0) {
      throw new Error(
        `Workflow "${workflowName}" input "${input.name}" is an enum but ` +
          `declares no \`values\`.`,
      );
    }
    if (input.default !== undefined) {
      if (typeof input.default !== "string") {
        throw new Error(
          `Workflow "${workflowName}" input "${input.name}" (enum) has a ` +
            `non-string default ${JSON.stringify(input.default)}.`,
        );
      }
      if (!input.values.includes(input.default)) {
        throw new Error(
          `Workflow "${workflowName}" input "${input.name}" has a default ` +
            `"${input.default}" that is not one of its declared values: ` +
            `${input.values.join(", ")}.`,
        );
      }
    }
  }
  if (input.type === "integer" && input.default !== undefined) {
    const n =
      typeof input.default === "number"
        ? input.default
        : Number.parseInt(input.default, 10);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(
        `Workflow "${workflowName}" input "${input.name}" (integer) has a ` +
          `non-integer default ${JSON.stringify(input.default)}.`,
      );
    }
  }
}

/**
 * Chainable workflow builder. Records the run callback,
 * then .compile() seals it into a WorkflowDefinition.
 */
export class WorkflowBuilder<
  A extends AgentType = AgentType,
  I extends AnyInputs = AnyInputs,
> {
  /** @internal Brand for detection across package boundaries */
  readonly __brand = "WorkflowBuilder" as const;
  private readonly options: WorkflowOptions<I>;
  private runFn: ((ctx: WorkflowContext<A, I>) => Promise<void>) | null = null;
  private agentValue: AgentType | null = null;

  constructor(options: WorkflowOptions<I>) {
    this.options = options;
  }

  /**
   * Narrow the agent type for this workflow while preserving typed inputs.
   *
   * Pass the agent as a runtime string argument so the compiled
   * {@link WorkflowDefinition} carries the `agent` field required by
   * the registry.
   *
   * @example
   * ```typescript
   * defineWorkflow({
   *   name: "my-workflow",
   *   inputs: [{ name: "greeting", type: "string" }],
   * })
   *   .for("copilot")
   *   .run(async (ctx) => {
   *     ctx.inputs.greeting; // ✓ typed
   *     ctx.inputs.prompt;   // ✗ compile error
   *   })
   *   .compile();
   * ```
   */
  for<B extends AgentType>(agent: B): WorkflowBuilder<B, I> {
    const next = new WorkflowBuilder<B, I>(this.options as WorkflowOptions<I>);
    next.agentValue = agent;
    next.runFn = this.runFn as ((ctx: WorkflowContext<B, I>) => Promise<void>) | null;
    return next;
  }

  /**
   * Set the workflow's entry point.
   *
   * The callback receives a {@link WorkflowContext} with `stage()` for
   * spawning agent sessions, and `transcript()` / `getMessages()` for
   * reading completed session outputs. Use native TypeScript control flow
   * (loops, conditionals, `Promise.all()`) for orchestration.
   */
  run(fn: (ctx: WorkflowContext<A, I>) => Promise<void>): this {
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
  compile(): WorkflowDefinition<A, I> {
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
    ) as unknown as I;

    if (this.agentValue === null) {
      throw new Error(
        `Workflow "${this.options.name}" has no agent. ` +
          `Call .for("copilot") / .for("opencode") / .for("claude") before .compile().`,
      );
    }

    if (
      typeof this.options.source !== "string" ||
      this.options.source.trim() === ""
    ) {
      throw new Error(
        `Workflow "${this.options.name}" has no resolvable source path. ` +
          `defineWorkflow auto-captures the caller's file path; this fired ` +
          `because the stack frame couldn't be parsed (e.g. compiled-binary ` +
          `bunfs paths). Pass an explicit \`\` to ` +
          `defineWorkflow({ ... }) to override.`,
      );
    }

    const definition: WorkflowDefinition<A, I> = {
      __brand: "WorkflowDefinition" as const,
      name: this.options.name,
      agent: this.agentValue as A,
      description: this.options.description ?? "",
      inputs,
      minSDKVersion: this.options.minSDKVersion ?? null,
      source: this.options.source,
      run: runFn,
    };

    // Register in the module-private compiled workflow list so the
    // `_emit-workflow-meta` auto-dispatch handler can drain it.
    _compiledWorkflowRegistry.push(definition as unknown as WorkflowDefinition);

    return definition;
  }
}

/**
 * Entry point for defining a workflow.
 *
 * Write the `inputs` array inline so TypeScript infers literal field
 * names and enforces them on `ctx.inputs`. Use `.for(agent)` to
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
 *   .for("copilot")
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
): WorkflowBuilder<AgentType, I> {
  if (!options.name || options.name.trim() === "") {
    throw new Error("Workflow name is required.");
  }
  // Auto-capture the caller's file path so consumers don't have to pass
  // `` on every call. An explicit `source` always
  // wins so consumers can override when needed.
  const resolved: WorkflowOptions<I> = options.source
    ? options
    : { ...options, source: _captureCallerPath() ?? undefined };
  return new WorkflowBuilder<AgentType, I>(resolved);
}
