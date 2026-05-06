/**
 * Helpers for re-executing the atomic CLI as a fresh sub-process.
 *
 * `resolveDispatcher()` locates the dispatcher used for internal
 * sub-commands (`_orchestrator-entry`, `_cc-debounce`). Resolution
 * order — kept deliberately narrow per the SDK's encapsulation contract:
 *
 *   1. `override` (non-empty)              → `{ kind: "override-binary" }`
 *   2. SDK's prebundled CLI on disk        → `{ kind: "host-bun" }`
 *      (workspace dev or `node_modules` install — host bun spawns the
 *      SDK's bundled dispatcher, which dynamic-imports the workflow
 *      file via the consumer project's normal module resolution)
 *   3. Nothing matches                     → throws `NoDispatcherError`
 *
 * The SDK never defaults to `process.execPath`. In a compiled
 * third-party CLI `process.execPath` is the consumer's binary, not a
 * dispatcher — assuming otherwise leaks an internal CLI assumption out
 * of the SDK boundary. Compiled hosts that *do* know how to dispatch
 * Atomic's internal commands (atomic's own CLI binary) supply the path
 * explicitly via `pathToAtomicExecutable`.
 *
 * `buildSelfExecCommand()` converts a `Dispatcher` (or a raw runtime/cliPath
 * pair, retained for unit tests that exercise argv-quoting in isolation) into
 * a bash / pwsh command line suitable for tmux's `new-session`,
 * `split-window`, or `run-shell`.
 */

import { fileURLToPath } from "node:url";
import { NoDispatcherError } from "../errors.ts";
import { isCompiledBinaryRuntime } from "./runtime-env.ts";

