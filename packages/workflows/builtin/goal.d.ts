import type { WorkflowDefinition, WorkflowInputValues, WorkflowOutputValues } from "../src/authoring.js";

export type GoalWorkflowInputs = WorkflowInputValues & {
  readonly objective: string;
  readonly max_turns: number;
  readonly base_branch: string;
}

export type GoalWorkflowRunInputs = WorkflowInputValues & {
  readonly objective: string;
  readonly max_turns?: number;
  readonly base_branch?: string;
};

declare const workflow: WorkflowDefinition<GoalWorkflowInputs, WorkflowOutputValues, GoalWorkflowRunInputs>;
export default workflow;
