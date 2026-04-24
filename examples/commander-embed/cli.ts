/**
 * Commander embedding — mount an atomic workflow under a parent Commander CLI
 * alongside plain Commander commands.
 *
 * `toCommand(cli, "greet")` converts the `WorkflowCli` into a Commander
 * subcommand. `runCli(cli, fn)` replaces `program.parseAsync()` and
 * transparently handles detached orchestrator re-entry — when the process
 * is a tmux-spawned worker (ATOMIC_ORCHESTRATOR_MODE=1), `runCli` dispatches
 * directly to `runOrchestrator` and your `cliFn` never runs. No guards, no
 * env-var checks in user code. Same pattern as PyTorch's
 * `init_process_group` for rank-zero dispatch.
 *
 * The Commander dependency lives on the dedicated subpath
 * `@bastani/atomic/workflows/commander`, so the core SDK stays
 * framework-agnostic — a future `yargs` or `citty` adapter could ship
 * alongside without touching `createWorkflowCli`.
 *
 * Try:
 *   bun run examples/commander-embed/cli.ts greet -a claude --who=Alex
 *   bun run examples/commander-embed/cli.ts greet -a claude            # picker (TTY)
 *   bun run examples/commander-embed/cli.ts status                     # sibling Commander command
 *   bun run examples/commander-embed/cli.ts --help                     # all commands
 */

import { Command } from "@commander-js/extra-typings";
import { createWorkflowCli } from "@bastani/atomic/workflows";
import { toCommand, runCli } from "@bastani/atomic/workflows/commander";
import workflow from "./claude/index.ts";

const cli = createWorkflowCli(workflow);

const program = new Command("my-app").description(
  "Demo CLI with a mounted atomic workflow alongside plain Commander commands",
);

// Mount the atomic workflow as a subcommand named "greet".
program.addCommand(toCommand(cli, "greet"));

// A plain Commander sibling command — no atomic involvement, showing that
// atomic can live side-by-side with the rest of your CLI surface.
program
  .command("status")
  .description("Print a trivial status line")
  .action(() => {
    console.log("ok");
  });

// `runCli` replaces `program.parseAsync()`. Pass pre-parse bootstrap inside
// the callback if you need to read config, warm caches, etc. The extra
// `await` discards `parseAsync`'s return value so the callback matches
// runCli's `() => void | Promise<void>` signature.
await runCli(cli, async () => {
  await program.parseAsync();
});