/** Escape a string for safe interpolation inside a bash double-quoted string. */
function escBash(s: string): string {
  return s
    .replace(/\x00/g, "")
    .replace(/[\n\r]+/g, " ")
    .replace(/[\\"$`!]/g, "\\$&");
}

/** Escape a string as a PowerShell single-quoted literal. */
function quotePwshLiteral(s: string): string {
  return `'${s
    .replace(/\x00/g, "")
    .replace(/[\n\r]+/g, " ")
    .replace(/'/g, "''")}'`;
}

/** Quote an argv token for bash. Flag-shaped tokens (`--foo`, `-x`) emit
 *  bare; every other token is double-quoted to keep user data (paths,
 *  agent names, base64 payloads) safe regardless of content. */
function quoteBashArg(s: string): string {
  return s.startsWith("-") ? s : `"${escBash(s)}"`;
}

// ---------------------------------------------------------------------------
// resolveDispatcher
// ---------------------------------------------------------------------------

export interface ResolveDispatcherOptions {
  /**
   * When set and non-empty, returned verbatim as `override-binary`.
   * An explicit empty string `""` skips the compiled-host auto-default
   * — used by the smoke fixture to force-exercise `NoDispatcherError`.
   */
  override?: string;
  /**
   * Test seam for the `import.meta.resolve("@bastani/atomic-sdk/cli")`
   * lookup that backs the host-bun branch. Return a `file://` URL or
   * throw to control the branch.
   */
  resolveSdkCli?: () => string;
  /**
   * Test seam for the compiled-binary detection that drives the
   * auto-default to `process.execPath`. Defaults to checking
   * `import.meta.dir` of this module against `isCompiledBinaryRuntime`.
   */
  compiledRuntimeProbe?: () => boolean;
}

/**
 * Discriminated union describing how the SDK should be dispatched.
 *
 * - `override-binary`: caller supplied an explicit binary path/name.
 * - `host-bun`:        SDK ships at a real on-disk path; spawn the SDK's
 *                      own dispatcher (`@bastani/atomic-sdk/cli`) via
 *                      host bun. Module resolution from the workflow's
 *                      project tree resolves `@bastani/atomic-sdk` normally.
 */
export type Dispatcher =
  | { kind: "override-binary"; binary: string }
  | { kind: "host-bun";        runtime: string; cliPath: string };

/** Trace the resolved dispatcher to stderr when `ATOMIC_DEBUG=1`. */
function logResolution(dispatcher: Dispatcher): void {
  if (process.env.ATOMIC_DEBUG !== "1") return;
  const tag = "[atomic-sdk:resolveDispatcher]";
  switch (dispatcher.kind) {
    case "override-binary":
      console.error(`${tag} kind=override-binary binary=${dispatcher.binary}`);
      return;
    case "host-bun":
      console.error(
        `${tag} kind=host-bun runtime=${dispatcher.runtime} cliPath=${dispatcher.cliPath}`,
      );
      return;
  }
}

/**
 * Locate the dispatcher for the current environment.
 *
 * Resolution order:
 *   1. Explicit `override` (non-empty)        → `override-binary`
 *   2. Compiled-binary host w/ no override    → auto-default to
 *                                                `process.execPath`
 *                                                (`override-binary`)
 *   3. SDK cli.ts on disk (host-bun)          → `host-bun`
 *   4. Nothing matches                        → `NoDispatcherError`
 *
 * The compiled-host auto-default in step 2 means every `runWorkflow` /
 * `createSession` call from a compiled host (atomic's own CLI, or any
 * `bun build --compile`d third-party CLI that imports the SDK)
 * self-dispatches through its own binary without consumer boilerplate.
 * The SDK barrel installs a top-level argv handler at module-load time
 * (see `primitives/run.ts`) so the spawned `<binary> _orchestrator-entry
 * <args>` is intercepted before the host's CLI parser sees argv.
 *
 * Test seam: `compiledRuntimeProbe` overrides the compiled-binary check
 * so unit tests can exercise both branches without running inside a
 * real compiled binary.
 */
export function resolveDispatcher(opts?: ResolveDispatcherOptions): Dispatcher {
  const override = opts?.override;
  if (override && override.length > 0) {
    const result: Dispatcher = { kind: "override-binary", binary: override };
    logResolution(result);
    return result;
  }

  // An explicit empty-string override is treated as "skip the auto-default
  // too" — used by the smoke fixture's NoDispatcherError step to exercise
  // the failure path without recompiling the host.
  const skipAutoDefault = override === "";

  // Auto-default for compiled-binary hosts: route through
  // `process.execPath` so the host's own binary self-dispatches the
  // internal sub-command via the SDK barrel's argv side-effect. The
  // probe checks `import.meta.dir` of *this module*, which is bunfs-
  // rooted in any compiled host (atomic or third-party).
  if (!skipAutoDefault) {
    const isCompiled = opts?.compiledRuntimeProbe
      ? opts.compiledRuntimeProbe()
      : isCompiledBinaryRuntime(import.meta.dir);
    if (isCompiled) {
      const result: Dispatcher = {
        kind: "override-binary",
        binary: process.execPath,
      };
      logResolution(result);
      return result;
    }
  }

  // Host-bun: the SDK's own dispatcher lives at a real on-disk path
  // (workspace dev or `node_modules` install). Spawn it via the current
  // bun interpreter. Module resolution from the workflow file's project
  // tree resolves `@bastani/atomic-sdk` normally.
  let resolvedUrl: string | undefined;
  try {
    resolvedUrl = opts?.resolveSdkCli
      ? opts.resolveSdkCli()
      : import.meta.resolve("@bastani/atomic-sdk/cli");
  } catch {
    /* not resolvable */
  }

  if (resolvedUrl) {
    const cliPath = fileURLToPath(resolvedUrl);
    if (!isCompiledBinaryRuntime(cliPath)) {
      const result: Dispatcher = {
        kind: "host-bun",
        runtime: process.execPath,
        cliPath,
      };
      logResolution(result);
      return result;
    }
  }

  throw new NoDispatcherError({
    searchedFor: ["@bastani/atomic-sdk/cli (host-bun)"],
  });
}

// ---------------------------------------------------------------------------
// buildSelfExecCommand
// ---------------------------------------------------------------------------

/**
 * Map a `Dispatcher` to the `{ runtime, cliPath }` pair `buildSelfExecCommand`
 * actually emits. The override-binary case collapses to one token; host-bun
 * keeps the runtime + script split.
 */
function dispatcherToRuntime(dispatcher: Dispatcher): {
  runtime: string;
  cliPath: string;
} {
  switch (dispatcher.kind) {
    case "host-bun":
      return { runtime: dispatcher.runtime, cliPath: dispatcher.cliPath };
    case "override-binary":
      return { runtime: dispatcher.binary, cliPath: dispatcher.binary };
  }
}

/**
 * Build a bash / pwsh command line that re-executes the atomic CLI with
 * the given internal sub-command and positional arguments. Used as the
 * argument to tmux's `new-session` / `split-window` / `run-shell`.
 *
 * Accepts either a `Dispatcher` union (preferred — produced by
 * `resolveDispatcher()`) or a raw `{ runtime, cliPath }` pair (used by
 * unit tests that exercise argv-quoting rules in isolation).
 *
 * When `runtime === cliPath` (single-binary dispatcher) we omit the script
 * argument — the binary accepts the subcommand directly, so emitting it
 * explicitly would put a stray token in front of the subcommand and
 * Commander would mis-route the call.
 */
export function buildSelfExecCommand(opts: {
  dispatcher: Dispatcher;
  subcommand: string;
  args: readonly string[];
  platform?: NodeJS.Platform;
}): string;
export function buildSelfExecCommand(opts: {
  runtime: string;
  cliPath: string;
  subcommand: string;
  args: readonly string[];
  platform?: NodeJS.Platform;
}): string;
export function buildSelfExecCommand(opts: {
  dispatcher?: Dispatcher;
  runtime?: string;
  cliPath?: string;
  subcommand: string;
  args: readonly string[];
  platform?: NodeJS.Platform;
}): string {
  const { runtime, cliPath } = opts.dispatcher
    ? dispatcherToRuntime(opts.dispatcher)
    : { runtime: opts.runtime!, cliPath: opts.cliPath! };
  const { subcommand, args, platform = process.platform } = opts;
  const isSelfExec = runtime === cliPath;

  if (platform === "win32") {
    const parts = [quotePwshLiteral(runtime)];
    if (!isSelfExec) parts.push(quotePwshLiteral(cliPath));
    parts.push(quotePwshLiteral(subcommand));
    for (const arg of args) parts.push(quotePwshLiteral(arg));
    return parts.join(" ");
  }

  const cliPart = isSelfExec ? "" : `"${escBash(cliPath)}" `;
  const argParts = args.map(quoteBashArg).join(" ");
  return (
    `"${escBash(runtime)}" ${cliPart}${subcommand}` +
    (argParts ? ` ${argParts}` : "")
  );
}
