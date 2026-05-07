/**
 * `hostWorkflows` — explicit host-side dispatch helper.
 *
 * Call this AFTER all `defineWorkflow().compile()` calls in your entry
 * point. It checks `process.argv` for the `_emit-workflow-meta` and
 * `_atomic-run` internal sub-commands and, when found + token-gated,
 * handles them against the `workflows` array you pass in, then exits.
 *
 * Unlike the module-level side-effect in `auto-dispatch.ts`, this runs
 * synchronously after ESM evaluation completes — so the registry is
 * guaranteed to be populated before the dispatch logic inspects it.
 *
 * When neither sub-command is present, or when the dispatch token is
 * absent/invalid, the function returns without side-effects and the
 * caller's own `main()` continues normally.
 *
 * @example
 * ```typescript
 * import { defineWorkflow, hostWorkflows } from "@bastani/atomic";
 *
 * const myWorkflow = defineWorkflow({ name: "my-wf", source: import.meta.path })
 *   .for("claude")
 *   .run(async (ctx) => { ... })
 *   .compile();
 *
 * await hostWorkflows([myWorkflow]);
 * // user main() continues here when not dispatched
 * await main();
 * ```
 */

import type { AgentType, WorkflowInput } from "../types.ts";
import type { runWorkflow as RealRunWorkflow } from "../primitives/run.ts";
import {
  validateDispatchToken,
  parseAtomicRunArgv,
} from "./auto-dispatch.ts";

/**
 * Structural shape accepted by `hostWorkflows()`.
 *
 * Uses `run: (...args: never[]) => Promise<void>` (the bivariant trick from
 * `RegistrableWorkflow`) so that narrowly-typed `WorkflowDefinition<"claude",
 * readonly []>` values produced by `.for("claude").compile()` are assignable
 * without an `as unknown as WorkflowDefinition` cast at the call site.
 */
type HostableWorkflow = {
  readonly __brand: "WorkflowDefinition";
  readonly name: string;
  readonly agent: AgentType;
  readonly description: string;
  readonly inputs: readonly WorkflowInput[];
  readonly source: string;
  readonly minSDKVersion: string | null;
  readonly run: (...args: never[]) => Promise<void>;
};

/** Sub-commands handled exclusively by `hostWorkflows()`. */
const HOST_SUBS = new Set(["_emit-workflow-meta", "_atomic-run"]);

/** Scan `argv` from index 2 for the first HOST_SUBS token. */
function findHostSub(argv: readonly string[]): { sub: string; index: number } | null {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]!;
    if (HOST_SUBS.has(tok)) return { sub: tok, index: i };
  }
  return null;
}

/** Serialize a HostableWorkflow into the JSON shape emitted on the meta line. */
function serializeMeta(w: HostableWorkflow): Record<string, unknown> {
  return {
    name: w.name,
    description: w.description,
    agent: w.agent,
    inputs: w.inputs,
    source: w.source,
    minSDKVersion: w.minSDKVersion ?? null,
  };
}

/** Options for `hostWorkflows()`. */
export interface HostWorkflowsOptions {
  /** Override `process.argv`. Defaults to `process.argv`. */
  argv?: readonly string[];
  /** Override `process.env`. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * Inject the run primitive. Defaults to the real `runWorkflow` from
   * `../primitives/run.ts`. Tests pass a fake to assert call args without
   * touching `mock.module()`.
   */
  runWorkflow?: typeof RealRunWorkflow;
}

/**
 * Inspect `argv` for `_emit-workflow-meta` / `_atomic-run` sub-commands
 * and handle them against the provided `workflows` array.
 *
 * Must be called **after** all `.compile()` calls so that `workflows` is
 * fully populated.
 *
 * @param workflows - Compiled workflow definitions to expose/dispatch.
 * @param options   - Optional argv/env overrides (useful in tests).
 */
export async function hostWorkflows(
  workflows: readonly HostableWorkflow[],
  options?: HostWorkflowsOptions,
): Promise<void> {
  const argv = options?.argv ?? process.argv;
  const env = options?.env ?? (process.env as Record<string, string | undefined>);

  const found = findHostSub(argv);
  if (!found || !validateDispatchToken(env, argv)) return;

  if (found.sub === "_emit-workflow-meta") {
    const meta = workflows.map(serializeMeta);
    process.stdout.write(`ATOMIC_WORKFLOW_META: ${JSON.stringify(meta)}\n`);
    process.exit(0);
  }

  // found.sub === "_atomic-run"
  const { name, agent, detach, inputs } = parseAtomicRunArgv(
    argv.slice(found.index + 1),
  );

  if (!name || !agent) {
    const missing = [!name && "--name", !agent && "--agent"].filter(Boolean).join(" ");
    process.stderr.write(`[atomic-sdk:_atomic-run] Missing required flag(s): ${missing}\n`);
    process.exit(1);
  }

  const workflow = workflows.find((d) => d.name === name && d.agent === agent);
  if (!workflow) {
    process.stderr.write(
      `[atomic-sdk:_atomic-run] No compiled workflow found for name="${name}" agent="${agent}"\n`,
    );
    process.exit(1);
  }

  const runWorkflow =
    options?.runWorkflow ??
    (await import("../primitives/run.ts")).runWorkflow;
  try {
    await runWorkflow({ workflow, inputs, detach });
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`[atomic-sdk:_atomic-run] ${msg}\n`);
    process.exit(1);
  }
  process.exit(0);
}
