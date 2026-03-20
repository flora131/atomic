import type { WorkflowCommandState } from "@/services/workflows/workflow-types.ts";
import { defaultWorkflowCommandState } from "@/services/workflows/workflow-types.ts";
import type { RalphCommandState } from "@/services/workflows/ralph/types.ts";
import { defaultRalphCommandState } from "@/services/workflows/ralph/types.ts";

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
  /** Generic workflow command/UI state. Replaces the former Ralph-specific `ralphState`. */
  workflowCommandState: WorkflowCommandState;
  /**
   * Ralph-specific workflow state. Isolated from the generic workflow fields.
   * @deprecated Use `workflowCommandState` instead. This alias is retained for
   * backward compatibility during the migration period.
   */
  ralphState: RalphCommandState;
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
  workflowCommandState: { ...defaultWorkflowCommandState },
  ralphState: { ...defaultRalphCommandState },
};
