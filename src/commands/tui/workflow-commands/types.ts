/**
 * Workflow command types and argument parsing.
 *
 * Type definitions are re-exported from their canonical location in
 * `services/workflows/workflow-types.ts`. Parse functions remain here
 * since they are command-layer concerns.
 */

export type {
  WorkflowCommandArgs,
  WorkflowDefinition,
  WorkflowGraphConfig,
  WorkflowMetadata,
  WorkflowStateMigrator,
  WorkflowStateParams,
} from "@/services/workflows/workflow-types.ts";

import type { WorkflowCommandArgs } from "@/services/workflows/workflow-types.ts";

export function parseWorkflowArgs(args: string, workflowName = "workflow"): WorkflowCommandArgs {
  const trimmed = args.trim();

  if (!trimmed) {
    throw new Error(
      `Usage: /${workflowName} "<prompt-or-spec-path>"\n` +
        "A prompt argument is required.",
    );
  }

  return { prompt: trimmed };
}

