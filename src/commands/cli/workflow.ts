/**
 * Workflow CLI command — thin delegation to the SDK WorkflowCli.
 *
 * The Command returned here is mounted directly into the parent program
 * (src/cli.ts), which attaches the `list`, `inputs`, `status`, and
 * `session` subcommands on top of it.
 */

import { createWorkflowCli } from "../../sdk/workflow-cli.ts";
import { toCommand } from "../../sdk/commander.ts";
import { createBuiltinRegistry } from "../../sdk/workflows/builtin-registry.ts";

export const workflowCommand = toCommand(
  createWorkflowCli(createBuiltinRegistry()),
  "workflow",
);
