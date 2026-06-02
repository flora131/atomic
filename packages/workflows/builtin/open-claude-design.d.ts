import type { WorkflowDefinition, WorkflowInputValues, WorkflowOutputValues } from "../src/authoring.js";

export type OpenClaudeDesignOutputType = "prototype" | "wireframe" | "page" | "component" | "theme" | "tokens";

export type OpenClaudeDesignWorkflowInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly reference?: string;
  readonly output_type: OpenClaudeDesignOutputType;
  readonly design_system?: string;
  readonly max_refinements: number;
}

export type OpenClaudeDesignWorkflowRunInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly reference?: string;
  readonly output_type?: OpenClaudeDesignOutputType;
  readonly design_system?: string;
  readonly max_refinements?: number;
};

declare const workflow: WorkflowDefinition<OpenClaudeDesignWorkflowInputs, WorkflowOutputValues, OpenClaudeDesignWorkflowRunInputs>;
export default workflow;
