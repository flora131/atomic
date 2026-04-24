/**
 * Commander adapter for embedding a WorkflowCli under a parent Commander CLI.
 *
 * ```ts
 * import { createWorkflowCli } from "@bastani/atomic/workflows";
 * import { toCommand, runCli } from "@bastani/atomic/workflows/commander";
 *
 * const cli = createWorkflowCli(workflow);
 * const program = new Command("my-app");
 * program.addCommand(toCommand(cli, "workflow"));
 *
 * await runCli(cli, () => program.parseAsync());
 * ```
 *
 * `WorkflowCli` itself is framework-agnostic — this module is the only place
 * that imports Commander on the adapter side of the API. A future
 * yargs/citty adapter would be a sibling module with the same shape.
 *
 * `runCli` handles orchestrator re-entry transparently — parent CLIs never
 * see env vars or guards. PyTorch-distributed style: the framework owns
 * rank-zero dispatch; the developer writes one line.
 */

import type { Command } from "@commander-js/extra-typings";
import type {
  AgentType,
  WorkflowCli,
  WorkflowDefinition,
} from "./types.ts";
import {
  buildCliCommand,
  resolveAndStart,
  runPicker,
} from "./workflow-cli.ts";
import { buildInputUnion } from "./worker-shared.ts";
import { runOrchestrator } from "./runtime/executor.ts";

/**
 * Build a Commander `Command` bound to a WorkflowCli for embedding under
 * a parent CLI. The returned Command declares `-n/--name`, `-a/--agent`,
 * `-d/--detach`, plus the per-input union across the registry. Picker
 * behaviour (agent without name in a TTY) is preserved.
 *
 * @param cli - WorkflowCli returned by `createWorkflowCli()`.
 * @param name - Mount name (default: `"workflow"`).
 */
export function toCommand<T extends Record<string, WorkflowDefinition>>(
  cli: WorkflowCli<T>,
  name?: string,
): Command {
  const registry = cli.registry;
  const entry = cli.entry;
  const defaultInputs = cli.defaults;

  const unionInputs = buildInputUnion(registry.list());

  let cmd!: Command;
  cmd = buildCliCommand(
    registry,
    unionInputs,
    async (params) => {
      const { name: parsedName, agent: parsedAgent, cliInputs, detach } = params;

      // Interactive picker: agent given, name omitted, running in a TTY.
      if (!parsedName && parsedAgent && process.stdout.isTTY) {
        await runPicker(registry, parsedAgent, detach, entry, defaultInputs);
        return;
      }

      if (!parsedName || !parsedAgent) {
        // Commander's `help()` calls `process.exit()` and is typed `never`.
        cmd.help();
      }

      await resolveAndStart(
        registry,
        parsedName,
        parsedAgent as AgentType,
        {
          cliInputs,
          dispatcherInputs: defaultInputs,
          detach,
          entry,
        },
      );
    },
    name ?? "workflow",
  );

  return cmd;
}

// ─── runCli — embed bootstrap ──────────────────────────────────────────────

/**
 * Bootstrap an embedded Commander CLI. Use this in place of
 * `program.parseAsync()` when you've mounted an atomic WorkflowCli under
 * a parent program.
 *
 * Inspired by PyTorch's `init_process_group()`: the framework handles
 * rank-zero dispatch (here: orchestrator vs CLI) transparently, so the
 * developer writes the same code whether this process is a fresh CLI
 * invocation or a tmux-spawned orchestrator re-exec.
 *
 * - On a fresh invocation, invokes `cliFn()` (your `program.parseAsync()`
 *   call, plus any bootstrap you want before it).
 * - When the process is a detached orchestrator re-exec
 *   (`ATOMIC_ORCHESTRATOR_MODE=1` is set by the runtime), resolves the
 *   workflow identified by `ATOMIC_WF_KEY` against the supplied CLI
 *   (or the first match across CLIs) and drives it via
 *   `runOrchestrator`. `cliFn` is not called.
 *
 * Accepts a single WorkflowCli or an array — use an array when your
 * parent CLI embeds multiple atomic WorkflowClis (rare, but supported).
 *
 * @example
 * ```ts
 * const program = new Command("my-app");
 * program.addCommand(toCommand(cli));
 *
 * await runCli(cli, () => program.parseAsync());
 * ```
 *
 * @example With pre-parse bootstrap:
 * ```ts
 * await runCli(builtinCli, async () => {
 *   await ensureGlobalAtomicSettings();
 *   await autoSyncIfStale();
 *   await program.parseAsync();
 * });
 * ```
 */
export async function runCli(
  target: WorkflowCli | ReadonlyArray<WorkflowCli>,
  cliFn: () => void | Promise<void>,
): Promise<void> {
  if (process.env.ATOMIC_ORCHESTRATOR_MODE === "1") {
    const key = process.env.ATOMIC_WF_KEY ?? "";
    const slashIdx = key.indexOf("/");
    if (slashIdx < 0) {
      throw new Error(
        `ATOMIC_ORCHESTRATOR_MODE=1 but ATOMIC_WF_KEY "${key}" is malformed — expected "<agent>/<name>"`,
      );
    }
    const agent = key.slice(0, slashIdx) as AgentType;
    const name = key.slice(slashIdx + 1);

    const clis = Array.isArray(target) ? target : [target];
    for (const cli of clis) {
      const def = cli.registry.resolve(name, agent);
      if (def) {
        await runOrchestrator(def);
        return;
      }
    }

    throw new Error(`ATOMIC_WF_KEY "${key}" not found in any provided WorkflowCli`);
  }

  await cliFn();
}
