/**
 * `hostLocalWorkflows` — explicit host-side dispatch helper.
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
 * import { defineWorkflow, hostLocalWorkflows } from "@bastani/atomic";
 *
 * const myWorkflow = defineWorkflow({ name: "my-wf", source: import.meta.path })
 *   .for("claude")
 *   .run(async (ctx) => { ... })
 *   .compile();
 *
 * await hostLocalWorkflows([myWorkflow]);
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
 * Structural shape accepted by `hostLocalWorkflows()`.
 *
 * Uses `run: (...args: never[]) => Promise<void>` (the bivariant trick from
 * `RegistrableWorkflow`) so that narrowly-typed `WorkflowDefinition<"claude",
 * readonly []>` values produced by `.for("claude").compile()` are assignable
 * without an `as unknown as WorkflowDefinition` cast at the call site.
 */
type HostableLocalWorkflow = {
  readonly __brand: "WorkflowDefinition";
  readonly name: string;
  readonly agent: AgentType;
  readonly description: string;
  readonly inputs: readonly WorkflowInput[];
  readonly source: string;
  readonly minSDKVersion: string | null;
  readonly run: (...args: never[]) => Promise<void>;
};

/** Sub-commands handled exclusively by `hostLocalWorkflows()`. */
const HOST_SUBS = new Set(["_emit-workflow-meta", "_atomic-run"]);

/**
 * Sub-commands owned by `auto-dispatch.ts`. When any of these appear in
 * `argv` we know the SDK is in the middle of an internal re-import
 * (e.g. the orchestrator pane re-imports the user's CLI to resolve the
 * workflow definition). Returning silently after the registry side-
 * effect is critical — auto-running here would recursively spawn
 * another tmux session inside the already-active orchestrator pane.
 */
const AUTODISPATCH_SUBS = new Set(["_orchestrator-entry", "_cc-debounce"]);

/**
 * Module-scoped registry of workflows passed to `hostLocalWorkflows([…])`.
 *
 * Populated at every `hostLocalWorkflows()` call (before any argv inspection).
 * `runOrchestratorEntry` consults this registry by `(agent, name)` after
 * dynamic-importing the workflow source path, so consumers don't need to
 * `export default` the compiled workflow alongside the `hostLocalWorkflows()`
 * call — the array argument is the single declaration.
 *
 * Keyed by `${agent}:${name}` because (name, agent) is the dispatch
 * identity and a single source file may register multiple workflows.
 */
const localWorkflowRegistry = new Map<string, HostableLocalWorkflow>();

function registryKey(agent: string, name: string): string {
  return `${agent}:${name}`;
}

/**
 * Look up a workflow registered via `hostLocalWorkflows([…])` by
 * `(name, agent)`. Returns `undefined` if no workflow has been
 * registered for that pair in the current process.
 *
 * Used by `runOrchestratorEntry` (and unit tests). Consumers should call
 * `hostLocalWorkflows()` to register; this function is a read-only accessor.
 */
export function lookupLocalWorkflow(
  name: string,
  agent: string,
): HostableLocalWorkflow | undefined {
  return localWorkflowRegistry.get(registryKey(agent, name));
}

/** Test seam: clear the host-workflow registry between tests. */
export function _clearLocalWorkflowRegistry(): void {
  localWorkflowRegistry.clear();
}

/** Scan `argv` from index 2 for the first HOST_SUBS token. */
function findHostSub(argv: readonly string[]): { sub: string; index: number } | null {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]!;
    if (HOST_SUBS.has(tok)) return { sub: tok, index: i };
  }
  return null;
}

/** Serialize a HostableLocalWorkflow into the JSON shape emitted on the meta line. */
function serializeMeta(w: HostableLocalWorkflow): Record<string, unknown> {
  return {
    name: w.name,
    description: w.description,
    agent: w.agent,
    inputs: w.inputs,
    source: w.source,
    minSDKVersion: w.minSDKVersion ?? null,
  };
}

