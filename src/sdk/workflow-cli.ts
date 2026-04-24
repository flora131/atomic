/**
 * WorkflowCli — the single entry-point factory for workflow CLIs.
 *
 * Parses `-n/--name` + `-a/--agent` from argv, exposes a union of flags
 * across every workflow in the registry, opens an interactive picker when
 * agent is given without a name in a TTY, and handles orchestrator
 * re-entry from detached runs.
 *
 * Framework-agnostic: the returned `WorkflowCli` type has no direct
 * Commander dependency. To embed under a parent Commander CLI, use
 * `toCommand(cli)` from `@bastani/atomic/workflows/commander`.
 *
 * Used by the internal `atomic workflow` command. Per-workflow CLI
 * files call `createWorkflowCli(workflow)` — the same factory supports
 * a lone workflow, an array, or a full `Registry`.
 */

import { Command } from "@commander-js/extra-typings";
import type {
  AgentType,
  Registry,
  RegistrableWorkflow,
  WorkflowCli,
  WorkflowDefinition,
  WorkflowInput,
  CreateWorkflowCliOptions,
} from "./types.ts";
import {
  executeWorkflow,
  handleOrchestratorReEntry,
} from "./runtime/executor.ts";
import { WorkflowPickerPanel } from "./components/workflow-picker-panel.tsx";
import { createRegistry } from "./registry.ts";
import {
  toCamelCase,
  validateAndResolve,
  buildInputUnion,
} from "./worker-shared.ts";

// ─── Input normalization ─────────────────────────────────────────────────────

/**
 * Normalize the three accepted `createWorkflowCli` input shapes into a
 * `Registry`. Detection is structural:
 *
 * - `Registry` has `.register`, `.list`, `.resolve` methods.
 * - Arrays are iterable; loop-register into a fresh registry.
 * - Anything else is treated as a single compiled workflow.
 */
