import type { SyntaxStyle } from "@opentui/core";
import type { ChatMessage, StreamingMeta, TaskItem } from "@/state/chat/shared/types/message.ts";
import type { QuestionAnswer, UserQuestion } from "@/components/user-question-dialog.tsx";

export interface AtomicHeaderProps {
  version?: string;
  model?: string;
  tier?: string;
  workingDir?: string;
  suggestion?: string;
}

export interface MessageBubbleProps {
  activeBackgroundAgentCount?: number;
  activeHitlToolCallId?: string | null;
  activeQuestion?: UserQuestion | null;
  message: ChatMessage;
  isLast?: boolean;
  isVerbose?: boolean;
  syntaxStyle?: SyntaxStyle;
  hideLoading?: boolean;
  handleQuestionAnswer?: (answer: QuestionAnswer) => void;
  todoItems?: TaskItem[];
  tasksExpanded?: boolean;
  workflowSessionDir?: string | null;
  workflowActive?: boolean;
  showTodoPanel?: boolean;
  elapsedMs?: number;
  collapsed?: boolean;
  streamingMeta?: StreamingMeta | null;
  onAgentDoneRendered?: (marker: { messageId: string; agentId: string; timestampMs: number }) => void;
}
