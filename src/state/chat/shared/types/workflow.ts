import type { WorkflowCommandState } from "@/services/workflows/workflow-types.ts";
import { defaultWorkflowCommandState } from "@/services/workflows/workflow-types.ts";

export interface WorkflowChatState {
  showAutocomplete: boolean;
  autocompleteInput: string;
  selectedSuggestionIndex: number;
  argumentHint: string;
  autocompleteMode: "command" | "mention";
  mentionStartOffset: number;
  workflowActive: boolean;
  workflowType: string | null;
  initialPrompt: string | null;
  workflowConfig?: {
    userPrompt: string | null;
    sessionId?: string;
    workflowName?: string;
  };
  /** Current conductor stage name (e.g. "research", "plan", "implement"). */
  currentStage: string | null;
  /** Human-readable stage progress indicator (e.g. "Stage 2/4: implement"). */
  stageIndicator: string | null;
  /** Generic workflow command/UI state for all workflow types. */
  workflowCommandState: WorkflowCommandState;
}

export const defaultWorkflowChatState: WorkflowChatState = {
  showAutocomplete: false,
  autocompleteInput: "",
  selectedSuggestionIndex: 0,
  argumentHint: "",
  autocompleteMode: "command",
  mentionStartOffset: 0,
  workflowActive: false,
  workflowType: null,
  initialPrompt: null,
  currentStage: null,
  stageIndicator: null,
  workflowCommandState: { ...defaultWorkflowCommandState },
};
