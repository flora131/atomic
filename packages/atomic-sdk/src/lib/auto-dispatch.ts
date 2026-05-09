/**
 * Argv side-effect that auto-dispatches the SDK's internal sub-commands
 * (`_orchestrator-entry`, `_cc-debounce`).
 *
 * Imported at the top of `primitives/run.ts` so any host that calls
 * `runWorkflow` (directly or via a barrel re-export) loads this module
 * during its startup import chain. When `process.argv[2]` matches one
 * of the internal sub-command names, the side-effect runs the
 * sub-command and exits — before the host's CLI parser sees argv. This
 * is what lets compiled third-party hosts work with no boilerplate.
 *
 * Behavior:
 *   `_orchestrator-entry`
 *     - Try `runOrchestratorEntry(source, workflowName, agent, inputsB64)`.
 *     - On `InvalidWorkflowError`, fall through silently. Atomic's
 *       compiled binary collapses every bundled module's
 *       `import.meta.path` to the binary entry, so the SDK's
 *       source-path dynamic-import legitimately can't resolve atomic's
 *       builtin workflows. Atomic's hidden Commander handler picks up
 *       the dispatch via `createBuiltinRegistry().resolve(name, agent)`.
 *     - Any other failure is fatal — log to stderr and `exit 1`.
 *
 *   `_cc-debounce`
 *     - Run `runCcDebounce(paneId)` and exit with its return code.
 *
 * The token-gated `_emit-workflow-meta` and `_atomic-run` sub-commands
 * are handled by `hostLocalWorkflows()` in `./host-local-workflows.ts`, which the
 * user calls explicitly AFTER their `compile()` calls so the workflow
 * registry is populated at dispatch time.
 *
 * Non-matching argv is a single string compare with no async cost. The
 * matching cases top-level-await the dispatch and exit.
 *
 * `validateDispatchToken`, `findSub`, `parseAtomicRunArgv`, and
 * `AtomicRunArgs` live in `./dispatch-utils.ts` so `host-local-workflows.ts`
 * can consume them without creating a static import cycle through this
 * module's TLA. Re-exported here for backwards compatibility with any
 * external consumer that imported them via this path.
 */

export {
  validateDispatchToken,
  findSub,
  parseAtomicRunArgv,
  type AtomicRunArgs,
} from "./dispatch-utils.ts";

import { findSub } from "./dispatch-utils.ts";

// ─── Argv dispatch ────────────────────────────────────────────────────────────

const found = findSub(process.argv);

if (found?.sub === "_orchestrator-entry") {
  // Arguments follow immediately after the sub-command token, in the same
  // order the executor emits them: [workflowName, agent, inputsB64, source].
  const workflowName = process.argv[found.index + 1] ?? "";
  const agent = process.argv[found.index + 2] ?? "";
  const inputsB64 = process.argv[found.index + 3] ?? "";
  const source = process.argv[found.index + 4] ?? "";
  try {
    // Install OpenTUI's runtime-plugin support exactly once per process.
    // Capsules built with `external: ["@opentui/*"]` bundle this file, so the
    // bundled TLA re-runs on capsule import; the sentinel — the same global
    // that `ensureRuntimePluginSupport` writes — short-circuits the second
    // call and avoids OpenTUI's identity assertion. Gated to this subprocess
    // because the underlying `Bun.plugin()` installs a `filter: /.*/` async
    // onLoad that would break sync `require()` of `.ts` modules elsewhere.
    const SENTINEL_KEY = "__opentuiCoreRuntimePluginSupportInstalled__";
    const alreadyInstalled = SENTINEL_KEY in globalThis;
    if (!alreadyInstalled) {
      const { ensureRuntimePluginSupport } = await import(
        "@opentui/core/runtime-plugin-support/configure"
      );
      ensureRuntimePluginSupport({ core: () => import("@opentui/core") });
    }
    if (process.env.ATOMIC_DEBUG === "1") {
      const message = alreadyInstalled
        ? "[atomic-sdk:runtime-plugin] skipped install (already present)"
        : "[atomic-sdk:runtime-plugin] registered core loader (orchestrator-entry)";
      process.stderr.write(`${message}\n`);
    }
    const { runOrchestratorEntry } = await import(
      "../runtime/orchestrator-entry.ts"
    );
    await runOrchestratorEntry(source, workflowName, agent, inputsB64);
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
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      process.stderr.write(`[atomic-sdk:_orchestrator-entry] ${msg}\n`);
      process.exit(1);
    }
  }
} else if (found?.sub === "_cc-debounce") {
  const paneId = process.argv[found.index + 1] ?? "";
  const { runCcDebounce } = await import("../runtime/cc-debounce.ts");
  process.exit(runCcDebounce(paneId));
}
