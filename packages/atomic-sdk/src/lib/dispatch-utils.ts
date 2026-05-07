/**
 * Pure helpers shared by `auto-dispatch.ts` and `host-local-workflows.ts`.
 *
 * Lives in its own module — with no top-level await and no other SDK imports —
 * so both consumers can import it without introducing a static cycle.
 *
 * The cycle this avoids: `host-local-workflows.ts` → `auto-dispatch.ts` (whose
 * module-bottom TLA dynamic-imports `runtime/orchestrator-entry.ts`) →
 * `host-local-workflows.ts` (still suspended on its first import). When the
 * orchestrator path called `lookupLocalWorkflow`, `localWorkflowRegistry` was
 * still in TDZ and the binary crashed with "undefined is not an object".
 *
 * `auto-dispatch.ts` re-exports these names so any external consumer that
 * reached for them via that path keeps working.
 */

// ─── Token-gating ────────────────────────────────────────────────────────────

/** Minimum length of a valid dispatch token (32 hex chars = 16 bytes). */
const MIN_TOKEN_HEX_LEN = 32;

/** Pattern matching a valid hex token (0-9 a-f only, case-insensitive). */
const HEX_RE = /^[0-9a-f]+$/i;

/**
 * Validate that the dispatch token is present and consistent between
 * `process.env` and `process.argv`.
 *
 * Rules (all must pass):
 *   1. `env.ATOMIC_HOST === "1"`
 *   2. `env.ATOMIC_DISPATCH_TOKEN` is a hex string >= 32 chars.
 *   3. `argv` contains `--dispatch-token=<hex>` where `<hex>` matches
 *      the env token (case-insensitive) and is >= 32 chars.
 */
export function validateDispatchToken(
  env: Record<string, string | undefined>,
  argv: readonly string[],
): boolean {
  if (env["ATOMIC_HOST"] !== "1") return false;

  const envToken = env["ATOMIC_DISPATCH_TOKEN"] ?? "";
  if (envToken.length < MIN_TOKEN_HEX_LEN || !HEX_RE.test(envToken)) {
    return false;
  }

  const prefix = "--dispatch-token=";
  const tokenArg = argv.find((a) => a.startsWith(prefix));
  if (!tokenArg) return false;

  const argToken = tokenArg.slice(prefix.length);
  if (argToken.length < MIN_TOKEN_HEX_LEN || !HEX_RE.test(argToken)) {
    return false;
  }

  return argToken.toLowerCase() === envToken.toLowerCase();
}

// ─── Subcommand scanning ─────────────────────────────────────────────────────

/**
 * Known internal sub-commands that auto-dispatch.ts handles.
 * A Set lookup is O(1) and avoids false matches on positional arguments that
 * happen to share a name with a sub-command token.
 */
const SUBS = new Set([
  "_orchestrator-entry",
  "_cc-debounce",
]);

/**
 * Scan `argv` starting at index 2 (the position after the runtime and script
 * tokens) for the first token that matches a known sub-command.
 *
 * Returns the sub-command string and its index, or `null` when none is found.
 */
export function findSub(argv: readonly string[]): { sub: string; index: number } | null {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]!;
    if (SUBS.has(tok)) return { sub: tok, index: i };
  }
  return null;
}

// ─── Argv parser for _atomic-run ─────────────────────────────────────────────

/** Parsed result from `parseAtomicRunArgv`. */
export interface AtomicRunArgs {
  name: string | undefined;
  agent: string | undefined;
  detach: boolean;
  inputs: Record<string, string>;
}

/**
 * Parse the flags that follow the `_atomic-run` subcommand token.
 *
 * `argv` should be the slice of `process.argv` starting immediately after the
 * `_atomic-run` token (i.e. `process.argv.slice(subIndex + 1)`).
 *
 * Contract (mirrors atomic-side dispatcher):
 *   - `--name <value>` — workflow name (required by caller)
 *   - `--agent <value>` — agent name (required by caller)
 *   - `--detach` — boolean flag
 *   - `--dispatch-token=<hex>` — consumed by validateDispatchToken; skipped here
 *   - `--<key> <value>` — workflow input; value consumed unconditionally so that
 *     values starting with `--` (e.g. `--rev origin/main`) are preserved correctly.
 *
 * Reserved flags (`--name`, `--agent`, `--detach`, `--dispatch-token=`) are
 * matched in earlier branches, so the generic input branch only fires for
 * user-defined input names.
 */
export function parseAtomicRunArgv(argv: readonly string[]): AtomicRunArgs {
  let name: string | undefined;
  let agent: string | undefined;
  let detach = false;
  const inputs: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--name" && i + 1 < argv.length) {
      name = argv[++i];
    } else if (tok === "--agent" && i + 1 < argv.length) {
      agent = argv[++i];
    } else if (tok === "--detach") {
      detach = true;
    } else if (tok.startsWith("--dispatch-token=")) {
      // Already consumed by validateDispatchToken — skip.
    } else if (tok.startsWith("--") && i + 1 < argv.length) {
      // Atomic-side dispatcher always emits --<key> <value>; consume unconditionally.
      inputs[tok.slice(2)] = argv[++i]!;
    }
  }

  return { name, agent, detach, inputs };
}
