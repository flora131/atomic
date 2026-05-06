import {
  runWorkflow,
  type RunWorkflowOptions,
  type RunWorkflowResult,
} from "@bastani/atomic-sdk/workflows";
import { isCompiledBinaryRuntime } from "@bastani/atomic-sdk/lib/runtime-env";

/**
 * Atomic-side wrapper for `runWorkflow` that points the SDK at atomic's
 * own dispatcher when atomic is running as a compiled binary. The atomic
 * CLI registers `_orchestrator-entry` and `_cc-debounce` natively, so
 * spawning `<atomic-binary> _<subcommand>` self-dispatches without any
 * extra child process.
 *
 * In dev mode (`bun packages/atomic/src/cli.ts …`) `process.execPath` is
 * the bun interpreter, NOT atomic — passing it as the override would
 * cause bun to try to exec `_orchestrator-entry` as a script path. We
 * leave `pathToAtomicExecutable` undefined in that case so the SDK
 * resolver falls through to its `host-bun` branch and spawns
 * `bun <SDK cli.ts> _<subcommand>` directly.
 */
export function runWorkflowWithSelf(
  opts: Omit<RunWorkflowOptions, "pathToAtomicExecutable">,
): Promise<RunWorkflowResult> {
  const isCompiled = isCompiledBinaryRuntime(import.meta.dir);
  const pathToAtomicExecutable = isCompiled ? process.execPath : undefined;
  return runWorkflow({ ...opts, pathToAtomicExecutable });
}
