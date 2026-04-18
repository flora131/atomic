/**
 * Orchestrator entry point — invoked inside a tmux pane by the launcher script.
 *
 * Separated from executor.ts to avoid the dual-module-identity problem:
 * Bun evaluates a file twice when it is both the entry point (`bun run`)
 * and reached through package.json `exports` self-referencing. Keeping
 * the side-effectful `--run` guard here ensures executor.ts stays a pure
 * library module that can be safely re-exported from the SDK barrel.
 */

import { runOrchestrator, applyContainerEnvDefaults } from "./executor.ts";

applyContainerEnvDefaults();

runOrchestrator().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
