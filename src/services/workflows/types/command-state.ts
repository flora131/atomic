/**
 * Workflow Command State Types
 *
 * Types and default values for workflow command/UI state that flows
 * through WorkflowChatState. These are consumed by the state layer
 * and UI components to render workflow progress.
 */

export interface WorkflowCommandArgs {
  prompt: string;
}

/**
 * Progress indicator for iterative workflows (e.g., feature-by-feature implementation).
 *
 * Generic progress tracking for iterative workflows (e.g., step-by-step
 * implementation). Any workflow that tracks progress through a list of items
 * can use this interface.
 */
export interface WorkflowProgressState {
  completed: number;
  total: number;
  currentItem?: string;
}

/**
 * Generic workflow command/UI state that flows through WorkflowChatState.
 *
 * Provides
 * workflow-agnostic fields that any workflow conductor can populate:
 *
 * - `currentNode` / `iteration` / `maxIterations` — execution progress
 * - `currentStage` / `stageIndicator` — stage-based conductor state
 * - `pendingApproval` / `approved` / `feedback` — HITL interaction
 * - `progress` — optional progress tracking for iterative workflows
 * - `extensions` — escape hatch for workflow-specific data
 */
export interface WorkflowCommandState {
  currentNode: string | null;
  iteration: number;
  maxIterations: number | undefined;
  currentStage: string | null;
  stageIndicator: string | null;
  progress: WorkflowProgressState | null;
  pendingApproval: boolean;
  approved: boolean;
  feedback: string | null;
  extensions: Record<string, unknown>;
}

/** Default values for WorkflowCommandState — used when initializing or resetting. */
export const defaultWorkflowCommandState: WorkflowCommandState = {
  currentNode: null,
  iteration: 0,
  maxIterations: undefined,
  currentStage: null,
  stageIndicator: null,
  progress: null,
  pendingApproval: false,
  approved: false,
  feedback: null,
  extensions: {},
};
