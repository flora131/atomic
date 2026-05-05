/**
 * `runWorkflow` primitive — the public entry point for spawning a
 * workflow tmux session.
 *
 * Thin wrapper around the runtime executor's `executeWorkflow`. Handles
 * the input-validation step so the executor's contract stays single-
 * responsibility: caller passes raw inputs, primitive validates them
 * against the workflow's schema, executor only sees a clean record.
 */

import {
  executeWorkflow,
} from "../runtime/executor.ts";
import type { RegistrableWorkflow, WorkflowDefinition } from "../types.ts";
import { validateInputs } from "./inputs.ts";

/** Options for `runWorkflow()`. */
export interface RunWorkflowOptions {
  /** Compiled workflow definition (the default export of a workflow module). */
  workflow: RegistrableWorkflow;
  /**
   * Raw input map. The primitive runs the same validation pipeline the
   * atomic CLI uses: required-field check, default fill-in, enum and
   * integer parsing. Pass an empty object for free-form workflows that
   * don't take any user input.
   */
  inputs?: Record<string, string>;
  /** Project root the workflow runs in. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * When true, create the tmux session and return immediately instead
   * of attaching. The orchestrator keeps running in the background on
   * the shared atomic tmux socket and can be reattached later via
   * `attachSession()`.
   */
  detach?: boolean;
  /**
   * Path to the atomic executable used for the orchestrator pane's
   * self-exec call. Mirrors the Claude Code SDK's
   * `pathToClaudeCodeExecutable` — only set this when you want the SDK
   * to route through a separately installed `atomic` binary instead of
   * its own bundled dispatcher. Default: SDK's bundled
   * `@bastani/atomic-sdk/cli` (no extra dependency on the user-facing
   * `@bastani/atomic` package).
   */
  pathToAtomicExecutable?: string;
}

/** Result of a successful `runWorkflow()` call. */
export interface RunWorkflowResult {
  /** Workflow run id (8-char hex; the trailing segment of the tmux session name). */
  id: string;
  /** Tmux session name (`atomic-wf-<agent>-<workflowName>-<id>`). */
  tmuxSessionName: string;
}

/**
 * Run a compiled workflow.
 *
 * Validates inputs, then spawns the orchestrator tmux session via
 * `executeWorkflow`. In foreground mode, the returned promise resolves
 * after the user detaches from the session; in `detach: true` mode the
 * promise resolves as soon as the session is created on the atomic
 * socket.
 *
 * @example
 * ```ts
 * import workflow from "./hello.ts";
 * import { runWorkflow } from "@bastani/atomic/workflows";
 *
 * await runWorkflow({ workflow, inputs: { greeting: "hi" } });
 * ```
 */
export async function runWorkflow(
  options: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
  const { workflow, inputs = {}, cwd, detach, pathToAtomicExecutable } = options;
  const resolved = validateInputs(workflow, inputs);
  return await executeWorkflow({
    // Cast required because RegistrableWorkflow's `run` is `(...args: never[]) => Promise<void>`
    // (a structural shape that bypasses contravariance), while the runtime
    // executor takes the typed WorkflowDefinition. The runtime never
    // calls `run` directly through this path — it spawns a tmux session
    // and the SDK orchestrator entry imports the module fresh.
    definition: workflow as unknown as WorkflowDefinition,
    agent: workflow.agent,
    inputs: resolved,
    projectRoot: cwd,
    detach,
    pathToAtomicExecutable,
  });
}
