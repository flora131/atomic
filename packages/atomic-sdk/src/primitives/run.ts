/**
 * `runWorkflow` primitive — the public entry point for spawning a
 * workflow tmux session.
 *
 * Thin wrapper around the runtime executor's `executeWorkflow`. Handles
 * the input-validation step so the executor's contract stays single-
 * responsibility: caller passes raw inputs, primitive validates them
 * against the workflow's schema, executor only sees a clean record.
 *
 * ## Side-effect: argv auto-dispatch
 *
 * This module also installs a top-level argv handler at load time. When
 * any host that imports `runWorkflow` is invoked with `argv[2]` matching
 * one of the SDK's internal sub-commands (`_orchestrator-entry`,
 * `_cc-debounce`), the side-effect runs the sub-command and exits
 * before the host's CLI parser even sees argv. This eliminates the
 * boilerplate that compiled-binary hosts would otherwise need at the
 * top of their entry point — the SDK barrel does it automatically.
 *
 * For `_orchestrator-entry`, the side-effect tries dynamic-import-by-
 * source-path. If the source isn't a workflow module
 * (`InvalidWorkflowError` — typical for atomic's compiled binary, where
 * every bundled module's `import.meta.path` collapses to the binary
 * entry), the side-effect falls through silently and lets the host's
 * own command parser handle the sub-command via whatever fallback it
 * has registered (e.g., a builtin-registry lookup). Any other failure
 * surfaces to stderr and exits 1.
 */

import { executeWorkflow } from "../runtime/executor.ts";
import type { RegistrableWorkflow, WorkflowDefinition } from "../types.ts";
import { validateInputs } from "./inputs.ts";

// ─── Argv auto-dispatch ─────────────────────────────────────────────────────
//
// Runs at module load. Non-matching argv is a single string compare with
// no async cost; matching argv top-level-awaits the dispatch and exits.
{
  const sub = process.argv[2];
  if (sub === "_orchestrator-entry") {
    const agent = process.argv[4] ?? "";
    const inputsB64 = process.argv[5] ?? "";
    const source = process.argv[6] ?? "";
    try {
      const { runOrchestratorEntry } = await import(
        "../runtime/orchestrator-entry.ts"
      );
      await runOrchestratorEntry(source, agent, inputsB64);
      process.exit(0);
    } catch (err) {
      const { InvalidWorkflowError } = await import("../errors.ts");
      if (err instanceof InvalidWorkflowError) {
        // Source path didn't resolve to a workflow module. Typical when
        // the host's bundler collapsed `import.meta.path` to the binary
        // entry (atomic's own compiled CLI). Defer to the host's command
        // parser — it likely has a registry-aware fallback registered.
        if (process.env.ATOMIC_DEBUG === "1") {
          process.stderr.write(
            `[atomic-sdk:auto-dispatch] InvalidWorkflowError; deferring to host argv parser\n`,
          );
        }
      } else {
        process.stderr.write(
          `[atomic-sdk:_orchestrator-entry] ${
            err instanceof Error ? err.stack ?? err.message : String(err)
          }\n`,
        );
        process.exit(1);
      }
    }
  } else if (sub === "_cc-debounce") {
    const paneId = process.argv[3] ?? "";
    const { runCcDebounce } = await import("../runtime/cc-debounce.ts");
    process.exit(runCcDebounce(paneId));
  }
}

// ─── runWorkflow ────────────────────────────────────────────────────────────

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
   * Optional dispatcher binary override. Mirrors the Claude Agent SDK's
   * `pathToClaudeCodeExecutable`. When unset, the SDK auto-defaults to
   * `process.execPath` in compiled-binary hosts (so the host's own
   * binary self-dispatches the internal sub-commands via this module's
   * argv side-effect) and to host-bun resolution otherwise. Set this
   * only when you want to route through a separately-installed atomic
   * binary (custom build, version pin) instead of the auto-detected
   * default. Bare command names PATH-resolve at exec time.
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
 * import { runWorkflow } from "@bastani/atomic-sdk/workflows";
 *
 * await runWorkflow({ workflow, inputs: { greeting: "hi" } });
 * ```
 */
export async function runWorkflow(
  options: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
  const { workflow, inputs = {}, cwd, detach, pathToAtomicExecutable } = options;
  // The compiled-host auto-default lives in `resolveDispatcher`
  // (`lib/self-exec.ts`), which every dispatcher consumer (executor,
  // tmux.createSession, this primitive) shares — so behavior is
  // consistent regardless of entry point. We just forward the override
  // here.
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
