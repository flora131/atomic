/**
 * Workflow command types and argument parsing.
 *
 * Type definitions are re-exported from their canonical location in
 * `services/workflows/types/`. Parse functions remain here
 * since they are command-layer concerns.
 */

export type {
  WorkflowCommandArgs,
  WorkflowDefinition,
  WorkflowMetadata,
  WorkflowStateParams,
} from "@/services/workflows/types/index.ts";

import type { WorkflowCommandArgs } from "@/services/workflows/types/index.ts";

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