function normalizeToRegistry<T extends Record<string, WorkflowDefinition>>(
  target: unknown,
): Registry<T> {
  // Registry detection — check for the `register` method (distinct from
  // a workflow's `run`, which is the only thing a plain definition has).
  if (target && typeof target === "object" && "register" in target &&
      typeof (target as { register?: unknown }).register === "function") {
    return target as Registry<T>;
  }

  // Array of workflows — loop-register.
  if (Array.isArray(target)) {
    let reg = createRegistry() as Registry;
    for (const wf of target) {
      reg = reg.register(wf as Parameters<typeof reg.register>[0]);
    }
    return reg as Registry<T>;
  }

  // Single workflow.
  return createRegistry().register(
    target as Parameters<ReturnType<typeof createRegistry>["register"]>[0],
  ) as Registry<T>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_AGENTS: readonly AgentType[] = ["claude", "opencode", "copilot"];

// ─── Core dispatch (internal — shared with the Commander adapter) ───────────

/**
 * Resolve the workflow definition, merge inputs (with precedence), validate,
 * and hand off to the executor.
 *
 * Input precedence (highest → lowest):
 *   cliInputs > runInputs > dispatcherInputs > defineWorkflow defaults
 *
 * Exported for `./commander.ts` — not part of the public API.
 */
export async function resolveAndStart(
  registry: Registry,
  name: string,
  agent: AgentType,
  opts: {
    cliInputs?: Record<string, string>;
    runInputs?: Record<string, string>;
    dispatcherInputs?: Record<string, string>;
    detach?: boolean;
    entry: string;
  },
): Promise<void> {
  const def = registry.resolve(name, agent);
  if (!def) {
    const available = registry
      .list()
      .filter((w) => w.name === name)
      .map((w) => w.agent);
    const availableMsg =
      available.length > 0
        ? `available agents for "${name}": ${available.join(", ")}`
        : `no workflow named "${name}" in registry`;
    throw new Error(
      `no workflow named "${name}" for agent "${agent}"; ${availableMsg}`,
    );
  }

  const merged: Record<string, string> = {
    ...opts.dispatcherInputs,
    ...opts.runInputs,
    ...opts.cliInputs,
  };

  const resolvedInputs =
    def.inputs.length > 0
      ? validateAndResolve(merged, def.inputs)
      : { ...merged };

  await executeWorkflow({
    definition: def,
    agent,
    inputs: resolvedInputs,
    entrypointFile: opts.entry,
    workflowKey: `${agent}/${name}`,
    detach: opts.detach ?? false,
  });
}

// ─── Commander command builder (internal — shared with the adapter) ─────────

/**
 * Build the Commander Command that drives the workflow CLI. Used by both
 * the standalone `run()` path and the `toCommand` adapter.
 *
 * Exported for `./commander.ts` — not part of the public API.
 */
export function buildCliCommand(
  registry: Registry,
  unionInputs: Map<string, WorkflowInput>,
  onAction: (params: {
    name: string | undefined;
    agent: AgentType | undefined;
    cliInputs: Record<string, string>;
    detach: boolean;
  }) => Promise<void>,
  mountName?: string,
): Command {
  const allWorkflows = registry.list();
  const allNames = [...new Set(allWorkflows.map((w) => w.name))];

  const cmd = new Command(mountName);

  // Required so auto-registered subcommands (session/status) can declare
  // their own `-a <agent>` without the parent greedily binding the flag
  // first. Matches what `atomic workflow` does at the top-level.
  cmd.enablePositionalOptions();

  cmd.option("-n, --name <name>", "Workflow name", (v) => {
    if (allNames.length > 0 && !allNames.includes(v)) {
      throw new Error(
        `[atomic/worker] Unknown workflow name "${v}". Available: ${allNames.join(", ")}.`,
      );
    }
    return v;
  });

  cmd.option("-a, --agent <agent>", "Agent (claude | opencode | copilot)", (v) => {
    if (!(VALID_AGENTS as string[]).includes(v)) {
      throw new Error(
        `[atomic/worker] Unknown agent "${v}". Valid agents: ${VALID_AGENTS.join(", ")}.`,
      );
    }
    return v as AgentType;
  });

  for (const [, input] of unionInputs) {
    const desc =
      input.description ??
      (input.type === "enum" ? `one of: ${(input.values ?? []).join(", ")}` : input.type);
    cmd.option(`--${input.name} <value>`, desc);
  }

  cmd.option("-d, --detach", "Run workflow in background (detach from tmux)");

  cmd.argument("[prompt...]", "Free-form prompt (joined, stored as inputs.prompt)");

  cmd.allowUnknownOption(false);
  cmd.allowExcessArguments(true);

  cmd.action(async function (this: Command) {
    const options = this.opts() as Record<string, string | boolean | undefined>;
    const promptTokens: string[] = this.args;

    const name = options["name"] as string | undefined;
    const agent = options["agent"] as AgentType | undefined;
    const detach = options["detach"] === true;

    const cliInputs: Record<string, string> = {};
    for (const [inputName] of unionInputs) {
      const camelKey = toCamelCase(inputName);
      const v = options[camelKey];
      if (typeof v === "string" && v !== "") {
        cliInputs[inputName] = v;
      }
    }

    const promptStr = promptTokens.join(" ");
    if (promptStr !== "" && name) {
      const def = registry.resolve(name, agent as AgentType);
      if (def && def.inputs.length === 0) {
        cliInputs["prompt"] = promptStr;
      }
    }

    await onAction({ name, agent, cliInputs, detach });
  });

  return cmd;
}

/**
 * Interactive-picker path used by both `run()` and the Commander adapter.
 * Depends on `process.stdout.isTTY`; returns without side effects when
 * the user cancels or no terminal is attached.
 *
 * Exported for `./commander.ts` — not part of the public API.
 */
export async function runPicker(
  registry: Registry,
  agent: AgentType,
  detach: boolean,
  entry: string,
  dispatcherInputs: Record<string, string> | undefined,
): Promise<void> {
  const panel = await WorkflowPickerPanel.create({ agent, registry });
  const result = await panel.waitForSelection();
  panel.destroy();
  if (!result) {
    process.stdout.write("No workflow selected.\n");
    return;
  }
  const { workflow: selectedWf, inputs: pickerInputs } = result;
  await resolveAndStart(registry, selectedWf.name, agent, {
    cliInputs: pickerInputs,
    dispatcherInputs,
    detach,
    entry,
  });
}

// ─── Public factory ──────────────────────────────────────────────────────────

/**
 * Create a workflow CLI that resolves `--name` + `--agent` from argv and
 * runs the matching workflow from the registry.
 *
 * Accepts three input shapes — pick whichever is cleanest:
 *
 * - **A single workflow.** `createWorkflowCli(workflow).run()`.
 * - **An array of workflows.** `createWorkflowCli([claude, copilot]).run()`.
 * - **A `Registry`.** For programmatic/dynamic composition, or sharing a
 *   registry across multiple CLIs. Build with `createRegistry().register(...)`.
 *
 * @example
 * ```ts
 * // Single workflow — ~70% of use cases
 * const cli = createWorkflowCli(workflow);
 * await cli.run();
 *
 * // Multi-workflow, multi-agent — by far the most common multi-case
 * await createWorkflowCli([claude, copilot, opencode]).run();
 *
 * // Dynamic composition
 * const registry = workflowFiles.reduce(
 *   (r, wf) => r.register(wf),
 *   createRegistry(),
 * );
 * await createWorkflowCli(registry).run();
 * ```
 *
 * To embed under a parent Commander CLI:
 *
 * ```ts
 * import { toCommand, runCli } from "@bastani/atomic/workflows/commander";
 * parent.addCommand(toCommand(cli));
 * await runCli(cli, () => parent.parseAsync());
 * ```
 *
 * The single/array overloads use generic constraints (`W extends
 * RegistrableWorkflow`) rather than a plain parameter type. This matters
 * under `--strictFunctionTypes`: a `WorkflowDefinition<"claude", ...>`
 * will not assign to a property-typed parameter because its narrow
 * `run(ctx: WorkflowContext<"claude">)` is contravariant against the
 * broader target. Routing through a generic `W` lets TS check bivariantly
 * via `extends`, which matches how `Registry.register` already accepts
 * the same inputs.
 */
export function createWorkflowCli<W extends RegistrableWorkflow>(
  target: W,
  options?: CreateWorkflowCliOptions,
): WorkflowCli;
export function createWorkflowCli<W extends RegistrableWorkflow>(
  target: readonly W[],
  options?: CreateWorkflowCliOptions,
): WorkflowCli;
export function createWorkflowCli<T extends Record<string, WorkflowDefinition>>(
  target: Registry<T>,
  options?: CreateWorkflowCliOptions,
): WorkflowCli<T>;
export function createWorkflowCli<T extends Record<string, WorkflowDefinition>>(
  target: RegistrableWorkflow | readonly RegistrableWorkflow[] | Registry<T>,
  options: CreateWorkflowCliOptions = {},
): WorkflowCli<T> {
  const registry = normalizeToRegistry<T>(target);
  const defaultInputs = options.inputs;
  const extend = options.extend;
  const entry = options.entry ?? process.argv[1]!;
  const includeManagementCommands = options.includeManagementCommands !== false;

  // Build input union at construction time — throws on type conflicts.
  const unionInputs = buildInputUnion(registry.list());

  const cli: WorkflowCli<T> = {
    registry,
    entry,
    defaults: defaultInputs,

    async run(runOpts = {}): Promise<void> {
      if (await handleOrchestratorReEntry((n, a) => registry.resolve(n, a))) {
        return;
      }

      const { argv } = runOpts;

      if (argv === false) {
        // Programmatic: skip Commander entirely.
        if (!runOpts.name || !runOpts.agent) {
          throw new Error(
            "cli.run({ argv: false }) requires both `name` and `agent`",
          );
        }
        await resolveAndStart(registry, runOpts.name, runOpts.agent, {
          runInputs: runOpts.inputs,
          dispatcherInputs: defaultInputs,
          detach: runOpts.detach,
          entry,
        });
        return;
      }

      // CLI mode — build a fresh command, fold runOpts in as defaults.
      let cmd!: Command;
      cmd = buildCliCommand(
        registry,
        unionInputs,
        async (params) => {
          // Programmatic `name`/`agent`/`detach` layer beneath parsed values.
          const effectiveName = params.name ?? runOpts.name;
          const effectiveAgent = params.agent ?? runOpts.agent;
          const effectiveDetach = params.detach || (runOpts.detach ?? false);

          // Interactive picker: agent given, name omitted, running in a real terminal.
          if (!effectiveName && effectiveAgent && process.stdout.isTTY) {
            await runPicker(registry, effectiveAgent, effectiveDetach, entry, defaultInputs);
            return;
          }

          if (!effectiveName || !effectiveAgent) {
            // Commander's `help()` calls `process.exit()` and is typed `never`.
            cmd.help();
          }

          await resolveAndStart(registry, effectiveName, effectiveAgent, {
            cliInputs: params.cliInputs,
            runInputs: runOpts.inputs,
            dispatcherInputs: defaultInputs,
            detach: effectiveDetach,
            entry,
          });
        },
      );

      // Auto-register `session` + `status` subcommands so SDK users get the
      // same monitoring surface as the global `atomic` CLI without needing
      // the global binary. Sessions live on the shared atomic tmux socket,
      // so these are pure pass-throughs. Opt out with
      // `createWorkflowCli(wf, { includeManagementCommands: false })`.
      if (includeManagementCommands) {
        const { addManagementCommands } = await import("./management-commands.ts");
        addManagementCommands(cmd, "workflow");
      }

      if (extend) extend(cmd);

      await cmd.parseAsync(argv ?? process.argv);
    },
  };

  return cli;
}
