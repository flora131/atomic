export interface WorkflowInputResolver {
  resolve: (prompt: string) => void;
  reject: (reason: Error) => void;
}

export const STALE_WORKFLOW_INPUT_REASON = "Workflow is no longer active";

export function consumeWorkflowInputSubmission(
  resolver: WorkflowInputResolver | null,
  workflowActive: boolean,
  prompt: string,
): { consumed: boolean; nextResolver: WorkflowInputResolver | null } {
  if (!resolver) {
    return { consumed: false, nextResolver: null };
  }

  if (!workflowActive) {
    resolver.reject(new Error(STALE_WORKFLOW_INPUT_REASON));
    return { consumed: false, nextResolver: null };
  }

  resolver.resolve(prompt);
  return { consumed: true, nextResolver: null };
}

export function rejectPendingWorkflowInput(
  resolver: WorkflowInputResolver | null,
  reason: string = STALE_WORKFLOW_INPUT_REASON,
): WorkflowInputResolver | null {
  if (resolver) {
    resolver.reject(new Error(reason));
  }
  return null;
}
