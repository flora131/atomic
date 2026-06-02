import type { WorkflowDefinition, WorkflowInputValues, WorkflowOutputValues } from "../src/authoring.js";

export type DeepResearchCodebaseWorkflowInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly max_partitions: number;
  readonly max_concurrency: number;
}

export type DeepResearchCodebaseWorkflowRunInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly max_partitions?: number;
  readonly max_concurrency?: number;
};

declare const workflow: WorkflowDefinition<DeepResearchCodebaseWorkflowInputs, WorkflowOutputValues, DeepResearchCodebaseWorkflowRunInputs>;
export default workflow;
