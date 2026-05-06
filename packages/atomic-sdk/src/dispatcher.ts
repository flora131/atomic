/**
 * Self-dispatch helper for third-party `bun build --compile`d SDK consumers.
 *
 * In a compiled-binary host, `process.execPath` is the consumer's binary —
 * not the atomic CLI and not host bun. The default
 * `@bastani/atomic-sdk/cli` script can't be spawned because its bunfs path
 * is only readable by the host binary's own process. The SDK therefore
 * defaults `pathToAtomicExecutable` to `process.execPath`, expecting the
 * consumer's own binary to handle the internal sub-commands
 * (`_orchestrator-entry`, `_cc-debounce`).
 *
 * `handleSelfDispatch()` provides exactly that handler. Call it as the very
 * first statement in your CLI entry point, before any Commander / yargs /
 * citty parser sees argv:
 *
 * ```ts
 * import { handleSelfDispatch } from "@bastani/atomic-sdk/dispatcher";
 * await handleSelfDispatch();
 *
 * // ...rest of your CLI...
 * ```
 *
 * When `argv[2]` is `_orchestrator-entry` or `_cc-debounce` the helper
 * runs the internal sub-command and exits. Otherwise it returns and your
 * own CLI continues normally.
 */

/**
 * Inspect `process.argv`. If it matches one of the SDK's internal
 * sub-command shapes, run it and `process.exit` — never returns. Otherwise
 * resolves to `void` and the caller's CLI proceeds.
 */
export async function handleSelfDispatch(
  argv: readonly string[] = process.argv,
): Promise<void> {
  const subcommand = argv[2];

  if (subcommand === "_orchestrator-entry") {
    // argv shape: <runtime> <script> _orchestrator-entry <name> <agent>
    //             [inputsB64] [workflowSource]
    const agent      = argv[4] ?? "";
    const inputsB64  = argv[5] ?? "";
    const source     = argv[6] ?? "";
    const { runOrchestratorEntry } = await import(
      "./runtime/orchestrator-entry.ts"
    );
    try {
      await runOrchestratorEntry(source, agent, inputsB64);
      process.exit(0);
    } catch (err) {
      process.stderr.write(
        `[atomic-sdk:_orchestrator-entry] ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }\n`,
      );
      process.exit(1);
    }
  }

  if (subcommand === "_cc-debounce") {
    const paneId = argv[3] ?? "";
    const { runCcDebounce } = await import("./runtime/cc-debounce.ts");
    process.exit(runCcDebounce(paneId));
  }
}
