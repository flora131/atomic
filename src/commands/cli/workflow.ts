/**
 * Workflow CLI command — thin delegation to the SDK worker.
 *
 * The Command returned here is mounted directly into the parent program
 * (src/cli.ts), which attaches the `list`, `inputs`, `status`, and
 * `session` subcommands on top of it.
 */

import { createDispatcher } from "../../sdk/dispatcher.ts";
import { createBuiltinRegistry } from "../../sdk/workflows/builtin-registry.ts";

export const workflowCommand = createDispatcher(
  createBuiltinRegistry(),
).command("workflow");
