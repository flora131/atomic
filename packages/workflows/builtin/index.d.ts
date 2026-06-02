import type { WorkflowDefinition, WorkflowInputValues, WorkflowOutputValues } from "../src/authoring.js";

type BuiltinOutputs = WorkflowOutputValues;

type DeepResearchCodebaseInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly max_partitions: number;
  readonly max_concurrency: number;
};
type DeepResearchCodebaseRunInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly max_partitions?: number;
  readonly max_concurrency?: number;
};

type GoalInputs = WorkflowInputValues & {
  readonly objective: string;
  readonly max_turns: number;
  readonly base_branch: string;
};
type GoalRunInputs = WorkflowInputValues & {
  readonly objective: string;
  readonly max_turns?: number;
  readonly base_branch?: string;
};

type RalphInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly max_loops: number;
  readonly base_branch: string;
  readonly git_worktree_dir: string;
};
type RalphRunInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly max_loops?: number;
  readonly base_branch?: string;
  readonly git_worktree_dir?: string;
};

type OpenClaudeDesignOutputType = "prototype" | "wireframe" | "page" | "component" | "theme" | "tokens";

type OpenClaudeDesignInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly reference?: string;
  readonly output_type: OpenClaudeDesignOutputType;
  readonly design_system?: string;
  readonly max_refinements: number;
};
type OpenClaudeDesignRunInputs = WorkflowInputValues & {
  readonly prompt: string;
  readonly reference?: string;
  readonly output_type?: OpenClaudeDesignOutputType;
  readonly design_system?: string;
  readonly max_refinements?: number;
};

export declare const deepResearchCodebase: WorkflowDefinition<DeepResearchCodebaseInputs, BuiltinOutputs, DeepResearchCodebaseRunInputs>;
export declare const goal: WorkflowDefinition<GoalInputs, BuiltinOutputs, GoalRunInputs>;
export declare const ralph: WorkflowDefinition<RalphInputs, BuiltinOutputs, RalphRunInputs>;
export declare const openClaudeDesign: WorkflowDefinition<OpenClaudeDesignInputs, BuiltinOutputs, OpenClaudeDesignRunInputs>;
