/**
 * `runWorkflow` primitive — the public entry point for spawning a
 * workflow run via the atomic daemon JSON-RPC.
 *
 * Resolves/auto-spawns the daemon via `ensureStarted`, then sends a
 * `workflow/start` JSON-RPC request. In foreground mode (default), the
 * returned promise resolves after the daemon emits a `run/ended`
 * notification for the run. In `detach: true` mode the promise resolves
 * as soon as the daemon acknowledges the start.
 */

import { ensureStarted as _ensureStarted } from "../runtime/daemon.ts";
import type { MessageConnection } from "vscode-jsonrpc";
import type { RegistrableWorkflow } from "../types.ts";
import { validateInputs } from "./inputs.ts";
import { getSource, getName, getAgent } from "./metadata.ts";

// ─── Dependency injection ───────────────────────────────────────────────────

/** Dependencies for `runWorkflow` — injectable for testing. */
export interface RunWorkflowDeps {
  ensureStarted: typeof _ensureStarted;
}

const defaultDeps: RunWorkflowDeps = {
  ensureStarted: _ensureStarted,
};

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
  /**
   * Kept for compatibility; may be forwarded as environment information
   * or ignored in v2. The daemon manages the working directory internally.
   */
  cwd?: string;
  /**
   * When true, send `workflow/start` and return immediately without
   * waiting for the run to finish. The caller may subscribe to
   * notifications on the returned `daemon` connection.
   */
  detach?: boolean;
  /**
   * Optional path to the atomic binary. Maps to `atomicBinary` in
   * `ensureStarted`. When unset, the SDK auto-resolves via
   * `ATOMIC_BINARY` env var, then `Bun.which("atomic")`.
   */
  pathToAtomicExecutable?: string;
  /** Endpoint file path override (forwarded to `ensureStarted`). */
  endpointFile?: string;
  /** Pre-shared token override (forwarded to `ensureStarted`). */
  token?: string;
}

/** Result of a successful `runWorkflow()` call. */
export interface RunWorkflowResult {
  /** Run id returned by the daemon. */
  runId: string;
  /** Live connection to the daemon. Caller may subscribe to notifications or dispose. */
  daemon: MessageConnection;
}

/**
 * Run a compiled workflow via the atomic daemon JSON-RPC.
 *
 * Validates inputs, ensures the daemon is running (spawning it if
 * necessary), then sends `workflow/start`. In foreground mode (default),
 * waits for the `run/ended` notification before resolving. In
 * `detach: true` mode resolves as soon as the daemon acknowledges the
 * start request.
 *
 * @example
 * ```ts
 * import workflow from "./hello.ts";
 * import { runWorkflow } from "@bastani/atomic-sdk/workflows";
 *
 * const { runId } = await runWorkflow({ workflow, inputs: { greeting: "hi" } });
 * console.log("Run completed:", runId);
 * ```
 */
export async function runWorkflow(
  options: RunWorkflowOptions,
  _deps: RunWorkflowDeps = defaultDeps,
): Promise<RunWorkflowResult> {
  const { workflow, inputs = {}, detach, pathToAtomicExecutable, endpointFile, token } = options;

  const resolved = validateInputs(workflow, inputs);

  const conn = await _deps.ensureStarted({
    atomicBinary: pathToAtomicExecutable,
    endpointFile,
    token,
  });

  if (detach) {
    // Fire-and-forget: send request, return immediately.
    const result = await conn.sendRequest("workflow/start", {
      source: getSource(workflow),
      workflowName: getName(workflow),
      agent: getAgent(workflow),
      inputs: resolved,
    }) as { runId: string; attachable: true };
    return { runId: result.runId, daemon: conn };
  }

  // Foreground mode: register run/ended handler BEFORE sending workflow/start
  // to close the race where daemon completes before we subscribe.
  //
  // waitPromise is created first so resolveEnded/rejectEnded are always
  // initialised before any handler can fire (including synchronous mocks).
  let pendingRunId: string | undefined;
  const buffered: Array<{ runId: string }> = [];
  let resolveEnded!: () => void;
  let rejectEnded!: (err: Error) => void;

  const waitPromise = new Promise<void>((resolve, reject) => {
    resolveEnded = resolve;
    rejectEnded = reject;
  });

  const notifDisposable = conn.onNotification("run/ended", (params: { runId: string }) => {
    if (pendingRunId === undefined) {
      // runId not yet known — buffer for post-request check.
      buffered.push(params);
    } else if (params.runId === pendingRunId) {
      resolveEnded();
    }
  });

  const closeDisposable = conn.onClose(() => {
    rejectEnded(new Error("[atomic] daemon connection closed before run/ended"));
  });

  const result = await conn.sendRequest("workflow/start", {
    source: getSource(workflow),
    workflowName: getName(workflow),
    agent: getAgent(workflow),
    inputs: resolved,
  }) as { runId: string; attachable: true };

  const { runId } = result;
  pendingRunId = runId;

  // If notification already arrived during sendRequest, resolve immediately.
  if (buffered.some((n) => n.runId === runId)) {
    resolveEnded();
  }

  await waitPromise;

  notifDisposable.dispose();
  closeDisposable.dispose();

  return { runId, daemon: conn };
}
