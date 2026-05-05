/**
 * Helpers for re-executing the atomic CLI as a fresh sub-process.
 *
 * Mirrors OpenCode's single-binary model: every fresh-process entry into
 * atomic goes through `<cli> _<subcommand>`. The launcher emits a
 * platform-appropriate command line that resolves to:
 *
 *   - **Compiled binary**: `<atomic-binary> _<subcommand> <args…>`
 *     (`process.execPath` is the binary itself; argv[0] is the subcommand)
 *
 *   - **Dev / installed-package runtime**: `<bun> <cli.{ts,js}> _<subcommand> <args…>`
 *     (`process.execPath` is the bun interpreter; the CLI script must be
 *     passed explicitly)
 *
 * By default the resolver points at the SDK's *own* bundled dispatcher
 * (`@bastani/atomic-sdk/cli`), so SDK consumers don't need the
 * user-facing `@bastani/atomic` package installed alongside. Resolution
 * is delegated to `import.meta.resolve` — the runtime consults
 * `@bastani/atomic-sdk/package.json#exports` for the canonical mapping
 * (`./cli` → `./src/cli.ts` in dev, `./dist/cli.js` post-publish). No
 * path walks, no hardcoded layout assumptions, no extension guessing.
 *
 * Consumers that prefer to route through their own atomic binary can
 * pass an `override` (wired through
 * `runWorkflow({ pathToAtomicExecutable })`, mirroring the Claude Code
 * SDK's `pathToClaudeCodeExecutable`).
 *
 * Centralising the launcher construction here keeps every internal
 * sub-command (`_footer`, `_orchestrator-entry`, `_cc-debounce`, …) on a
 * single code path, so a fix to argv handling or escaping lands in one
 * place rather than drifting across call sites.
 */

import { fileURLToPath } from "node:url";
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

/** Quote an argv token for bash. Flag names (`--foo`, `-x`) are emitted
 *  bare; every other token is always double-quoted, matching the
 *  existing launcher style. The "always quote values" rule keeps user
 *  data (paths, agent names, base64 payloads) safe regardless of
 *  content; the "bare flags" rule keeps emitted commands readable and
 *  matches the historical buildAttachedFooterCommand output. */
function quoteBashArg(s: string): string {
  return s.startsWith("-") ? s : `"${escBash(s)}"`;
}

export interface ResolveSdkCliPathOptions {
  /**
   * Optional override (typically `RunWorkflowOptions.pathToAtomicExecutable`).
   * When set and non-empty, returned verbatim — the override is the entire
   * resolution. Use this to point at a locally installed atomic binary
   * instead of the SDK's bundled dispatcher. Mirrors Claude Code SDK's
   * `pathToClaudeCodeExecutable` semantics, including bare command names
   * that the shell PATH-resolves at exec time.
   */
  override?: string;
  /**
   * Optional caller location, used **only** for compiled-binary
   * detection. Defaults to this module's own `import.meta.url`. Tests
   * inject synthetic URLs here to exercise the bunfs/~BUN branches
   * without running inside an actual compiled binary.
   */
  callerUrl?: string;
}

/**
 * Resolve the absolute path to the script that should be self-exec'd.
 *
 * Resolution order:
 *   1. `override` (if set) → returned verbatim.
 *   2. Compiled-binary runtime → `process.execPath` (the binary IS the
 *      CLI; its own argv dispatch handles the subcommand).
 *   3. Otherwise → `import.meta.resolve("@bastani/atomic-sdk/cli")`,
 *      which consults the SDK's `package.json#exports` map. The runtime
 *      itself decides which file backs the export — no path walks, no
 *      layout assumptions, no extension guessing in this code.
 *
 * Why delegate to `import.meta.resolve`: the SDK's source layout
 * (`src/cli.ts`) and its published layout (`dist/cli.js`) are different
 * shapes, and either could change again in future builds. The
 * `package.json#exports` map is the contract that consumers and the
 * publish pipeline both honour, so reading it through the runtime is
 * the only resolution that stays correct across both.
 */
export function resolveSdkCliPath(opts: ResolveSdkCliPathOptions = {}): string {
  const { override, callerUrl } = opts;
  if (override && override.length > 0) return override;

  const detectFrom = callerUrl
    ? fileURLToPath(callerUrl)
    : import.meta.dir;
  if (isCompiledBinaryRuntime(detectFrom)) {
    return process.execPath;
  }

  const url = import.meta.resolve("@bastani/atomic-sdk/cli");
  return fileURLToPath(url);
}

/**
 * Build a bash / pwsh command line that re-executes the atomic CLI with
 * the given internal sub-command and positional arguments. Use as the
 * argument to tmux's `new-session` / `split-window` / `run-shell`.
 *
 * `runtime` is typically `process.execPath`. When it equals `cliPath`
 * (compiled-binary case, or override-as-runnable-binary case) we omit
 * the script argument — the binary either auto-injects argv[1] (Bun
 * compiled binary) or accepts the subcommand directly (override binary
 * spawned via PATH/absolute path), so emitting it explicitly would put
 * a stray `<binary>` token in front of the subcommand and Commander
 * would mis-route the call.
 */
export function buildSelfExecCommand(opts: {
  runtime: string;
  cliPath: string;
  subcommand: string;
  args: readonly string[];
  platform?: NodeJS.Platform;
}): string {
  const { runtime, cliPath, subcommand, args, platform = process.platform } = opts;
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
