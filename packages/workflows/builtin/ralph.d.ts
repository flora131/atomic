import type { WorkflowDefinition, WorkflowInputValues, WorkflowOutputValues } from "../src/authoring.js";

export type RalphWorkflowInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly max_loops: number;
  readonly base_branch: string;
  readonly git_worktree_dir: string;
}

export type RalphWorkflowRunInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly max_loops?: number;
  readonly base_branch?: string;
  readonly git_worktree_dir?: string;
};

declare const workflow: WorkflowDefinition<RalphWorkflowInputs, WorkflowOutputValues, RalphWorkflowRunInputs>;
export default workflow;
