/**
 * Argv side-effect that auto-dispatches the SDK's internal sub-commands
 * (`_orchestrator-entry`, `_cc-debounce`, `_emit-workflow-meta`,
 * `_atomic-run`).
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
 *   `_emit-workflow-meta` (token-gated)
 *     - Requires `ATOMIC_HOST=1` env and a matching `--dispatch-token`
 *       in argv + `ATOMIC_DISPATCH_TOKEN` env (both >= 32 hex chars,
 *       equal). Mismatching tokens → fall through (no-op).
 *     - Drains `getCompiledWorkflows()` populated by `.compile()`.
 *     - Writes `ATOMIC_WORKFLOW_META: <json-array>\n` to stdout.
 *     - Exits 0.
 *
 *   `_atomic-run` (token-gated)
 *     - Same token gating as above.
 *     - Parses `--name X --agent Y [--detach] [--<input-name> <value>]…`
 *       from the remaining argv.
 *     - Looks up the matching `WorkflowDefinition` in the in-process registry.
 *     - Calls `runWorkflow({ workflow, inputs, detach })` and exits with
 *       the result code.
 *
 * Non-matching argv is a single string compare with no async cost. The
 * matching cases top-level-await the dispatch and exit.
 *
 * Token-gated handlers fall through silently when tokens are absent or
 * mismatched so the third-party command's own main() runs normally.
 *
 * `validateDispatchToken` is exported for unit testing.
 */

// ─── Token-gating helper ─────────────────────────────────────────────────────

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
 *
 * Exported so it can be unit-tested without spawning a subprocess.
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

// ─── Argv dispatch ────────────────────────────────────────────────────────────

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
} else if (sub === "_emit-workflow-meta") {
  if (validateDispatchToken(process.env as Record<string, string | undefined>, process.argv)) {
    const { getCompiledWorkflows } = await import("../define-workflow.ts");
    const defs = getCompiledWorkflows();
    const meta = defs.map((d) => {
      // Build a portable JSON representation — only serializable fields.
      const entry: {
        name: string;
        description: string;
        agent: string;
        inputs: readonly import("../types.ts").WorkflowInput[];
        source: string;
        minSDKVersion?: string;
      } = {
        name: d.name,
        description: d.description,
        agent: d.agent,
        inputs: d.inputs,
        source: d.source,
      };
      if (d.minSDKVersion !== null && d.minSDKVersion !== undefined) {
        entry.minSDKVersion = d.minSDKVersion;
      }
      return entry;
    });
    process.stdout.write(`ATOMIC_WORKFLOW_META: ${JSON.stringify(meta)}\n`);
    process.exit(0);
  }
  // Token mismatch or absent env — fall through to host's CLI parser.
} else if (sub === "_atomic-run") {
  if (validateDispatchToken(process.env as Record<string, string | undefined>, process.argv)) {
    // Parse trailing argv: --name X --agent Y [--detach] [--<input> <value>]…
    const argv = process.argv.slice(3); // drop node/bun, script, "_atomic-run"

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
      } else if (tok.startsWith("--") && i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
        // --<input-name> <value>
        const inputName = tok.slice(2);
        inputs[inputName] = argv[++i]!;
      }
    }

    if (!name || !agent) {
      process.stderr.write(
        `[atomic-sdk:_atomic-run] Missing required flag(s): ${!name ? "--name" : ""} ${!agent ? "--agent" : ""}`.trim() + "\n",
      );
      process.exit(1);
    }

    const { getCompiledWorkflows } = await import("../define-workflow.ts");
    const defs = getCompiledWorkflows();
    const workflow = defs.find((d) => d.name === name && d.agent === agent);

    if (!workflow) {
      process.stderr.write(
        `[atomic-sdk:_atomic-run] No compiled workflow found for name="${name}" agent="${agent}"\n`,
      );
      process.exit(1);
    }

    const { runWorkflow } = await import("../primitives/run.ts");
    try {
      await runWorkflow({ workflow, inputs, detach });
      process.exit(0);
    } catch (err) {
      process.stderr.write(
        `[atomic-sdk:_atomic-run] ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }\n`,
      );
      process.exit(1);
    }
  }
  // Token mismatch or absent env — fall through to host's CLI parser.
}
