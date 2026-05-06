#!/usr/bin/env bun
/**
 * SDK-bundled internal CLI dispatcher.
 *
 * Used by `runWorkflow()` to spawn the orchestrator pane and the cc-debounce
 * Ctrl+C hook in a fresh sub-process. The launcher emits
 * `<bun> <this-script> _<subcommand> <args…>` whenever the resolver returns
 * `host-bun` — i.e. whenever the SDK is running under a host bun runtime
 * with a real on-disk path (workspace dev, `bun run`, or a published
 * `node_modules` install). Compiled-binary hosts use a different branch
 * (`override-binary` / `atomic-binary`) and never spawn this script.
 *
 * Why the SDK ships its own dispatcher even though `@bastani/atomic` also
 * registers the same sub-commands: the atomic CLI binary cannot
 * dynamic-import third-party workflow files (their
 * `import { defineWorkflow } from "@bastani/atomic-sdk/workflows"` is
 * unresolvable from a `bun build --compile` binary's bunfs context). When
 * the consumer is running under host bun, spawning a host-bun child against
 * this script lets module resolution walk the workflow's project tree
 * normally.
 */

import { Command } from "@commander-js/extra-typings";

const program = new Command()
  .name("atomic-sdk")
  .description("Internal dispatcher used by @bastani/atomic-sdk self-exec")
  .helpCommand(false);

program
  .command("_orchestrator-entry", { hidden: true })
  .description("Internal: load a workflow definition and run the orchestrator panel")
  .argument("<workflowName>", "Workflow name")
  .argument("<agent>", "claude | copilot | opencode")
  .argument("[inputsB64]", "Base64-encoded JSON record of structured inputs", "")
  .argument(
    "[workflowSource]",
    "Workflow source path (dynamic-import target)",
    "",
  )
  .action(async (
    _workflowName: string,
    agent: string,
    inputsB64: string,
    workflowSource: string,
  ) => {
    const { runOrchestratorEntry } = await import(
      "./runtime/orchestrator-entry.ts"
    );
    await runOrchestratorEntry(workflowSource, agent, inputsB64);
  });

program
  .command("_cc-debounce", { hidden: true })
  .description("Internal: debounce Ctrl+C presses inside Atomic-managed tmux panes")
  .argument("<paneId>", "tmux pane id (e.g. %0)")
  .action(async (paneId: string) => {
    const { runCcDebounce } = await import("./runtime/cc-debounce.ts");
    process.exit(runCcDebounce(paneId));
  });

await program.parseAsync(process.argv);
