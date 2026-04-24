/**
 * Dispatcher — multi-workflow CLI factory.
 *
 * Parses `--name` + `--agent` from argv, exposes a union of flags across
 * every workflow in the registry, opens an interactive picker when agent
 * is given without a name in a TTY, and handles orchestrator re-entry
 * from detached runs.
 *
 * Used by the internal `atomic workflow` command. Per-workflow CLI
 * files should use `createWorker(definition)` from `./worker.ts` instead.
 */

import { Command } from "@commander-js/extra-typings";
import type {
  AgentType,
  Registry,
  Dispatcher,
  WorkflowDefinition,
  WorkflowInput,
  CreateDispatcherOptions,
} from "./types.ts";
import { executeWorkflow, runOrchestrator } from "./runtime/executor.ts";
import { WorkflowPickerPanel } from "./components/workflow-picker-panel.tsx";
import {
  toCamelCase,
  validateAndResolve,
  buildInputUnion,
} from "./worker-shared.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_AGENTS: readonly AgentType[] = ["claude", "opencode", "copilot"];

// ─── Core dispatch ──────────────────────────────────────────────────────────

/**
 * Resolve the workflow definition, merge inputs (with precedence), validate,
 * and hand off to the executor.
 *
 * Input precedence (highest → lowest):
 *   cliInputs > runInputs > dispatcherInputs > defineWorkflow defaults (handled by validateAndResolve)
 */
async function resolveAndStart(
  registry: Registry,
  name: string,
  agent: AgentType,
  opts: {
    cliInputs?: Record<string, string>;
    runInputs?: Record<string, string>;
    dispatcherInputs?: Record<string, string>;
    detach?: boolean;
    entrypointFile?: string;
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

  let resolvedInputs: Record<string, string>;
  if (def.inputs.length > 0) {
    resolvedInputs = validateAndResolve(merged, def.inputs);
  } else {
    resolvedInputs = { ...merged };
  }

  const entrypointFile = opts.entrypointFile ?? process.argv[1]!;
  const workflowKey = `${agent}/${name}`;

  await executeWorkflow({
    definition: def,
    agent,
    inputs: resolvedInputs,
    entrypointFile,
    workflowKey,
    detach: opts.detach ?? false,
  });
}

// ─── Commander command builder ──────────────────────────────────────────────

function buildCommand(
  registry: Registry,
  unionInputs: Map<string, WorkflowInput>,
  opts: {
    mountName?: string;
    dispatcherInputs?: Record<string, string>;
    argv?: string[];
  },
): Command {
  const allWorkflows = registry.list();
  const allNames = [...new Set(allWorkflows.map((w) => w.name))];

  const cmd = new Command(opts.mountName);

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

    // Interactive picker: agent given, name omitted, running in a real terminal.
    if (!name && agent && process.stdout.isTTY) {
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
        dispatcherInputs: opts.dispatcherInputs,
        detach,
        entrypointFile: process.argv[1],
      });
      return;
    }

    if (!name) {
      this.help();
    }
    if (!agent) {
      this.help();
    }

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

    const cliInputs: Record<string, string> = {};
    for (const [inputName] of unionInputs) {
      const camelKey = toCamelCase(inputName);
      const v = options[camelKey];
      if (typeof v === "string" && v !== "") {
        cliInputs[inputName] = v;
      }
    }

    const promptStr = promptTokens.join(" ");
    if (promptStr !== "") {
      if (def.inputs.length === 0) {
        cliInputs["prompt"] = promptStr;
      }
    }

    await resolveAndStart(registry, name, agent, {
      cliInputs,
      dispatcherInputs: opts.dispatcherInputs,
      detach,
      entrypointFile: process.argv[1],
    });
  });

  return cmd;
}

// ─── Public factory ──────────────────────────────────────────────────────────

/**
 * Create a dispatcher that resolves `--name` + `--agent` from argv and
 * runs the matching workflow from the registry.
 *
 * @example
 * ```ts
 * const dispatcher = createDispatcher(registry);
 * await dispatcher.start();                       // flat CLI
 * const cmd = dispatcher.command("workflow");     // for embedding
 * ```
 */
export function createDispatcher<T extends Record<string, WorkflowDefinition>>(
  registry: Registry<T>,
  options?: CreateDispatcherOptions,
): Dispatcher<T> {
  const dispatcherInputs = options?.inputs;
  const argv = options?.argv;
  const extend = options?.extend;

  // Build input union at construction time — throws on type conflicts.
  const unionInputs = buildInputUnion(registry.list());

  const dispatcher: Dispatcher<T> = {
    async start(): Promise<void> {
      // Orchestrator re-entry: detect BEFORE commander runs.
      if (process.env.ATOMIC_ORCHESTRATOR_MODE === "1") {
        const key = process.env.ATOMIC_WF_KEY;
        if (!key) {
          throw new Error(
            "ATOMIC_ORCHESTRATOR_MODE=1 but ATOMIC_WF_KEY missing",
          );
        }
        const slashIdx = key.indexOf("/");
        if (slashIdx < 0) {
          throw new Error(
            `ATOMIC_WF_KEY "${key}" is malformed — expected "<agent>/<name>"`,
          );
        }
        const agent = key.slice(0, slashIdx) as AgentType;
        const name = key.slice(slashIdx + 1);
        const def = registry.resolve(name, agent);
        if (!def) {
          throw new Error(`ATOMIC_WF_KEY "${key}" not found in registry`);
        }
        await runOrchestrator(def);
        return;
      }

      const program = buildCommand(registry, unionInputs, {
        mountName: undefined,
        dispatcherInputs,
        argv,
      });

      if (extend) {
        extend(program);
      }

      await program.parseAsync(argv ?? process.argv);
    },

    command(name?: string): Command {
      return buildCommand(registry, unionInputs, {
        mountName: name ?? "workflow",
        dispatcherInputs,
        argv,
      });
    },

    async run(
      workflowName: string,
      agent: AgentType,
      runOpts?: { inputs?: Record<string, string>; detach?: boolean; entrypointFile?: string },
    ): Promise<void> {
      await resolveAndStart(registry, workflowName, agent, {
        runInputs: runOpts?.inputs,
        dispatcherInputs,
        detach: runOpts?.detach,
        entrypointFile: runOpts?.entrypointFile ?? process.argv[1],
      });
    },
  };

  return dispatcher;
}
