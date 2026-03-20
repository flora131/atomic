import type { SyntaxStyle } from "@opentui/core";
import type { ChatMessage, StreamingMeta, TaskItem } from "@/state/chat/shared/types/message.ts";

export interface AtomicHeaderProps {
  version?: string;
  model?: string;
  tier?: string;
  workingDir?: string;
}

export interface MessageBubbleProps {
  activeBackgroundAgentCount?: number;
  message: ChatMessage;
  isLast?: boolean;
  syntaxStyle?: SyntaxStyle;
  hideLoading?: boolean;
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
