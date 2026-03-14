import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { TaskItem } from "@/components/task-list-indicator.tsx";
import type { McpSnapshotView } from "@/lib/ui/mcp-output.ts";
import type { HitlResponseMode, HitlResponseRecord } from "@/lib/ui/hitl-response.ts";
import type { ToolExecutionStatus } from "@/state/parts/types.ts";
import type { Part } from "@/state/parts/index.ts";
import type { FileReadInfo } from "@/lib/ui/mention-parsing.ts";

export type { TaskItem } from "@/components/task-list-indicator.tsx";

export type MessageRole = "user" | "assistant" | "system";

/** Context for a HITL (human-in-the-loop) response rendered in the chat stream. */
export interface HitlContext {
  question: string;
  header: string;
  answer: string;
  cancelled: boolean;
  responseMode: HitlResponseMode;
}

export interface MessageToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: ToolExecutionStatus;
  hitlResponse?: HitlResponseRecord;
}

export interface MessageSkillLoad {
  skillName: string;
  status: "loading" | "loaded" | "error";
  errorMessage?: string;
}

export interface StreamingMeta {
  outputTokens: number;
  thinkingMs: number;
  thinkingText: string;
  thinkingSourceKey?: string;
  thinkingTextBySource?: Record<string, string>;
  thinkingGenerationBySource?: Record<string, number>;
  thinkingMessageBySource?: Record<string, string>;
}

export interface ThinkingDropDiagnostics {
  droppedStaleOrClosedThinkingEvents: number;
  droppedMissingBindingThinkingEvents: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  streaming?: boolean;
  parts?: Part[];
  toolCalls?: MessageToolCall[];
  durationMs?: number;
  modelId?: string;
  wasInterrupted?: boolean;
  parallelAgents?: ParallelAgent[];
  filesRead?: FileReadInfo[];
  skillLoads?: MessageSkillLoad[];
  taskItems?: TaskItem[];
  mcpSnapshot?: McpSnapshotView;
  outputTokens?: number;
  thinkingMs?: number;
  thinkingText?: string;
  spinnerVerb?: string;
  hitlContext?: HitlContext;
}
