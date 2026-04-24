/**
 * Worker — factory for a Worker bound to a single compiled WorkflowDefinition.
 *
 * Usage shapes:
 *   createWorker(def).start({ ... })         flat-root standalone CLI (parses argv)
 *   createWorker(def).command("name")        embeddable Commander Command
 *   createWorker(def).run({ inputs })        programmatic invocation (no argv)
 *
 * Multi-workflow dispatch (e.g. the internal `atomic workflow` CLI) lives
 * in `./dispatcher.ts` under `createDispatcher(registry)`.
 */

import { Command } from "@commander-js/extra-typings";
import type {
  InputsOf,
  RegistrableWorkflow,
  Worker,
  WorkflowDefinition,
  CreateWorkerOptions,
} from "./types.ts";
import { executeWorkflow, runOrchestrator } from "./runtime/executor.ts";
import {
  toCamelCase,
  validateAndResolve,
  stringifyDefaults,
} from "./worker-shared.ts";

// ─── Command builder ────────────────────────────────────────────────────────

/**
 * Build a Commander `Command` configured for a single workflow. Exposes
 * one `--<inputName>` flag per declared input, plus `-d/--detach`. Adds
 * a trailing `[prompt...]` positional only when the workflow is free-form
 * (no declared inputs) so authors can still write `bun worker.ts "task"`.
 */
function buildCommand(
  definition: WorkflowDefinition,
  opts: {
    mountName?: string;
    startInputs?: Record<string, string>;
    argv?: string[];
  },
): Command {
  const cmd = new Command(opts.mountName);

  // --<inputName> flags — one per declared input
  for (const input of definition.inputs) {
    const desc =
      input.description ??
      (input.type === "enum" ? `one of: ${(input.values ?? []).join(", ")}` : input.type);
    cmd.option(`--${input.name} <value>`, desc);
  }

  // -d / --detach
  cmd.option("-d, --detach", "Run workflow in background (detach from tmux)");

  // Trailing positional prompt tokens for free-form workflows
  if (definition.inputs.length === 0) {
    cmd.argument("[prompt...]", "Free-form prompt (joined, stored as inputs.prompt)");
  }

  cmd.allowUnknownOption(false);
  cmd.allowExcessArguments(true);

  cmd.action(async function (this: Command) {
    const options = this.opts() as Record<string, string | boolean | undefined>;
    const promptTokens: string[] = this.args as string[];

    const detach = options["detach"] === true;

    // Collect CLI input flags. Commander camelCases hyphenated names on
    // storage: --output-type → opts.outputType. Look up by camelCase key,
    // store back under the original (hyphenated) name.
    const cliInputs: Record<string, string> = {};
    for (const input of definition.inputs) {
      const camelKey = toCamelCase(input.name);
      const v = options[camelKey];
      if (typeof v === "string" && v !== "") {
        cliInputs[input.name] = v;
      }
    }

    // Free-form trailing prompt tokens → inputs.prompt
    if (definition.inputs.length === 0) {
      const promptStr = promptTokens.join(" ");
      if (promptStr !== "") {
        cliInputs["prompt"] = promptStr;
      }
    }

    await runBound(definition, {
      cliInputs,
      startInputs: opts.startInputs,
      detach,
      entrypointFile: process.argv[1],
    });
  });

  return cmd;
}

// ─── Core dispatch ──────────────────────────────────────────────────────────

/**
 * Merge inputs (with precedence) against the bound definition's schema,
 * validate, and hand off to the executor.
 *
 * Input precedence (highest → lowest):
 *   cliInputs > runInputs > startInputs > defineWorkflow defaults (handled by validateAndResolve)
 */
async function runBound(
  definition: WorkflowDefinition,
  opts: {
    cliInputs?: Record<string, string>;
    runInputs?: Record<string, string>;
    startInputs?: Record<string, string>;
    detach?: boolean;
    entrypointFile?: string;
  },
): Promise<void> {
  const merged: Record<string, string> = {
    ...opts.startInputs,
    ...opts.runInputs,
    ...opts.cliInputs,
  };

  let resolvedInputs: Record<string, string>;
  if (definition.inputs.length > 0) {
    resolvedInputs = validateAndResolve(merged, definition.inputs);
  } else {
    resolvedInputs = { ...merged };
  }

  const entrypointFile = opts.entrypointFile ?? process.argv[1]!;
  const workflowKey = `${definition.agent}/${definition.name}`;

  await executeWorkflow({
    definition,
    agent: definition.agent,
    inputs: resolvedInputs,
    entrypointFile,
    workflowKey,
    detach: opts.detach ?? false,
  });
}

// ─── Orchestrator re-entry ──────────────────────────────────────────────────

/**
 * When the executor spawns a detached orchestrator pane, it re-invokes
 * the user's entrypoint with `ATOMIC_ORCHESTRATOR_MODE=1`. For a
 * single-definition worker, the bound `definition` is the orchestrator
 * target — no registry resolution needed.
 */
async function handleOrchestratorReEntry(definition: WorkflowDefinition): Promise<boolean> {
  if (process.env.ATOMIC_ORCHESTRATOR_MODE !== "1") {
    return false;
  }
  await runOrchestrator(definition);
  return true;
}

// ─── Public factory ─────────────────────────────────────────────────────────

/**
 * Create a worker bound to a single compiled workflow definition.
 *
 * @example
 * ```ts
 * import { createWorker } from "@bastani/atomic/workflows";
 * import workflow from "./claude/index.ts";
 *
 * const worker = createWorker(workflow);
 * await worker.start({ color: "blue" });   // CLI --color overrides
 * ```
 */
export function createWorker<D extends RegistrableWorkflow>(
  definition: D,
  options?: CreateWorkerOptions,
): Worker<D> {
  const argv = options?.argv;

  // Internal helpers consume the concrete WorkflowDefinition shape and
  // ultimately hand the definition to the executor. RegistrableWorkflow
  // exists purely to keep generic inference usable at the public API;
  // structurally the two are identical apart from the widened `run`
  // signature, so this cast is safe.
  const def = definition as unknown as WorkflowDefinition;

  const worker: Worker<D> = {
    async start(inputs?: InputsOf<D["inputs"]>): Promise<void> {
      if (await handleOrchestratorReEntry(def)) {
        return;
      }

      const startInputs = stringifyDefaults(inputs);
      const program = buildCommand(def, {
        mountName: undefined,
        startInputs,
        argv,
      });
      await program.parseAsync(argv ?? process.argv);
    },

    command(name?: string): Command {
      return buildCommand(def, {
        mountName: name ?? def.name,
        argv,
      });
    },

    async run(
      runOpts?: {
        inputs?: InputsOf<D["inputs"]>;
        detach?: boolean;
        entrypointFile?: string;
      },
    ): Promise<void> {
      const runInputs = stringifyDefaults(runOpts?.inputs);
      await runBound(def, {
        runInputs,
        detach: runOpts?.detach,
        entrypointFile: runOpts?.entrypointFile ?? process.argv[1],
      });
    },
  };

  return worker;
}

