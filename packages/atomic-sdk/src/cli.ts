#!/usr/bin/env bun
/**
 * SDK-bundled internal CLI dispatcher.
 *
 * The SDK self-execs into a fresh sub-process to spawn long-running pieces
 * of a workflow (orchestrator pane, attached footer, cc-debounce hook). To
 * avoid coupling SDK consumers to the user-facing `@bastani/atomic` CLI
 * package, the SDK ships its own dispatcher right here. `lib/self-exec.ts`
 * resolves to this file by default; consumers may override the resolved
 * path through `runWorkflow({ pathToAtomicExecutable })` (mirrors the
 * Claude Code SDK's `pathToClaudeCodeExecutable`).
 *
 * Subcommands handled:
 *   _orchestrator-entry <workflowName> <agent> [inputsB64] [workflowSource]
 *   _footer --name <name> [--agent <agent>]
 *   _cc-debounce <paneId>
 *
 * Compiled-binary mode is intentionally not handled here: when the runtime
 * is a `bun build --compile` of the user-facing CLI, `resolveSdkCliPath()`
 * returns `process.execPath` and the binary's own dispatcher receives the
 * argv. This script only runs when the SDK lives at an installed-package
 * path or in workspace dev mode.
 */

import { Command } from "@commander-js/extra-typings";
import { isValidAgent } from "./services/config/definitions.ts";

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
  .command("_footer", { hidden: true })
  .description("Internal: render the attached-mode footer for an agent window")
  .requiredOption("--name <name>", "Agent window name")
  .option(
    "--agent <agent>",
    "Agent type — renders provider pill in the footer",
  )
  .action(async (opts: { name: string; agent?: string }) => {
    const { footerCommand } = await import("./runtime/footer-command.tsx");
    const agentType = opts.agent && isValidAgent(opts.agent) ? opts.agent : undefined;
    const exitCode = await footerCommand(opts.name, agentType);
    process.exit(exitCode);
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
