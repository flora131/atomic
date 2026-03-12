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
  currentNode: string | null;
  iteration: number;
  maxIterations: number | undefined;
  featureProgress: { completed: number; total: number; currentFeature?: string } | null;
  pendingApproval: boolean;
  specApproved: boolean;
  feedback: string | null;
  workflowConfig?: {
    userPrompt: string | null;
    sessionId?: string;
    workflowName?: string;
  };
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
  currentNode: null,
  iteration: 0,
  maxIterations: undefined,
  featureProgress: null,
  pendingApproval: false,
  specApproved: false,
  feedback: null,
};
