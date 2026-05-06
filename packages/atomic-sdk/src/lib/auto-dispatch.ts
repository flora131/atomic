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
 *     - Try `runOrchestratorEntry(source, agent, inputsB64)`.
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
 * Non-matching argv is a single string compare with no async cost. The
 * matching cases top-level-await the dispatch and exit.
 *
 * This module has no runtime exports — its only purpose is the
 * side-effect. Coverage is exempted in `bunfig.toml` because, like the
 * SDK's `cli.ts` entry, the side-effect runs at import time and can't
 * be unit-tested without spawning a sub-process; subprocess dispatch is
 * exercised end-to-end by the `tests/fixtures/sdk-compiled-consumer/`
 * smoke matrix.
 */

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