/** Options for `hostLocalWorkflows()`. */
export interface HostLocalWorkflowsOptions {
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
 * (atomic dispatch) or a direct `--name <X>` invocation (manual CLI use)
 * and handle them against the provided `workflows` array.
 *
 * Must be called **after** all `.compile()` calls so that `workflows` is
 * fully populated.
 *
 * Always exits the process. Provides a turnkey standalone CLI
 * experience with four modes:
 *   1. Atomic-dispatched `_emit-workflow-meta` (token-gated) — emits
 *      the metadata line and exits 0.
 *   2. Atomic-dispatched `_atomic-run` (token-gated) — runs the named
 *      workflow via `runWorkflow` and exits 0.
 *   3. Direct CLI invocation — `bun run script.ts [--name <X>]
 *      [--agent <Y>] [--<input> <v>]… [--detach]`. Resolves the target
 *      workflow by `--name` (with `--agent` to disambiguate), or
 *      auto-targets the only registered workflow when no `--name` is
 *      supplied. Runs via `runWorkflow` and exits.
 *   4. Bare invocation (`bun run script.ts` with no flags) — prints
 *      registered workflows + invocation hint and exits 0.
 *
 * **Opt-out by absence.** If you want to wire your custom workflow
 * into your own commander/CLI parser, do not call
 * `hostLocalWorkflows`. Import `runWorkflow` from
 * `@bastani/atomic-sdk` and dispatch yourself; you'll lose atomic's
 * automatic discovery (`_emit-workflow-meta`) but keep full argv
 * control.
 *
 * @param workflows - Compiled workflow definitions to expose/dispatch.
 * @param options   - Optional argv/env overrides (useful in tests).
 */
export async function hostLocalWorkflows(
  workflows: readonly HostableLocalWorkflow[],
  options?: HostLocalWorkflowsOptions,
): Promise<void> {
  const argv = options?.argv ?? process.argv;
  const env = options?.env ?? (process.env as Record<string, string | undefined>);

  // Register supplied workflows into the host registry BEFORE any argv
  // inspection. This runs on every call — including when the dispatcher
  // pane re-imports this file under `_orchestrator-entry`, where the
  // function returns silently below but the registry side-effect lets
  // `runOrchestratorEntry` resolve the definition without requiring the
  // consumer to also `export default` the workflow.
  for (const w of workflows) {
    localWorkflowRegistry.set(registryKey(w.agent, w.name), w);
  }

  // Silent-return when argv signals an auto-dispatch re-import (e.g. the
  // orchestrator pane spawned by `_atomic-run` re-imports the user's CLI
  // to resolve the workflow definition). Without this guard the direct-
  // CLI / help branches below would auto-run a fresh workflow inside the
  // already-spawned orchestrator pane — infinite recursion.
  for (let i = 2; i < argv.length; i++) {
    if (AUTODISPATCH_SUBS.has(argv[i]!)) return;
  }

  const found = findHostSub(argv);
  if (found) {
    // A dispatch sub-command is present. Validate the token before
    // honouring it; without a matching token this is a hijack attempt
    // (e.g. `bunx my-pkg _emit-workflow-meta --dispatch-token=fake`)
    // — silent-return so the consumer's own main() runs as if the
    // sub-command weren't there.
    if (!validateDispatchToken(env, argv)) return;

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

  // ─── No dispatch sub-command — direct CLI / bare invocation ─────────
  const cli = parseAtomicRunArgv(argv.slice(2));

  // Bare invocation with no flags → print registered workflows + invocation
  // hint and exit. Consumers who don't want this behaviour should not call
  // hostLocalWorkflows and should dispatch via runWorkflow directly.
  if (argv.length <= 2) {
    printHelp(workflows);
    process.exit(0);
  }

  // Resolve target workflow: explicit --name wins; otherwise auto-target
  // the single registered workflow when there is exactly one.
  let workflow: HostableLocalWorkflow;
  if (cli.name) {
    workflow = resolveByName(workflows, cli.name, cli.agent);
  } else if (workflows.length === 1) {
    workflow = workflows[0]!;
  } else {
    process.stderr.write(
      `[hostLocalWorkflows] Multiple workflows registered ` +
        `(${workflows.map((w) => `${w.name}/${w.agent}`).join(", ")}). Specify --name <name>.\n`,
    );
    process.exit(1);
  }

  const runWorkflow =
    options?.runWorkflow ??
    (await import("../primitives/run.ts")).runWorkflow;
  try {
    await runWorkflow({ workflow, inputs: cli.inputs, detach: cli.detach });
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`[hostLocalWorkflows] ${msg}\n`);
    process.exit(1);
  }
  process.exit(0);
}

/**
 * Resolve a workflow by name (and optional explicit agent). Exits 1 with
 * a clear stderr message on miss / ambiguity. Pulled out so the
 * resolution rules stay in one place.
 */
function resolveByName(
  workflows: readonly HostableLocalWorkflow[],
  name: string,
  agent: string | undefined,
): HostableLocalWorkflow {
  const matches = workflows.filter((w) => w.name === name);
  if (matches.length === 0) {
    process.stderr.write(
      `[hostLocalWorkflows] No registered workflow named "${name}". ` +
        `Available: ${workflows.map((w) => `${w.name}/${w.agent}`).join(", ") || "(none)"}\n`,
    );
    process.exit(1);
  }
  if (agent) {
    const exact = matches.find((w) => w.agent === agent);
    if (!exact) {
      process.stderr.write(
        `[hostLocalWorkflows] Workflow "${name}" is not registered for agent "${agent}". ` +
          `Registered agents: ${matches.map((w) => w.agent).join(", ")}\n`,
      );
      process.exit(1);
    }
    return exact;
  }
  if (matches.length === 1) return matches[0]!;
  process.stderr.write(
    `[hostLocalWorkflows] Workflow "${name}" is registered for multiple agents ` +
      `(${matches.map((w) => w.agent).join(", ")}). Specify --agent <name>.\n`,
  );
  process.exit(1);
}

/** Print registered workflows + invocation hint to stdout. */
function printHelp(workflows: readonly HostableLocalWorkflow[]): void {
  const out = process.stdout;
  if (workflows.length === 0) {
    out.write("\nNo workflows registered with hostLocalWorkflows().\n\n");
    return;
  }
  out.write("\nAvailable workflows:\n\n");
  for (const w of workflows) {
    out.write(`  ${w.name} (${w.agent}) — ${w.description}\n`);
    for (const i of w.inputs) {
      const required = i.required ? " (required)" : "";
      const description = i.description ? ` — ${i.description}` : "";
      out.write(`      --${i.name}${required}${description}\n`);
    }
  }
  const hint =
    workflows.length === 1
      ? `\nRun:\n  bun run <script> [--<input> <value>…] [--detach]\n\n`
      : `\nRun:\n  bun run <script> --name <name> [--agent <agent>] [--<input> <value>…] [--detach]\n\n`;
  out.write(hint);
}
